# JOC Decoder Adoption Review

Status: candidate identified; integration is not yet approved or shipped.
Review date: 2026-11-25.

## Candidate

- Project: [OpenJOC](https://github.com/chyinan/OpenJOC)
- Reviewed release: `v0.20.2`
- Release commit: `f9b54bbbb8e1b44c746a72e1b14b289cad418cf9`
- Repository license metadata and workspace package license: Apache-2.0.
- Core implementation: Rust; the workspace contains an E-AC-3/JOC decoder, scene/metadata components, a C ABI crate and a browser-facing WASM crate.
- The upstream release is independent and explicitly not affiliated with or endorsed by Dolby.

## Why it is a credible candidate

The upstream project provides a real E-AC-3 JOC decoding path rather than only parsing a JOC marker. Its browser WASM crate exposes a bounded elementary-stream input interface, decoder status, PCM output and optional object-position reporting. The upstream WASM workflow builds both embedded-HRTF and external-HRTF variants and runs bridge tests against the generated module.

The upstream project documents supported E-AC-3 JOC profiles and explicit limits. Its own bridge test asserts `native_dolby_decoder_used == false`; this is a software decoder and renderer, not a native Dolby decoder. Its binaural/spatial-rendering path is experimental and profile-bounded. Reconstructed carrier-local objects are not the original authored Atmos stems, and renderer equivalence to native JOC playback is not claimed.

## License and redistribution boundary

The OpenJOC core workspace is marked Apache-2.0. Before vendoring, linking, shipping a WASM binary or redistributing an application bundle, LibreTV must still:

1. pin the exact source commit and preserve the upstream LICENSE and required notices;
2. audit the complete transitive dependency graph and every optional integration feature;
3. audit the selected HRTF data separately from source-code licensing and preserve its attribution;
4. avoid pulling in optional FFmpeg/GStreamer/LAV/mpv integration packages unless separately reviewed;
5. generate an SBOM and reproducible build manifest for the exact shipped artifact; and
6. complete a legal review of applicable codec patents, trademarks and distribution obligations.

Apache-2.0 source licensing is not a patent clearance for every codec implementation, a Dolby license, Dolby certification, or permission to use Dolby marks in a way that implies endorsement.

## Integration decision

**Recommended direction: evaluate OpenJOC as the software JOC decoder candidate, but do not yet add it to the production playback path.**

Preferred architecture:

- Keep ArtPlayer + hls.js / Safari native HLS as the existing playback owner.
- For a future native app shell, use the upstream C ABI or a narrowly scoped Rust static library after platform build and source/license review.
- For a browser experiment, build the upstream WASM crate from the pinned source and keep it behind an explicit opt-in feature flag. It must not silently take ownership of the existing media element.
- Keep native platform bitstream passthrough, software JOC decoding, object rendering and HRTF binaural rendering as distinct modes.
- If the current HLS pipeline cannot safely expose complete E-AC-3 access units with timestamps, discontinuities and dependent substreams, do not splice a partial byte stream into the decoder. A separate, explicitly designed demux/decode pipeline would be required.

## Required integration gates

| Gate | Required evidence | State |
|---|---|---|
| Upstream source/license pin | Exact commit, license and notice inventory | Reviewed candidate; not vendored |
| Dependency/SBOM audit | Complete target-specific dependency closure | Not complete |
| WASM build in LibreTV CI | Pinned source build, both HRTF modes, artifact hash | Not run |
| Decoder integration | Complete E-AC-3 access units, dependent substreams, PTS/discontinuity handling | Not implemented |
| Renderer integration | Bounded PCM queue, object metadata timeline, underrun/cancel/teardown | Not implemented |
| Real JOC fixtures | Authorized fixtures and independently checked expected output | Not run |
| Native iOS/Android builds | Static library builds for supported targets and bridge integration | Not implemented |
| Device acceptance | Real device/route playback, CPU, memory, latency and thermal evidence | Not run |

## Important distinction

A successful OpenJOC decode or software binaural render would support a label such as “software JOC decode” or “software binaural spatial render” only when the corresponding runtime evidence is present. It must not be labeled “native Dolby Atmos output”. Native passthrough requires separate platform and route evidence; Dolby certification is a separate external process.
