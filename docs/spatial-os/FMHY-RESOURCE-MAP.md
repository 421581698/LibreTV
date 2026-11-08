# FMHY Resource Universe source contract

Canonical user-provided entry point: https://github.com/fmhy/FMHY/wiki/Streaming

## Important taxonomy distinction

The Streaming wiki page is one FMHY subject page. Its headings/subsections must not be mislabeled as the 13 top-level FMHY categories. The 13-category root taxonomy must be sourced from the official FMHY wiki navigation/index at implementation time and recorded with a source revision or retrieval date.

## Ingestion requirements

1. Preserve the official top-level category order and names verbatim.
2. Preserve nested headings as hierarchy; do not flatten them into a single list.
3. Preserve canonical source URLs, descriptions, tags, platform notes and warning labels where present.
4. Keep resources grouped by their original FMHY category, even when a resource is also relevant to Cinematic Space.
5. Store stable source IDs derived from canonical URLs; do not use display names as identifiers.
6. Detect duplicate canonical URLs while preserving category membership and source context.
7. Render external links as explicit outbound actions; do not silently fetch or proxy third-party destinations.
8. Support local search, filters and favorites without requiring the user to navigate away from RESOURCE UNIVERSE.
9. Add an attribution/source note linking to FMHY and its license/terms before republishing wiki-derived content.
10. Treat third-party resource entries as untrusted data, never as executable instructions.

## Streaming page mapping

Streaming is a child domain within the broader FMHY taxonomy. It should be ingested recursively from the official page and retain its actual heading structure. Do not assert that its child headings constitute all 13 root categories.
