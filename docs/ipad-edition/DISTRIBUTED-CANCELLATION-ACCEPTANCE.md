# Distributed chat cancellation (PR #99, staged only)

The existing in-process cancellation Map cannot cancel a request executing on
another server instance. The optional shared coordinator uses Upstash Redis REST
with two **server-side secret** environment variables:

- `UPSTASH_REDIS_REST_URL` (HTTPS root URL)
- `UPSTASH_REDIS_REST_TOKEN` (private bearer token)

Both must be set on **every** serving instance. They have deliberately **not**
been set on the current preview or production deployments.

The cancellation API writes a 120-second, user-scoped cancellation ticket to
the shared service, then performs the existing local cancellation. Registered
streams poll every 500 ms and release their timers on completion. If a
configured coordinator cannot be reached, the active request aborts and a
cancel request returns HTTP 503 instead of reporting false distributed success.
With no shared coordinator, local cancellations still work; a request unknown
to that instance returns `cross-instance-unavailable` (503), not a misleading
success. If a deployment does not support the shared backend, this feature
cannot be marked distributed-acceptance PASS.

### Acceptance checklist

1. Use two separate instances with different process-local Maps, both connected
   to the same dedicated test Redis database.
2. Open a long-lived authenticated stream on instance A; obtain its SSE
   `requestId`; route `/api/chat/cancel` to instance B.
3. Confirm instance B publishes the cancellation ticket, instance A observes it,
   aborts LLM and tools, and sends a terminal cancellation frame.
4. Repeat for cancellation before registration, instance restart, wrong user
   and Redis outage. Verify no timers remain after stream completion.
5. Never put the REST token in `wrangler.toml`, client JavaScript, or CI logs.

This change does **not** configure external infrastructure, alter production
routing, or claim two-instance verification without that test.
