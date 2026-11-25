# Native Dolby Audio Adapter Contract

Status: interface specification only. The current LibreTV repository is a Next.js/TypeScript web application; it does not contain iOS/Xcode or Android/Gradle application targets. This document is the integration contract for future native shells, not an implementation or a claim of native Dolby output.

## Goals

- Keep web playback ownership with ArtPlayer + hls.js / Safari native HLS.
- Let a separately built native shell report platform decoder and output facts without making browser JavaScript impersonate the operating system.
- Keep native-reported facts separate from independently verified device acceptance.
- Make capability changes, route changes, decoder failures and source changes observable.
- Never infer Atmos from an E-AC-3 codec string, JOC manifest marker, Android Spatializer availability, or HRTF processing alone.

## Platform responsibilities

### iOS / iPadOS adapter (future Swift target)

Candidate platform APIs:
- AVFoundation / AVPlayer for native media playback and track inspection.
- AVAudioSession for category, route and interruption observations.
- Supported device/OS audio pipeline reporting where exposed by the platform.

The adapter must report only facts exposed by public platform APIs. AVAudioSession route information does not, by itself, prove that Dolby Atmos object rendering is active. Do not claim that Safari JavaScript can read the native AVPlayer or AVAudioSession state.

### Android adapter (future Kotlin target)

Candidate platform APIs:
- Media3 / ExoPlayer for track selection and decoder capability.
- MediaCodecList for codec support.
- AudioManager and Spatializer for spatializer availability, enabled state and compatible-route information.

Spatializer availability or an enabled flag does not prove that a Dolby decoder processed JOC or that a Dolby Atmos output route is active. Report these as separate facts.

## Version 1 message contract

A native shell may expose a versioned bridge only from its trusted top-level application context. The web app must not accept native capability claims from arbitrary iframe messages, query-string parameters, media manifests or third-party scripts.

Suggested snapshot shape:

~~~ts
interface NativeAudioSnapshotV1 {
  version: 1;
  platform: 'ios' | 'ipados' | 'android';
  sessionId: string;
  capturedAtMs: number;
  device: {
    osVersion: string;
    appVersion: string;
  };
  input: {
    codec: string | null;
    channels: number | null;
    sampleRateHz: number | null;
    jocMarker: 'present' | 'absent' | 'unknown';
  };
  decoder: {
    state: 'idle' | 'supported' | 'active' | 'failed' | 'unknown';
    codec: string | null;
  };
  spatializer: {
    available: boolean | null;
    enabled: boolean | null;
  };
  output: {
    route: 'built-in-speaker' | 'wired-headphones' | 'bluetooth' | 'hdmi' | 'unknown';
    nativeDolbyState: 'reported-active' | 'reported-inactive' | 'unsupported' | 'unknown';
    jocDecodeState: 'reported-active' | 'reported-inactive' | 'unsupported' | 'unknown';
    objectRenderState: 'reported-active' | 'reported-inactive' | 'unsupported' | 'unknown';
  };
}
~~~

The reported-* vocabulary is deliberate. A bridge message is a platform adapter report, not independent proof of the physical acoustic output. The diagnostics UI must label it “native app reports” until the exact device/OS/route combination has passed recorded acceptance.

## Lifecycle and trust rules

1. The native shell creates a fresh opaque session ID for each source/session and clears the previous snapshot on source change.
2. Snapshots are timestamped and updated on track, decoder, route, interruption, foreground/background and spatializer changes.
3. The web layer rejects malformed versions, invalid enum values, missing session IDs and stale snapshots.
4. A snapshot for an old session must never overwrite the current session.
5. Do not send media URLs, authorization headers, cookies, account IDs or signed query parameters through the bridge.
6. Bridge messages are advisory UI/diagnostic state. They must not bypass the player's existing source ownership or silently switch the media pipeline.
7. Native Dolby output, JOC decoding, object rendering, spatializer availability and physical route are separate fields and separate acceptance criteria.
8. If the bridge is absent, stale or invalid, the UI reports “unknown” and keeps ordinary playback unchanged.

## Acceptance evidence required before implementation can be called complete

- iOS: Xcode build, supported-device list, AVPlayer track/decoder evidence, route-change logs and real iPhone/iPad playback record.
- Android: Gradle build, Media3/MediaCodec track evidence, Spatializer state, route-change logs and real Android playback record.
- JOC: licensed decoder/source audit, real E-AC-3 JOC fixtures, access-unit decode evidence, object metadata reconstruction and renderer output.
- Output: exact device model, OS build, application build, source hash/codec, selected track, output route, captured logs and repeatable test steps.
- Performance: CPU, memory, audio underruns, end-to-end latency, thermal behavior and long-playback results.

## Current implementation boundary

The web repository currently provides browser API inventory, HLS metadata inspection, conservative HRTF routing, evidence-based diagnostics and fail-open behavior. It does not contain either native application target or a JOC decoder/object renderer. Do not mark those gates complete until the corresponding native code and physical evidence exist.



## Web-side bridge validation now implemented

The web repository now includes `src/lib/native-audio-bridge.ts` and
`src/lib/native-audio-bridge.test.ts`. The validator:

- accepts only the version-1 schema and known platform/route/state enums;
- checks session identity, timestamp freshness and future-clock skew;
- bounds codec, channel-count and sample-rate values;
- copies only declared fields, dropping unexpected properties such as URLs or
  authorization material; and
- formats native values as “native app reports”, never as independent proof of
  acoustic output.

This is a web-side contract validator only. It does not create an iOS or
Android application target, collect platform facts, decode JOC, or establish
that a reported output state is true. The native shell must still authenticate
the bridge source and invoke the validator only from its trusted top-level
application context.
