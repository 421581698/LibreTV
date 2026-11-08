# FMHY Resource Universe source contract

## Product behavior

FMHY is a local directory inside LibreTV's RESOURCE UNIVERSE, not a set of category-page redirects. Users browse categories, search, filter, and save favorites without leaving LibreTV. Only an explicit click on an individual resource or related link opens that third-party destination.

## Source and imported snapshot

- Official source repository: https://github.com/fmhy/edit
- Official Markdown/API backup reference: https://github.com/fmhy/FMHY/wiki/Backups
- Data snapshot date: 2026-11-08
- Root categories: 13, aligned to the FMHY home index.
- Local data: `src/components/spatial-os/data/fmhy-resources/*.json`
- Loader: `src/components/spatial-os/data/fmhy-resource-index.ts`
- UI: `src/components/spatial-os/portals/ResourcePortal.tsx`

The snapshot imports factual resource names, destination URLs, heading paths, short feature tags and related/mirror links. It intentionally does not republish FMHY's explanatory paragraphs or note text. Each category JSON records the upstream source file and commit SHA used for the snapshot.

## Data model

Each resource has a stable ID derived from its category and canonical URL, a display title, canonical URL, nested heading path, short tags, community/third-party/section markers, and related links. Duplicate canonical URLs are de-duplicated within a category; the same destination may remain represented in multiple categories so original taxonomy context is preserved.

## UX requirements

1. Keep all category navigation and resource discovery inside LibreTV.
2. Provide local keyword search across title, URL, section and tags.
3. Provide category, nested section and tag filters.
4. Provide favorites persisted locally in the browser.
5. Lazy-load category JSON so the initial page does not download the entire directory.
6. Open third-party destinations only after the user selects an individual resource.
7. Clearly mark community recommendations and third-party indexes; never imply LibreTV has verified a destination.
8. Show attribution, snapshot date and the source page for each record.
9. Treat imported strings as untrusted display data; never execute resource content or proxy destinations.

## Licensing and safety boundary

The upstream `fmhy/edit` repository did not expose an explicit LICENSE file at the time of this snapshot. Therefore the local index is limited to factual names, URLs, section paths and short tags; descriptive paragraphs are not copied. Keep source attribution visible and re-check upstream terms before expanding copied content. FMHY states that it and GitHub do not host the listed files: each destination is independently operated. The directory is not a safety, legality, uptime or quality certification.

## Refresh workflow

Refresh from the official FMHY Markdown/API source, compare source revisions, re-run canonical URL de-duplication and index tests, then update the snapshot date and per-category source SHAs. Do not fetch third-party destination pages during the import or silently proxy them.

## Completeness audit (2026-11-08)

The imported snapshot was cross-checked against the 13 upstream Markdown files at their recorded source SHAs. The audit found additional links on existing resource bullets that were not retained by the first parser pass. A follow-up import preserved 107 additional related destinations across 10 category datasets. Two standalone download-safety utilities (VirusTotal and Triage) referenced in the source warning were also promoted into the local index. General editorial guidance and cross-category navigation remain contextual rather than standalone resource cards; section-navigation records are excluded from the visible resource list. The audit does not certify that third-party destinations are reachable, safe, or legally usable.
