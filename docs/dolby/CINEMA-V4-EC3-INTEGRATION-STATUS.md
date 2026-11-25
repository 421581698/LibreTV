# Cinema V4.0 — Dolby EC-3/JOC integrated engineering batch

**PR:** #99 (Draft). **Branch:** `feature/libretv-ipad-edition-product`.

## What has actually landed

- `src/lib/dolby/ec3-syncframe-scanner.ts`: read-only, bounded **raw elementary-stream** E-AC-3 syncframe candidate detection. It validates syncword, reserved stream type, frame-size field, E-AC-3 `bsid=16`, sample-rate field and incomplete-frame boundaries, and exposes offsets/sizes for the caller.
- `ec3-syncframe-scanner.test.ts`: synthetic frame and malformed-header fixtures only.
- iPad Edition Verify includes `src/lib/dolby/**` in both push and PR path filters. This runs the module in the standard TypeScript/Vitest validation; workflow success remains independent of real-media acceptance.

**No raw source is downloaded or fetched by the parser.** `scanEc3Syncframes` accepts only raw E-AC-3 elementary-stream bytes supplied explicitly by a future demuxer. Never feed it a complete HLS playlist, MPEG-TS container or ISO BMFF/fMP4 segment and assume it extracts the embedded track.

## Five tasks: current evidence and blockers

| Requested work | Implemented now | Still necessary before calling complete |
|---|---|---|
| (1) Rust/C → WASM build | Not implemented | Reproducible, licensed upstream revision; actual target compilation; WASM runtime tests on supported browsers |
| (2) E-AC-3 JOC raw bytes extraction | **Partial:** syncframe candidate scanner for pre-extracted elementary bytes | TS/PES or fMP4 demux, selected audio-track routing, timestamps, real stream fixtures, CRC/integrity tests |
| (3) Object decode/reconstruction | Not implemented | Legal and codec-accurate JOC decoder, real fixtures and reconstruction validation; OpenJOC reconstruction ≠ authored master |
| (4) Object rendering and A/V sync | Not implemented | Safe AudioWorklet/output pipeline, clock synchronization and fallback, verified renderer and headphone/speaker tests |
| (5) iPad Safari performance/output/license | Not verified | Real hardware, iPadOS/Safari version, source identification, measurements, receiver/output evidence where appropriate, license review |

## Security and claims

- All parsing must remain read-only and disabled from automatic playback routing until explicitly validated. Preserve native Safari HLS and existing ArtPlayer/hls.js fallback.
- A candidate header is **not** evidence of valid encoded audio or Atmos/JOC metadata. The scanner cannot detect or decode JOC, verify CRC, render sound, or prove output.
- Do not label the product "Dolby Atmos supported", or set `decoded`, `rendered`, or `output verified` based on header matches.
- Synthetic fixtures are not proof of real copyrighted media compatibility.
- Keep physical iPad Safari verification and license approval as separate hard gates; CI cannot replace them.

## Integration contract for the next implementation

A demuxer must provide selected **raw EC-3 elementary-stream bytes** with track identity and presentation timestamps. Call the scanner on bounded chunks, retain `data.subarray(remainderOffset)` across chunk boundaries, then validate full frame payloads and transport continuity before invoking any decoder. Decoder and renderer must stay isolated from the production playback path and explicitly opt-in in PR #99 Preview only.

No changes to `main`, production deployment, or PR merge are authorized.
