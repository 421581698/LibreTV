# LibreTV TestSprite project instructions

You are testing the LibreTV frontend on an isolated PR Preview. Build a durable regression suite from `testsprite/libretv-coverage-brief.md`.

Rules:
- Use only the exact Preview URL supplied for this run. Never use production.
- Prefer stable accessible roles, names and labels; avoid CSS implementation selectors.
- Cover homepage, header navigation, search form, query routing, category shortcuts, search history, empty states and safe watch-route handling.
- Do not depend on third-party media catalog contents or source uptime. Distinguish provider/environment outages from product regressions.
- Never claim playback succeeded without observing actual time progression.
- Never invent fixture data or assume a configured video source.
- Review every proposed case and assertion for deterministic behavior before applying it.
- Do not create account, delete source, purchase, or persistently mutate settings.
- Do not create tests for features that are not implemented.
- Treat Chromium mobile viewport emulation as responsive coverage only, not physical iPhone/iPad Safari acceptance.
- Physical device checks for iOS/iPadOS, WebKit media, microphone, audio and touch must be recorded separately in `quality-engine/device-registry.json`.
- Preserve failure screenshots, steps, video and logs under the TestSprite result artifacts; never commit secrets, session data or raw authenticated HTML.
