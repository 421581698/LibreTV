# KKPhim integration

LibreTV exposes the fixed-origin KKPhim API through `/api/kkphim`. The adapter never accepts an arbitrary upstream URL.

## Supported actions

- `GET /api/kkphim?action=home`
- `GET /api/kkphim?action=list&type=phim-bo&page=1`
- `GET /api/kkphim?action=search&keyword=...`
- `GET /api/kkphim?action=detail&slug=...`
- `GET /api/kkphim?action=images&slug=...`
- `GET /api/kkphim?action=people&slug=...`
- `GET /api/kkphim?action=keywords&slug=...`
- `GET /api/kkphim?action=tmdb&kind=movie&id=...`

List filters supported by the upstream contract include `category`, `country`, `year`, `sort_field`, `sort_type`, and `sort_lang`.

## Safety and data semantics

- The upstream origin is fixed to `https://phimapi.com`; callers cannot turn this route into an open proxy.
- Requests use the existing outbound fetch/SSRF/redirect policy and have a 4 MiB streamed response ceiling.
- Media URLs are metadata from the provider, not proof of playback availability, ownership, resolution, or authorization.
- Episode parsing prefers a supplied HTTPS HLS URL and falls back to an HTTPS embed URL. It does not bypass login, subscription, CAPTCHA, DRM, or access controls.
- Do not mirror or redistribute media unless the relevant rights and permissions have been established.
- Search results use the stable provider identity `kkphim`; playback integration must keep KKPhim episode routing distinct from Apple CMS `?ac=videolist` parsing.

## Upstream contract

See https://kkphim2.com/api-document. The documented API base is https://phimapi.com.
