export type MediaPlaybackKind = 'hls' | 'mp4' | 'webm' | 'unsupported';

/**
 * Resolve only formats the current PlayerShell can actually route.
 * Unknown legacy URLs retain the historical HLS assumption; DASH is explicitly
 * rejected rather than being mislabeled as HLS or silently sent to the browser.
 */
export function getMediaPlaybackKind(rawUrl: string, declaredType?: string): MediaPlaybackKind {
  if (declaredType === 'dash' || declaredType === 'unsupported') return 'unsupported';
  if (declaredType === 'hls' || declaredType === 'mp4' || declaredType === 'webm') return declaredType;
  let pathname = rawUrl;
  try {
    pathname = new URL(rawUrl, 'https://libretv.invalid').pathname;
  } catch {
    return 'unsupported';
  }

  const path = pathname.toLowerCase();
  if (path.endsWith('.mpd')) return 'unsupported';
  if (/\.(mp4|m4v|mov)$/.test(path)) return 'mp4';
  if (path.endsWith('.webm')) return 'webm';
  if (path.endsWith('.m3u8')) return 'hls';

  // Keep compatibility with existing providers whose HLS URLs omit extensions.
  return 'hls';
}
