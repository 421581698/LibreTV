# Home Page Contract

- Purpose: media discovery and access to current recommendations.
- Hierarchy: approved homepage baseline first; real recommendation content and posters remain primary.
- Data: reuse existing Douban, Bangumi, hot-list, and current homepage data contracts; never synthesize poster filler.
- Visual: follow root DESIGN.md and the currently approved LibreTV homepage reference. Do not replace an approved baseline with a generic Runway/Spotify clone.
- Responsive: preserve first-screen content priorities, poster visibility, safe areas, and existing navigation.
- Protected: recommendation APIs, Friday runtime (except explicitly scoped presentation removal), routing, and persistence.
- Acceptance: desktop/tablet/phone, light/dark, real data loading, no overflow, screenshot comparison, navigation regression tests.
