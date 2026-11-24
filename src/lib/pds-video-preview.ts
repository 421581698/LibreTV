/**
 * Server-side adapter for the official Alibaba Cloud PDS video-preview API.
 *
 * Do not call this from browser code: access/share tokens must remain on the
 * server. PDS preview URLs are short-lived HLS/MP4 URLs, not DASH manifests.
 */
export type PdsPreviewCategory = 'live_transcoding' | 'quick_video' | 'offline_video';

export interface PdsVideoPreviewInput {
  domainId: string;
  fileId: string;
  accessToken?: string;
  shareId?: string;
  shareToken?: string;
  driveId?: string;
  category?: PdsPreviewCategory;
  templateId?: string;
  urlExpireSec?: number;
  getMasterUrl?: boolean;
}

export interface PdsPreviewRendition {
  templateId: string;
  url: string;
  category: PdsPreviewCategory;
}

export type PdsVideoPreviewResult =
  | { status: 'pending'; retryAfterSeconds: number }
  | { status: 'ready'; renditions: PdsPreviewRendition[]; masterUrl?: string };

export class PdsPreviewError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_INPUT' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'FEATURE_DISABLED' | 'UPSTREAM_ERROR' | 'INVALID_RESPONSE',
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'PdsPreviewError';
  }
}

interface PdsPreviewEntry { template_id?: string; status?: string; url?: string }

interface PdsPreviewResponse {
  Code?: string;
  code?: string;
  Message?: string;
  message?: string;
  video_preview_play_info?: {
    live_transcoding_task_list?: PdsPreviewEntry[];
    quick_video_list?: PdsPreviewEntry[];
    offline_video_transcoding_list?: PdsPreviewEntry[];
    master_url?: string;
  };
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function isPdsPending(status: number, body: PdsPreviewResponse): boolean {
  return status === 202 || body.Code === 'VideoPreviewWaitAndRetry' || body.code === 'VideoPreviewWaitAndRetry';
}

export async function getPdsVideoPreviewPlayInfo(
  input: PdsVideoPreviewInput,
  fetcher: typeof fetch = fetch,
): Promise<PdsVideoPreviewResult> {
  const domainId = input.domainId.trim();
  const fileId = input.fileId.trim();
  const usingShare = Boolean(input.shareId);
  const token = usingShare ? input.shareToken : input.accessToken;

  if (!/^[a-zA-Z0-9-]{2,64}$/.test(domainId) || !/^[^\u0000-\u001f]{1,256}$/.test(fileId) ||
      !token || token.length > 8192 ||
      (usingShare ? !input.shareToken : !input.driveId)) {
    throw new PdsPreviewError('PDS preview credentials or identifiers are incomplete', 'INVALID_INPUT', 400);
  }

  const category = input.category ?? 'quick_video';
  const urlExpireSec = input.urlExpireSec ?? 900;
  if (!['live_transcoding', 'quick_video', 'offline_video'].includes(category)) {
    throw new PdsPreviewError('Unsupported PDS preview category', 'INVALID_INPUT', 400);
  }
  if (!Number.isInteger(urlExpireSec) || urlExpireSec < 60 || urlExpireSec > 14400) {
    throw new PdsPreviewError('urlExpireSec must be between 60 and 14400 seconds', 'INVALID_INPUT', 400);
  }
  if (input.templateId && (input.templateId.length > 128 || /[\u0000-\u001f]/.test(input.templateId))) {
    throw new PdsPreviewError('Invalid PDS template id', 'INVALID_INPUT', 400);
  }

  // Domain-specific API hostname is fixed by PDS; user input cannot select an arbitrary host.
  const endpoint = `https://${domainId}.api.aliyunpds.com/v2/file/get_video_preview_play_info`;
  const body: Record<string, unknown> = {
    domain_id: domainId,
    file_id: fileId,
    category,
    url_expire_sec: urlExpireSec,
    get_master_url: input.getMasterUrl === true && category === 'quick_video',
  };
  if (input.templateId) body.template_id = input.templateId;
  if (usingShare) body.share_id = input.shareId;
  else body.drive_id = input.driveId;

  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(usingShare
          ? { 'x-share-token': input.shareToken! }
          : { Authorization: `Bearer ${input.accessToken}` }),
      },
      body: JSON.stringify(body),
      redirect: 'error',
      cache: 'no-store',
    });
  } catch {
    throw new PdsPreviewError('Unable to reach the official PDS preview endpoint', 'UPSTREAM_ERROR', 502);
  }

  let data: PdsPreviewResponse;
  try {
    data = await response.json() as PdsPreviewResponse;
  } catch {
    throw new PdsPreviewError('PDS returned an unreadable preview response', 'INVALID_RESPONSE', response.status);
  }

  if (isPdsPending(response.status, data)) {
    return { status: 'pending', retryAfterSeconds: 3 };
  }
  if (response.status === 401 || response.status === 403) {
    throw new PdsPreviewError('PDS authorization expired or lacks preview permission', 'UNAUTHORIZED', response.status);
  }
  if (response.status === 404) {
    throw new PdsPreviewError('PDS has no preview result for this file', 'NOT_FOUND', 404);
  }
  const upstreamCode = data.Code ?? data.code ?? '';
  if (response.status === 400 && /PreviewDisabled|Transcode.*Disabled/i.test(upstreamCode)) {
    throw new PdsPreviewError('PDS video transcoding is not enabled for this domain/category', 'FEATURE_DISABLED', 400);
  }
  if (!response.ok) {
    throw new PdsPreviewError('PDS preview request failed', 'UPSTREAM_ERROR', response.status);
  }

  const info = data.video_preview_play_info;
  if (!info) throw new PdsPreviewError('PDS response is missing video preview information', 'INVALID_RESPONSE', 502);

  const lists: Array<[PdsPreviewCategory, PdsPreviewEntry[] | undefined]> = [
    ['live_transcoding', info.live_transcoding_task_list],
    ['quick_video', info.quick_video_list],
    ['offline_video', info.offline_video_transcoding_list],
  ];
  const renditions: PdsPreviewRendition[] = [];
  for (const [kind, entries] of lists) {
    for (const entry of entries ?? []) {
      if (entry.status === 'finished' && isHttpsUrl(entry.url)) {
        renditions.push({
          templateId: entry.template_id ?? 'default',
          url: entry.url,
          category: kind,
        });
      }
    }
  }

  const masterUrl = isHttpsUrl(info.master_url) ? info.master_url : undefined;
  if (!renditions.length && !masterUrl) {
    throw new PdsPreviewError('PDS preview is not ready or returned no usable HTTPS playback URL', 'INVALID_RESPONSE', 502);
  }
  return { status: 'ready', renditions, ...(masterUrl ? { masterUrl } : {}) };
}
