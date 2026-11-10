import type { SourceConfig } from './types';

export interface SourceHealthSnapshot {
  ok: boolean;
  ms?: number;
  failStreak: number;
  timestamp: number;
}

const HEALTH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Put recently proven, responsive VOD sources first.
 * Unknown sources keep their relative order and are not penalized;
 * failed sources remain available as fallbacks unless separately disabled.
 */
export function rankSourcesByHealth<T extends Pick<SourceConfig, 'key'>>(
  sources: T[],
  health: Record<string, SourceHealthSnapshot | undefined>,
  now = Date.now(),
): T[] {
  return sources
    .map((source, index) => {
      const entry = health[source.key];
      const fresh = entry && now >= entry.timestamp &&
        now - entry.timestamp <= HEALTH_TTL_MS;
      const status = !fresh ? 1 : entry.ok ? 2 : 0;
      const latency = fresh && entry.ok && Number.isFinite(entry.ms) && (entry.ms ?? 0) > 0
        ? entry.ms!
        : Number.POSITIVE_INFINITY;
      const failStreak = fresh ? Math.max(0, entry.failStreak || 0) : 0;
      return { source, index, status, latency, failStreak, timestamp: fresh ? entry.timestamp : 0 };
    })
    .sort((a, b) =>
      b.status - a.status ||
      a.latency - b.latency ||
      a.failStreak - b.failStreak ||
      b.timestamp - a.timestamp ||
      a.index - b.index
    )
    .map(({ source }) => source);
}
