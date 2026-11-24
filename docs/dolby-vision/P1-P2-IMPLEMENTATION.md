# LibreTV Dolby Vision Engine — P1/P2 implementation

Updated: 2026-11-24  
Branch: `feature/libretv-ipad-edition-product`  
Scope: declaration parsing and evidence-based metadata diagnostics only.

## P1 — Format and Profile declaration inspection

Implemented in `src/lib/dolby-vision/format-inspector.ts`:

- Strict full-token parsing for `dvhe`, `dvh1`, `dav1`, and `dva1` RFC 6381-style declarations.
- Extracts declared Profile and Level as numeric values.
- Distinguishes HEVC, AV1 and AVC codec families from the codec identifier, including Dolby's AVC identifiers `dva1` and `dvav`.
- Reads HLS `CODECS`, `SUPPLEMENTAL-CODECS`, and `VIDEO-RANGE` attributes.
- Handles quoted HLS attribute values and ignores URL query strings when identifying containers.
- Rejects malformed prefixes, trailing junk, missing digits and zero Profile/Level values.
- Keeps PQ/HLG video-range declarations separate from Dolby Vision detection.

P1 boundary: this is metadata declaration inspection. It does not parse HEVC/AV1/AVC elementary-stream bytes, validate RPU payloads, probe a decoder, or verify display output.

## P2 — RPU evidence and dynamic-metadata diagnostics

Implemented in `src/lib/dolby-vision/metadata-inspector.ts`:

- Separates manifest/codec declaration from actual RPU parser evidence.
- Requires a validated summary from an external parser such as dovi_tool/libdovi before reporting RPU presence.
- Reports RPU presence, parsed metadata levels, frame count and Profile consistency.
- Treats a parser-reported RPU with no parsed levels as dynamic-metadata unknown.
- Fails closed on malformed or incomplete parser summaries.
- Does not parse binary RPU payloads in the browser and does not bundle dovi_tool or libdovi into the web client.

P2 boundary: a parser summary is accepted as evidence only when produced by an actual reviewed parser invocation. Unit tests use synthetic summaries and are not real-stream RPU validation.

## Open acceptance gates

- Cross-check codec declarations against controlled, licensed Dolby Vision samples and matching HLS manifests.
- Run dovi_tool/libdovi against approved samples and record exact tool version, input hash, Profile, frame count and metadata levels.
- Add a server-side or offline analysis adapter only after runtime, licensing and deployment constraints are reviewed.
- Browser/device decoder support and actual Dolby Vision display output remain separate later phases.

## Safety and compatibility

- No existing ArtPlayer, hls.js, MSE, Safari native-HLS, Atmos or audio diagnostics code is modified by P1/P2.
- No automatic source switch, quality change, decoder override or playback restart is introduced.
- PR #99 remains Draft; no merge to main or production deployment is included.
