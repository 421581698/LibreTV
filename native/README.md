# Native Audio Adapter Modules

These are isolated platform libraries for a future trusted native shell. They are
not complete iOS/Android applications and are not wired into the current
Next.js browser playback path.

## iOS / iPadOS

The Swift package reads the current AVAudioSession output route and emits the
version-1 snapshot shape. It intentionally leaves native Dolby output, JOC
decode, object rendering and spatializer state unknown: public route metadata
does not prove those outcomes.

Run its package tests on macOS with:

```sh
swift test --package-path native/ios
```

## Android

The Android library reports the codec capability of the platform decoder for
`audio/eac3-joc`, the optional active output device supplied by the host
player, and Android Spatializer availability/enabled state where available.
A connected device list is not treated as the active route. Decoder support is
not treated as active decoding. All Dolby/JOC/object-render output states stay
unknown.

Build and test with Gradle 8.9 and JDK 17:

```sh
gradle -p native/android :libretv-audio-adapter:assembleDebug :libretv-audio-adapter:testDebugUnitTest
```

## Security and integration

- Do not expose a WebView JavaScript interface to arbitrary remote content.
- The native host must bind snapshots to a fresh playback session ID and send
  them only to the trusted top-level LibreTV context.
- The web-side validator in `src/lib/native-audio-bridge.ts` checks schema,
  session identity and freshness, but cannot authenticate the origin itself.
- Do not include media URLs, cookies, authorization headers or signed query
  parameters in bridge messages.
- These modules do not take over playback, extract compressed E-AC-3 access
  units, or invoke a JOC decoder.
- The current repository still has no complete Xcode app target, Android app
  target, WebView host integration, or physical-device acceptance record.

## JOC software decoder candidate

See [JOC Decoder Adoption Review](../docs/player/JOC-DECODER-ADOPTION-REVIEW.md)
for the pinned OpenJOC candidate, license review and integration gates.
