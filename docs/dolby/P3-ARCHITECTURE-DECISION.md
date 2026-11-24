# P3 Architecture Decision Record: Independent Spatial Media Session

- Status: Accepted architecture / isolated MP4-WebM and HLS paths implemented; full P3 pending
- Date: 2026-11-24
- Scope: Dolby Immersive Audio Engine 2.0, P3
- Branch: `feature/libretv-ipad-edition-product` (PR #99 remains Draft)

## Context

PlayerShell creates an ArtPlayer instance and reuses its `art.video` element while providers and episodes change. Existing playback paths include direct MP4/WebM, hls.js over MSE, and Safari native HLS. Some direct-media and native-HLS transitions may remove or change CORS attributes.

A `MediaElementAudioSourceNode` is bound to one media element for that element's lifetime. Disconnecting the graph does not restore the browser-native audio route, and a second source node cannot safely be created for the same captured element. Attaching Web Audio to the existing reusable `art.video` could therefore break later source transitions or native fallback.

## Decision

Do not attach the spatial engine to the existing reusable `art.video`.

A spatial playback session must own a distinct media element and an isolated player/session controller. The existing ArtPlayer element remains the native playback route and recovery target. The session controller owns the spatial element, its source/track lifecycle, Web Audio graph, and teardown.

The initial implementation must be opt-in. Native playback remains the default and must continue to work when spatial prerequisites are absent or fail.

Implementation note (2026-11-24): `SpatialMediaSession` now supports direct MP4/WebM and an independently owned HLS path via a distinct media element and a two-step prepare/gesture activation UI. When hls.js is supported, the session owns a separate hls.js/MSE instance; otherwise Safari can use a separate native-HLS media element. The original ArtPlayer element and original HLS instance remain untouched and are the fallback. The spatial HLS audio-track selector is isolated; declared stereo metadata can enable stereo HRTF, while six-channel/unknown layouts remain bypassed. On teardown, the selected track is restored to the original native route when the platform exposes it. This is core P3 code, not P3 acceptance: real manifest/segment/key CORS, full browser lifecycle, Preview and Safari/iOS device checks remain pending.

## Session model

1. **Idle** — no spatial element or graph exists; native player is authoritative.
2. **Preparing** — allocate the isolated media element; configure source-specific CORS mode before assigning `src`; attach event handlers; inspect the source and required audio-track metadata.
3. **Awaiting activation** — wait for a direct user gesture. Create/resume AudioContext and bind the element only within that gesture path. Never synthesize a gesture or bypass autoplay policy.
4. **Active** — isolated element and graph own spatial playback. Keep playback state, selected source, selected audio track, volume, playback rate, and time position synchronized through explicit controller commands.
5. **Recovering** — on CORS failure, unsupported source/track, media error, AudioContext failure, or graph failure, stop spatial routing and restore playback through the untouched native element.
6. **Disposed** — remove listeners, stop tracks where applicable, pause and detach the isolated source, disconnect nodes, close the AudioContext when owned, and release references. Disposal must be idempotent.

Only one spatial session may be active for a given PlayerShell instance. A generation/session token must invalidate stale asynchronous work after episode changes, source changes, or disposal.

## Source and CORS policy

- Set `crossOrigin` / the `crossorigin` attribute before assigning the media URL.
- Require an explicit source policy and a successful CORS-capable response for Web Audio capture; do not infer safety from URL shape or same-origin assumptions alone.
- A failed or opaque CORS response is a hard fallback condition. Do not attempt to capture the native `art.video` as a workaround.
- For hls.js/MSE, validate the media element's CORS mode and every relevant manifest, playlist, segment, key, and audio rendition request under the actual browser path.
- For direct MP4/WebM, validate the final response and redirects.
- The existing Safari native-HLS playback path remains the default and is never repurposed. An opt-in experimental session may use a separate native-HLS media element, but it is not device-verified and must not be described as Safari-accepted.
- Unknown audio layout or track metadata must bypass channel-specific routing. Never infer 5.1 ordering from a channel count alone.

## Source and track transitions

- Episode/provider/source changes invalidate the active session token before asynchronous teardown or setup begins.
- Prepare the new spatial source independently; do not mutate the old native element.
- Audio-track selection must be based on the actual track identity exposed by the active playback path. If the isolated path cannot reproduce the selected track, fall back to native playback.
- A source/track transition is committed only after the isolated element is ready and the session remains current. Otherwise discard it and recover natively.
- Preserve user-visible playback state where supported: current time, paused/playing state, volume, muted state, and playback rate. If seeking is not safely transferable, explain the fallback rather than silently claiming continuity.

## Native fallback contract

Fallback is mandatory on unsupported source types, missing/invalid CORS, unknown required layout, failed user activation, AudioContext rejection, media/manifest/segment errors, track mismatch, stale session token, and unexpected teardown.

Fallback sequence:
1. Mark the spatial session unavailable and prevent further graph writes.
2. Capture the last safe playback position and user playback state when available.
3. Dispose the isolated spatial session.
4. Restore the selected source and track on the untouched native ArtPlayer route.
5. Restore time/state where supported and report the reason in diagnostics without exposing URLs, tokens, or private rendition names.

The fallback path must never depend on disconnecting a Web Audio graph from `art.video`, because that element must never have been captured.

## UI contract

- Spatial audio is an explicit opt-in control and must expose clear states: Off, Preparing, Active, and Unavailable/Fell back.
- The control must not imply Dolby Atmos decode, object rendering, or bitstream passthrough.
- Source and audio-track controls must reflect the actual selected native or spatial session state.
- If spatial playback cannot support the chosen source or track, keep the native controls functional and explain that spatial processing is unavailable for that selection.
- Do not show an Atmos badge based only on codec strings, JOC markers, channel count, or metadata.

## Non-goals and hard boundaries

- This ADR does not implement E-AC-3 JOC, AC-4, TrueHD, MAT, or any other Dolby decoder.
- This ADR does not implement Atmos object metadata parsing, object rendering, head tracking, or bitstream passthrough.
- Web Audio stereo HRTF virtualization is not Dolby Atmos.
- Do not modify production deployment configuration, merge PR #99, or change the main branch.
- Preserve the existing ArtPlayer, hls.js, direct-media, and Safari native-HLS routes by default.

## Acceptance gates

P3 is not complete until the lifecycle matrix in `P3-LIFECYCLE-TEST-MATRIX.md` passes, CI is green for the exact head SHA, the isolated iPad Preview audit succeeds for that SHA, and real Safari/iOS/iPad device checks are separately recorded. Architecture documentation alone is not implementation or acceptance evidence.
