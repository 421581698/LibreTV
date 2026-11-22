/**
 * Builds a Shaka request filter for explicitly trusted DASH origins.
 *
 * Auth is opt-in. By default credentials are limited to the MPD origin so
 * Authorization headers/cookies can never leak to an unrelated BaseURL host.
 */
export interface DashRequestAuthOptions {
  headers?: Record<string, string>;
  /** Additional trusted origins for cross-origin BaseURL/segment hosts. */
  allowedOrigins?: string[];
  /** Send browser-managed cookies only when the provider explicitly requires them. */
  withCredentials?: boolean;
}

export interface DashNetworkRequest {
  uris: string[];
  headers: Record<string, string>;
  allowCrossSiteCredentials: boolean;
}

const FORBIDDEN_HEADERS = new Set([
  'accept-charset', 'accept-encoding', 'access-control-request-headers',
  'access-control-request-method', 'connection', 'content-length', 'cookie',
  'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive', 'origin',
  'permissions-policy', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via',
]);

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function sanitizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const safe: Record<string, string> = {};
  if (!headers) return safe;
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName || FORBIDDEN_HEADERS.has(normalizedName) ||
        normalizedName.startsWith('proxy-') || normalizedName.startsWith('sec-') ||
        !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) ||
        typeof value !== 'string' || /[\r\n]/.test(value)) {
      continue;
    }
    safe[name] = value;
  }
  return safe;
}

export function createDashRequestAuthFilter(
  options: DashRequestAuthOptions | undefined,
  manifestUrl: string,
): (request: DashNetworkRequest) => void {
  const manifestOrigin = normalizeOrigin(manifestUrl);
  const allowedOrigins = new Set<string>();
  if (manifestOrigin) allowedOrigins.add(manifestOrigin);
  for (const origin of options?.allowedOrigins ?? []) {
    const normalized = normalizeOrigin(origin);
    if (normalized) allowedOrigins.add(normalized);
  }
  const headers = sanitizeHeaders(options?.headers);
  const withCredentials = options?.withCredentials === true;

  return (request) => {
    if (!allowedOrigins.size || !request.uris.length) return;

    // Shaka can carry fallback URIs in one request. Only attach secrets when
    // every candidate is explicitly trusted; otherwise the filter fails closed.
    const trusted = request.uris.every((uri) => {
      const origin = normalizeOrigin(uri);
      return origin !== null && allowedOrigins.has(origin);
    });
    if (!trusted) return;

    Object.assign(request.headers, headers);
    if (withCredentials) request.allowCrossSiteCredentials = true;
  };
}
