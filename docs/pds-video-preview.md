# Alibaba Cloud PDS video playback

LibreTV exposes a server-side adapter for the official PDS `GetVideoPreviewPlayInfo` API at `POST /api/pds/preview`.

The route is protected by LibreTV's existing API session guard. It accepts a short-lived access token for a drive file, or a share token for a shared file, and never stores either token. Responses are marked `Cache-Control: no-store`.

## Drive file

```http
POST /api/pds/preview
Content-Type: application/json

{
  "domainId": "your-pds-domain",
  "driveId": "your-drive-id",
  "fileId": "your-file-id",
  "accessToken": "your-access-token",
  "category": "quick_video",
  "getMasterUrl": true,
  "urlExpireSec": 900
}
```

## Shared file

```json
{
  "domainId": "your-pds-domain",
  "shareId": "your-share-id",
  "shareToken": "your-share-token",
  "fileId": "shared-file-id",
  "category": "quick_video"
}
```

A ready response contains signed HLS rendition URLs (and optionally a master M3U8 URL). Pass the selected URL to the existing LibreTV player as an HLS source; its existing hls.js / native Safari HLS path handles playback. A pending response means PDS is still transcoding; retry after the returned `retryAfterSeconds`.

## Important constraints

- This adapter is for Alibaba Cloud Drive and Photo Service (PDS) tenants, not automatically for consumer Aliyun Drive accounts.
- PDS video preview requires the corresponding transcoding category to be enabled on the tenant domain and may incur value-added service charges.
- PDS preview returns HLS or MP4 preview URLs, not DASH/MPD. The DASH/Shaka path is a separate capability for providers that actually supply MPD manifests.
- URLs are temporary signed URLs. Request fresh playback information when they expire; do not persist or rewrite the signatures.
- Share requests use `x-share-token` only; drive requests use `Authorization: Bearer`.
- Tokens are accepted in the authenticated POST body only, never in query strings. The route does not persist them or implement OAuth refresh/token storage.
