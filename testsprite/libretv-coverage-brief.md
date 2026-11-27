# LibreTV — TestSprite frontend regression coverage brief

## Test target and constraints

Test only the public, isolated pull-request Preview supplied to TestSprite. Do not use production, private administration pages, real user accounts, personal data, or destructive actions. Use a synthetic search phrase such as `LibreTV QA smoke` and do not assume third-party media APIs are healthy.

The application is a Next.js client application. The homepage is `/`; the dedicated search entry is `/search`; submitting a query routes to `/search/results?q=<encoded-query>`; the watch page is URL-driven at `/watch?source=...&id=...&index=...&title=...`.

## Global acceptance rules

- Test observable user behavior, not implementation details or CSS class names.
- Prefer accessible roles, labels, and visible text. Avoid brittle positional selectors.
- Wait for meaningful UI state changes; do not rely on fixed sleeps.
- Capture a screenshot and the failing step for every failure.
- Distinguish application defects from unavailable third-party APIs, blocked network requests, missing catalog data, or Preview deployment failures.
- Never claim a media stream played unless the video element actually advanced and playback was observed.
- Do not use a production source or real credentials.
- If an assertion depends on a live provider (Douban, hot-list, or a user-configured video source), make the test conditional and report provider unavailability as an environment limitation rather than fabricating content.
- Do not perform purchase, account deletion, source deletion, or settings changes that persist beyond the test.

## Required frontend scenarios

### HOME-001 — Homepage initial render
1. Open `/` at desktop width.
2. Confirm the page returns successfully, the document has a title, and the main landmark is visible.
3. Confirm the homepage header and featured hero region render.
4. Allow recommendation content to resolve. If live recommendations fail, confirm the designed loading/error/empty fallback is visible and the page remains interactive.
5. Confirm there are no uncaught page errors or broken navigation caused by rendering.

Pass: homepage shell and primary content render; external catalog outage is not misreported as a product pass or failure.

### HOME-002 — Featured carousel controls
1. Open `/` and wait for at least two featured slides, if the provider returns them.
2. Select a visible slide indicator by its accessible label.
3. Confirm the active indicator changes and the featured title updates.
4. On a touch viewport, swipe horizontally and confirm the slide changes when at least two slides exist.
5. If fewer than two slides are available, record the scenario as blocked by unavailable fixture data rather than failed.

Pass: manual selection and swipe operate without accidental page navigation.

### NAV-001 — Header search entry
1. Open `/`.
2. Locate the header search entry using its accessible name.
3. Activate it.
4. Confirm navigation to `/search` and that the search input is visible and focused.

Pass: the search entry opens the dedicated search page.

### SEARCH-001 — Search form validation and typing
1. Open `/search`.
2. Submit the form with an empty input.
3. Confirm the page remains on `/search` and focus returns to the search input.
4. Type a synthetic phrase.
5. Confirm the input reflects the entered text.
6. Use the clear control and confirm the input is empty.
7. Type the phrase again and submit with Enter.

Pass: empty input does not navigate; clear and keyboard submission work.

### SEARCH-002 — Search navigation and results state
1. Open `/search`.
2. Enter `LibreTV QA smoke` and submit.
3. Confirm the URL becomes `/search/results?q=LibreTV%20QA%20smoke` (or equivalent correctly encoded query).
4. Confirm the results region displays a loading, results, empty, or recoverable error state.
5. If a recoverable error is shown, activate Retry and confirm another request is attempted.
6. Do not require a result card for the synthetic phrase; source availability is not deterministic.

Pass: correct query is carried into the results route and the UI remains recoverable.

### SEARCH-003 — Category shortcut
1. Open `/search`.
2. Select the visible `科幻` category card.
3. Confirm navigation to search results with the category query `科幻电影`.
4. Confirm a results/loading/empty/error state is visible.

Pass: category selection submits its intended query.

### SEARCH-004 — Search history
1. Submit a synthetic phrase through the search form.
2. Return to `/search`.
3. If recent history is enabled and the item is displayed, select it.
4. Confirm it reopens results with the same query.
5. Do not assume browser storage survives a new isolated context.

Pass: search history works within the current test context when available.

### HOME-003 — Continue watching empty state
1. Open `/` in a clean browser context.
2. Locate the `继续观看` section.
3. Confirm an empty-history explanation is shown when no history exists.
4. Do not create playback history using real media merely to satisfy this scenario.

Pass: empty state is clear and does not crash.

### PLAYER-001 — Watch route validation
1. Open `/watch` without source and video identifiers.
2. Confirm the app displays a safe loading, validation, or recoverable empty/error state.
3. Confirm the page does not crash or expose a blank, unresponsive screen.
4. Do not infer successful playback from the presence of a video element alone.

Pass: malformed or incomplete watch URLs are handled safely.

## Responsive viewport matrix

Run the applicable scenarios at:
- Desktop: 1365 × 900
- iPhone-like viewport: 390 × 844, touch enabled
- iPad-like viewport: 1024 × 1366, touch enabled

These are responsive browser emulations only. They do not establish physical iPhone/iPad Safari or WebKit acceptance.

## Separate manual / physical-device acceptance

The following require real devices and must not be marked passed by TestSprite cloud browser or Chromium emulation:
- iPhone Safari: touch hit targets, keyboard resize, safe areas, back navigation, playback user gesture, media controls, audio, microphone permission and background/foreground recovery.
- iPad Safari: iPad-specific navigation visibility and interaction, landscape/portrait layouts, player controls, touch/keyboard behavior and split-view resizing.
- WebKit media decoding, MSE/fMP4/HLS behavior, actual playback progression, subtitles and audio output.
- Friday ASR/TTS/VAD permission lifecycle and interruption on real microphone/speaker hardware.

Record device model, OS version, Safari version, Preview URL, commit SHA, exact steps, outcome and evidence in `quality-engine/device-registry.json`.

## Future feature coverage

When a feature is implemented, add tests for its real user-facing contract:
- Cinema player: play/pause, seek, control auto-hide/reveal, source switch, episode navigation, error recovery and progress persistence.
- iPhone/iPad player differences: independent navigation and touch behavior.
- Friday: orb entry, IDLE/LISTENING/THINKING/SPEAKING state transitions, ASR/TTS interruption and cleanup.
- Liquid Glass: click-through, layering, scrolling, theme, reduced motion and responsive layout.
- Resource management: safe source add/edit/disable flows using synthetic non-production data.

Do not create tests for unimplemented features and do not weaken assertions to make a failing feature green.
