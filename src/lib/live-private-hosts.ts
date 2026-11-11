/**
 * Explicit allowlist for private IPTV hosts.
 *
 * LIVE_ALLOW_PRIVATE is only an opt-in switch; it is not sufficient on its own.
 * A deployment must also list exact hostnames/IP literals in LIVE_PRIVATE_HOSTS.
 * Exact matching prevents an allowed suffix from implicitly trusting attacker
 * controlled sibling domains.
 */
function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

export function isLivePrivateHostAllowed(urlString: string): boolean {
  if (process.env.LIVE_ALLOW_PRIVATE !== '1') return false;

  let hostname: string;
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    hostname = normalizeHost(url.hostname);
  } catch {
    return false;
  }

  const allowlist = (process.env.LIVE_PRIVATE_HOSTS ?? '')
    .split(',')
    .map(normalizeHost)
    .filter(Boolean);

  return allowlist.includes(hostname);
}
