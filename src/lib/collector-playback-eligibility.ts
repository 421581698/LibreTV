export interface CandidatePlaybackValidation {
  reachable?: boolean | null;
  media_format?: string | null;
  content_type?: string | null;
  manifest_valid?: boolean;
  rejected_reference_count?: number;
  segment_probe?: { sampled?: number; failed?: number };
  variant_tree_probe?: { reachable_leaf_count?: number };
  access?: { access_state?: string };
}

export interface CandidatePlaybackRecord {
  kind: string;
  url: string;
  status?: string;
  access_state?: string;
  validation?: CandidatePlaybackValidation;
}

/**
 * HTTP validation is only a preflight gate, never proof of successful playback.
 * Keep this allow-list aligned with PlayerShell's implemented format adapters.
 */
export function isCandidatePreviewEligible(candidate: CandidatePlaybackRecord): boolean {
  const validation = candidate.validation;
  if (!validation || candidate.kind !== 'direct-media') return false;
  if (candidate.status !== 'validated' || validation.reachable !== true) return false;

  const accessState = validation.access?.access_state ?? candidate.access_state;
  if (accessState !== 'PUBLIC') return false;
  if (validation.rejected_reference_count !== undefined && validation.rejected_reference_count > 0) return false;

  if (validation.media_format === 'hls') {
    if (validation.manifest_valid !== true) return false;
    if (validation.variant_tree_probe) {
      return (validation.variant_tree_probe.reachable_leaf_count ?? 0) > 0;
    }
    if (validation.segment_probe) {
      return validation.segment_probe.sampled !== undefined
        && validation.segment_probe.sampled > 0
        && validation.segment_probe.failed === 0;
    }
    return false;
  }

  if (validation.media_format !== 'progressive') return false;
  let pathname = candidate.url;
  try {
    pathname = new URL(candidate.url, 'https://libretv.invalid').pathname;
  } catch {
    return false;
  }
  const path = pathname.toLowerCase();
  const contentType = (validation.content_type ?? '').split(';', 1)[0].trim().toLowerCase();
  return (
    /\.(mp4|m4v|mov|webm)$/.test(path) ||
    ['video/mp4', 'video/webm', 'video/quicktime'].includes(contentType)
  );
}
