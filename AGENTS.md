# LibreTV Agent Instructions

## Mandatory quality verification

After completing or modifying any LibreTV feature, bug fix, refactor, or user-visible behavior, run the LibreTV Quality Engine before reporting the work complete.

1. Read `docs/testing/TESTSPRITE-QUALITY-ENGINE.md` and follow its acceptance policy.
2. Run `npm run quality:verify` (lint, TypeScript, and all Vitest suites).
3. Run the browser smoke on a built/running local or isolated Preview environment:
   - Install the isolated runner when needed: `npm install --no-save --package-lock=false playwright@1.55.0`
   - Start the app using the project's supported local Preview/start command.
   - Run `npm run quality:smoke`.
4. When `TESTSPRITE_API_KEY` and `TESTSPRITE_PROJECT_ID` are configured, run the relevant saved TestSprite suite with `testsprite run --project "$TESTSPRITE_PROJECT_ID" --wait`. For PR Preview CI, use the repository's `quality-engine.yml` workflow and `testsprite ci run`; do not invent or substitute CLI flags.
5. If TestSprite credentials/project/tests are not configured, state **NOT CONFIGURED / NOT RUN**. Never label a skipped or unavailable test as passed.
6. For changes affecting iOS/iPadOS, media decoding, touch, audio, microphone permissions, or WebKit behavior, require separate physical iPhone and/or iPad Safari acceptance. Chromium mobile emulation is not real-device acceptance.
7. Preserve test evidence and distinguish product failures from environment, network, and third-party failures. Fix regressions and rerun the affected tests before reporting completion.

## Repository safety boundaries

- Work on an isolated Feature Branch and Preview.
- Do not modify `main` unless explicitly authorized.
- Do not approve or merge PRs automatically.
- Do not deploy production without explicit authorization.
- Never commit API keys, credentials, real user data, or TestSprite evidence artifacts.
- Do not claim CI, Preview, or real-device acceptance without checking the actual result.
