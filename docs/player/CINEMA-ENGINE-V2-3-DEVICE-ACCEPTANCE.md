# Cinema Engine V2.3 — iPhone/iPad acceptance checklist

Status: **Not yet device-verified.** The Preview workflow includes Chromium mobile-viewport emulation for portrait, landscape, split-width resizing and JASSUB source cleanup. This is not WebKit/Safari and does not replace physical iPhone/iPad testing.

Record the exact PR head SHA and Preview deployment SHA before each run. Do not test a moving branch without recording the deployed commit.

## Test matrix

| Device / mode | Required checks | Result |
|---|---|---|
| iPhone Safari portrait | open player, play/pause, seek, source switch, subtitle menu | Not run |
| iPhone Safari landscape | controls remain reachable, video/caption overlay alignment, safe-area handling | Not run |
| iPhone rotation during playback | rotate portrait → landscape → portrait; no black frame, stuck canvas or duplicate audio | Not run |
| iPad Safari landscape | wide controls, timeline scrubbing, audio/subtitle panels, keyboard focus | Not run |
| iPad split view / Stage Manager | resize app width repeatedly; controls and JASSUB canvas stay aligned | Not run |
| iPad rotation during playback | rotate while playing and while paused; resume without losing timeline | Not run |
| iPhone/iPad background-resume | lock/unlock, app switch, Safari tab switch; no stale playback controller | Not run |
| Spatial audio | test only a CORS-safe source with explicit channel metadata; compare off/on and switch audio tracks | Not run |
| ASS/SSA | load local file, seek, rotate, disable/enable, change source, close player; verify worker cleanup | Not run |

## Playback-control acceptance

1. Start playback, pause and resume using ArtPlayer's visible controls.
2. Repeat with keyboard/remote controls where supported.
3. Seek by timeline drag, skip buttons and the application's existing player API.
4. Confirm exactly one video element and one active HLS/MSE owner.
5. Force a controller-unavailable path and confirm ArtPlayer fallback still works.
6. Switch source and episode; confirm the previous observer/controller cannot issue commands to the new session.

## Recovery and timeline acceptance

1. Seek forward/backward across fragment boundaries.
2. Simulate a network interruption and resume.
3. Switch rendition/audio track where the source offers alternatives.
4. Confirm a malformed fragment resets the diagnostic timeline without leaving playback stuck.
5. Capture Safari console and network logs for any decoder/MSE errors.

## Subtitles and spatial audio

- HLS/native subtitle track choice and enable state survive reload for the same source/episode.
- Font size and background opacity affect native/HLS captions.
- Local ASS/SSA renders via the self-hosted JASSUB worker; ASS file contents are currently session-only.
- ASS renderer is destroyed on source change and player close.
- Spatial audio is opt-in and must not activate without explicit channel metadata and a CORS-safe media element.
- Six-channel input remains bypassed unless its channel layout is verified; do not label it Atmos decoding.

## Evidence to attach

- Device model and iOS/iPadOS version
- Safari version
- Preview URL and deployed commit SHA
- Test date/time
- Pass/fail per row
- Screenshots or screen recording for layout/rotation
- Safari Web Inspector console/network capture for failures
