# SSRF DNS rebinding: connect-time policy (PR #99)

## Current security boundary

The existing preflight validates literal URL, A/AAAA records and each redirect.
That alone is not sufficient: the hostname may resolve differently between
preflight and the socket connection.

- **Node 22/24:** All outbound requests made through `fetch-utils.ts` use
  `node-guarded-fetch.ts`. Its Undici dispatcher validates every A/AAAA socket
  lookup response and dials only an address from that same checked callback.
  HTTPS SNI, certificate validation and HTTP Host remain the original hostname.
  Mixed public+private answers fail closed; connection retries also use the
  guarded lookup. Streaming bodies retain their dispatcher's socket lifetime.
- **Cloudflare Workers:** Wrangler entrypoints already specify
  `global_fetch_strictly_public`. The Workers platform fetch takes the
  responsibility for public-only network connections. The Node socket agent is
  not used in this runtime. A deployment lacking that compatibility flag must
  not be treated as connection-verified.
- **Unknown runtimes:** If the guarded Node agent is unavailable, the request
  fails rather than falling back to an unchecked Node fetch.

**Scope:** These rules cover requests routed through the centralized
`fetch-utils.ts` APIs. Direct `fetch()` calls in other server modules need
an independent audit; this change does not claim that every outgoing request
in the repository is automatically covered.

## Acceptance still required

- Run an isolated attacker-controlled DNS server that first resolves a public
  address at preflight, then returns private/metadata IP at actual socket lookup.
- Verify the socket is never opened, including redirects, retries and IPv6.
- Verify public HTTPS certificate/SNI, streaming HTTP-FLV and HLS Range response
  bodies continue to work on Node and the Cloudflare Preview runtime.
- Inspect all remaining user-controlled server egress call sites.
- No test requires modifying production origins or fetching cloud metadata.
