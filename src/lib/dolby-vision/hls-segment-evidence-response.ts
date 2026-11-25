/**
 * Parse a server-verified HLS RPU segment-set response without treating it as
 * a browser-side signature verification or a Dolby Vision output attestation.
 * The server must authenticate the graph and verify every Ed25519 signature.
 */
export interface VerifiedHlsSegmentEvidenceResponse {
  resourceId: string;
  variantAssetId: string;
  segmentCount: number;
  totalRpuFrameCount: number;
  rpuFrameAlignment: 'frame-count-matches-video-samples';
  metadataLevels: number[];
  graphSha256: string;
  verifiedParserVersion: string;
  verifiedMetadataLevelFrameCounts: Record<string, number>;
  orderedRpuEvidenceSha256: string;
}

const isSha256 = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function parseVerifiedHlsSegmentEvidenceResponse(
  value: unknown,
  expectedResourceId: string,
  expectedVariantAssetId: string,
): VerifiedHlsSegmentEvidenceResponse | null {
  if (!isRecord(value) || !isRecord(value.graph) ||
      value.verified !== true || value.analysisScope !== 'hls-fmp4-segment-set' ||
      value.resourceId !== expectedResourceId || value.variantAssetId !== expectedVariantAssetId ||
      !isSha256(value.graph.graphSha256) || !isSha256(value.orderedRpuEvidenceSha256) ||
      typeof value.verifiedParserVersion !== 'string' ||
      !/^2\.3\.\d+$/.test(value.verifiedParserVersion) ||
      !isPositiveInteger(value.segmentCount) || value.segmentCount > 10_000 ||
      !isPositiveInteger(value.totalRpuFrameCount) ||
      value.timelineContinuity !== 'contiguous' ||
      value.rpuProfileContinuity !== 'consistent' ||
      value.rpuFrameAlignment !== 'frame-count-matches-video-samples' ||
      value.rpuSemanticContinuity !== 'not-established' ||
      value.semanticEvidenceLimitation !== 'per-frame-rpu-boundaries-not-signed' ||
      !Array.isArray(value.segments) || value.segments.length !== value.segmentCount ||
      !isRecord(value.verifiedMetadataLevelFrameCounts)) return null;

  let summedFrames = 0;
  const levels = new Set<number>();
  const seenAssets = new Set<string>();
  for (let ordinal = 0; ordinal < value.segments.length; ordinal += 1) {
    const segment = value.segments[ordinal];
    if (!isRecord(segment) || segment.ordinal !== ordinal ||
        typeof segment.fragmentAssetId !== 'string' || !segment.fragmentAssetId ||
        seenAssets.has(segment.fragmentAssetId) ||
        !isPositiveInteger(segment.frameCount) ||
        !isSha256(segment.rpuSha256) ||
        !Array.isArray(segment.metadataLevels)) return null;
    seenAssets.add(segment.fragmentAssetId);
    summedFrames += segment.frameCount;
    if (!Number.isSafeInteger(summedFrames)) return null;
    for (const level of segment.metadataLevels) {
      if (typeof level !== 'number' || !Number.isSafeInteger(level) ||
          ![1, 2, 3, 4, 5, 6, 8, 9, 10, 11].includes(level)) return null;
      levels.add(level);
    }
  }
  if (summedFrames !== value.totalRpuFrameCount) return null;

  const verifiedCounts: Record<string, number> = {};
  const entries = Object.entries(value.verifiedMetadataLevelFrameCounts);
  if (entries.length !== levels.size) return null;
  for (const [level, count] of entries) {
    if (!/^(?:[1-9]|1[01])$/.test(level) || !levels.has(Number(level)) ||
        !isPositiveInteger(count) || count > summedFrames) return null;
    verifiedCounts[level] = count;
  }

  return {
    resourceId: expectedResourceId,
    variantAssetId: expectedVariantAssetId,
    segmentCount: value.segmentCount,
    totalRpuFrameCount: summedFrames,
    rpuFrameAlignment: 'frame-count-matches-video-samples',
    metadataLevels: [...levels].sort((left, right) => left - right),
    graphSha256: value.graph.graphSha256,
    verifiedParserVersion: value.verifiedParserVersion,
    verifiedMetadataLevelFrameCounts: verifiedCounts,
    orderedRpuEvidenceSha256: value.orderedRpuEvidenceSha256,
  };
}
