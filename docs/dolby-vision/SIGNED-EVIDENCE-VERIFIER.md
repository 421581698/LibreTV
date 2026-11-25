# Dolby Vision signed evidence verifier

This module is a server-side trust primitive. It is not a parser service and does not make a client-provided hash trustworthy.

- `signed-rpu-envelope.ts` verifies Ed25519 signatures over a canonical JSON payload.
- It pins a key ID, stable asset ID, issue/expiry window, strict parser report, full-scan scope, and the exact media SHA-256.
- Expected asset ID and SHA-256 MUST come from a trusted server-side asset registry or a trusted ingestion/playback gateway. Never pass values copied from the envelope or browser request as the expected values.
- The signing private key belongs only in the isolated parser service's secret store. The verifier receives only a public PEM key and expected key ID.
- Reports with detached RPU inputs, partial frame scans, expired signatures, unknown keys, tampering, asset mismatch, or digest mismatch fail closed.

## Current integration boundary

The player does not yet have a stable server-issued asset ID or a trusted full-object digest for each selected stream. External playback URLs may be mutable, segmented, or cross-origin; browser playback does not currently hash the exact complete media object. Consequently, this verifier is not called from the player and no RPU-positive UI state is exposed.

The remaining deployment integration requires:
1. A controlled Node/container parser service with pinned `dovi_tool`, strict upload/job limits, authenticated backend-only access, and Ed25519 signing.
2. A trusted media ingestion/catalogue registry that binds immutable asset IDs to exact byte digests.
3. A backend adapter that streams the exact registered object to the parser and verifies the returned envelope using server-trusted asset ID/digest.
4. A player API that returns only verified evidence for the currently selected stable asset ID.
5. Deployment secrets and key rotation configured outside source control.

No arbitrary URL fetch endpoint is provided: this avoids turning the parser service into an SSRF proxy. No media upload occurs from the browser without an explicit product flow and user consent.
