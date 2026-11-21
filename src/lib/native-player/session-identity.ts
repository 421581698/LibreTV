export interface PlaybackSessionIdentity {
  readonly sessionId: string;
  readonly generation: number;
}

export interface PlaybackEventEnvelope<TEvent> {
  readonly identity: PlaybackSessionIdentity;
  readonly sequence: number;
  readonly event: TEvent;
}

export interface PlaybackEventCursor {
  readonly identity: PlaybackSessionIdentity;
  readonly lastAcceptedSequence: number;
}

/**
 * Creates an immutable identity for one logical source generation.
 * Callers should inject a stable sessionId when deterministic identity is
 * required (for example, in tests or persisted event replay).
 */
export function createPlaybackSessionIdentity(
  sessionId: string,
  generation: number,
): PlaybackSessionIdentity {
  if (!sessionId.trim()) {
    throw new Error('Playback sessionId must be a non-empty string.');
  }
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error('Playback generation must be a non-negative safe integer.');
  }

  return Object.freeze({ sessionId, generation });
}

/**
 * Accepts only events from the current source generation and only when their
 * sequence is strictly newer than the last accepted event.
 *
 * This is deliberately pure so the controller, backend adapters and worker
 * bridges can share the same stale-event rule.
 */
export function isCurrentPlaybackEvent<TEvent>(
  cursor: PlaybackEventCursor,
  envelope: PlaybackEventEnvelope<TEvent>,
): boolean {
  return (
    envelope.identity.sessionId === cursor.identity.sessionId &&
    envelope.identity.generation === cursor.identity.generation &&
    Number.isSafeInteger(envelope.sequence) &&
    envelope.sequence > cursor.lastAcceptedSequence
  );
}

/** Creates a fresh cursor when a source generation becomes active. */
export function createPlaybackEventCursor(
  identity: PlaybackSessionIdentity,
): PlaybackEventCursor {
  return Object.freeze({
    identity,
    lastAcceptedSequence: 0,
  });
}
