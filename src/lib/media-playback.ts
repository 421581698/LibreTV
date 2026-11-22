export type MediaPlaybackKind = 'hls' | 'dash' | 'mp4' | 'webm' | 'unsupported';

/**
 * Resolve only formats the current PlayerShell can actually route.
 * Unknown legacy URLs retain the historical HLS assumption. DASH is routed to
 * Shaka Player; it must never be mislabeled as HLS or sent to native <video>.
 */
export function getMediaPlaybackKind(rawUrl: string, declaredType?: string): MediaPlaybackKind {
  if (declaredType === 'unsupported') return 'unsupported';
  if (declaredType === 'hls' || declaredType === 'dash' || declaredType === 'mp4' || declaredType === 'webm') return declaredType;
  let pathname = rawUrl;
  try {
    pathname = new URL(rawUrl, 'https://libretv.invalid').pathname;
  } catch {
    return 'unsupported';
  }

  const path = pathname.toLowerCase();
  if (path.endsWith('.mpd')) return 'dash';
  if (/\.(mp4|m4v|mov)$/.test(path)) return 'mp4';
  if (path.endsWith('.webm')) return 'webm';
  if (path.endsWith('.m3u8')) return 'hls';

  // Keep compatibility with existing providers whose HLS URLs omit extensions.
  return 'hls';
}
