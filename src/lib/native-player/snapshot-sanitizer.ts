import type { PlaybackSnapshot } from './types';

export type SafePlaybackSnapshot = Omit<PlaybackSnapshot, 'source' | 'error'> & {
  error: { code: string; recoverable: boolean } | null;
};

/** Remove media URLs, error messages and causes before exposing snapshots to window events. */
export function sanitizePlaybackSnapshot(snapshot: PlaybackSnapshot): SafePlaybackSnapshot {
  const { source: _source, error, ...safe } = snapshot;
  return {
    ...safe,
    error: error ? { code: error.code, recoverable: error.recoverable } : null,
  };
}
