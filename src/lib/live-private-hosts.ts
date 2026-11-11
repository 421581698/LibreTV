/**
 * Explicit origin allowlist for private IPTV upstreams.
 *
 * LIVE_ALLOW_PRIVATE is only an opt-in switch; it is not sufficient on its own.
 * A deployment must also list exact HTTP(S) origins in LIVE_PRIVATE_ORIGINS.
 * Matching scheme + hostname + port prevents an allowed host from implicitly
 * exposing every service port on the same private machine.
 */
function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function isLivePrivateHostAllowed(urlString: string): boolean {
  if (process.env.LIVE_ALLOW_PRIVATE !== '1') return false;

  const targetOrigin = normalizeOrigin(urlString);
  if (!targetOrigin) return false;

  const allowlist = (process.env.LIVE_PRIVATE_ORIGINS ?? '')
    .split(',')
    .map(normalizeOrigin)
    .filter((origin): origin is string => origin !== null);

  return allowlist.includes(targetOrigin);
}
