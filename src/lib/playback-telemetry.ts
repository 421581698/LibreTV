/**
 * Playback telemetry primitives.
 *
 * These records describe observed playback behavior, not search latency or
 * playlist-declared quality. Callers must never include media URLs or tokens.
 */

import type { QualityEntry } from './types';
import { isQualityEntryFresh } from './quality';

export interface PlaybackSample {
  sourceKey: string;
  /** Stable local identifier such as sourceKey:vodId; never a media URL. */
  resourceKey: string;
  timestamp: number;
  startupMs?: number;
  throughputKbps?: number;
  mediaBitrateKbps?: number;
  /** Selected HLS playlist rendition, distinct from the decoded video dimensions. */
  selectedRenditionIndex?: number;
  selectedRenditionHeight?: number;
  selectedRenditionBitrateKbps?: number;
  height?: number;
  stalls?: number;
  fatalErrors?: number;
  recoveries?: number;
  playedSeconds?: number;
}

export interface PlaybackHealthEntry {
  sampleCount: number;
  lastSampleAt: number;
  startupMsAvg?: number;
  throughputKbpsAvg?: number;
  mediaBitrateKbpsAvg?: number;
  heightMax?: number;
  stallsPerHour?: number;
  fatalErrorsPerHour?: number;
  recoveryCount: number;
  playedSeconds: number;
}

export type PlaybackHealthMap = Record<string, PlaybackHealthEntry>;

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SOURCES = 100;
const MAX_SAMPLES_PER_SOURCE = 10;

function finitePositive(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function boundedCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(10_000, value))
    : 0;
}

interface InternalEntry extends PlaybackHealthEntry {
  samples: PlaybackSample[];
}

/** Merge session observations into bounded, seven-day rolling source summaries. */
export function mergePlaybackHealth(
  current: PlaybackHealthMap,
  observations: PlaybackSample[],
  now = Date.now(),
  scope: 'source' | 'resource' = 'source',
): PlaybackHealthMap {
  const working: Record<string, InternalEntry> = {};

  for (const [key, entry] of Object.entries(current)) {
    const candidate = entry as InternalEntry;
    if (
      key &&
      Number.isFinite(candidate.lastSampleAt) &&
      now >= candidate.lastSampleAt &&
      now - candidate.lastSampleAt <= TTL_MS
    ) {
      working[key] = { ...candidate, samples: Array.isArray(candidate.samples) ? candidate.samples.slice(-MAX_SAMPLES_PER_SOURCE) : [] };
    }
  }

  for (const sample of observations) {
    if (!sample.sourceKey || !sample.resourceKey || !Number.isFinite(sample.timestamp)) continue;
    if (sample.timestamp > now || now - sample.timestamp > TTL_MS) continue;

    const key = scope === 'resource' ? sample.resourceKey : sample.sourceKey;
    const previous = working[key] ?? {
      sampleCount: 0,
      lastSampleAt: sample.timestamp,
      recoveryCount: 0,
      playedSeconds: 0,
      samples: [],
    };
    const clean: PlaybackSample = {
      sourceKey: sample.sourceKey,
      resourceKey: sample.resourceKey,
      timestamp: sample.timestamp,
      startupMs: finitePositive(sample.startupMs),
      throughputKbps: finitePositive(sample.throughputKbps),
      mediaBitrateKbps: finitePositive(sample.mediaBitrateKbps),
      selectedRenditionIndex: typeof sample.selectedRenditionIndex === 'number' && Number.isInteger(sample.selectedRenditionIndex) && sample.selectedRenditionIndex >= 0 ? sample.selectedRenditionIndex : undefined,
      selectedRenditionHeight: finitePositive(sample.selectedRenditionHeight),
      selectedRenditionBitrateKbps: finitePositive(sample.selectedRenditionBitrateKbps),
      height: finitePositive(sample.height),
      stalls: boundedCount(sample.stalls),
      fatalErrors: boundedCount(sample.fatalErrors),
      recoveries: boundedCount(sample.recoveries),
      playedSeconds: boundedCount(sample.playedSeconds),
    };
    const samples = [...previous.samples, clean].slice(-MAX_SAMPLES_PER_SOURCE);
    const average = (field: 'startupMs' | 'throughputKbps' | 'mediaBitrateKbps') => {
      const values = samples.map((item) => item[field]).filter((v): v is number => v !== undefined);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
    };
    const totalPlayed = samples.reduce((sum, item) => sum + (item.playedSeconds ?? 0), 0);
    const totalStalls = samples.reduce((sum, item) => sum + (item.stalls ?? 0), 0);
    const totalFatal = samples.reduce((sum, item) => sum + (item.fatalErrors ?? 0), 0);
    const maxHeight = samples.reduce((max, item) => Math.max(max, item.height ?? 0), 0);

    working[key] = {
      sampleCount: previous.sampleCount + 1,
      lastSampleAt: sample.timestamp,
      startupMsAvg: average('startupMs'),
      throughputKbpsAvg: average('throughputKbps'),
      mediaBitrateKbpsAvg: average('mediaBitrateKbps'),
      heightMax: maxHeight || undefined,
      stallsPerHour: totalPlayed > 0 ? totalStalls * 3600 / totalPlayed : undefined,
      fatalErrorsPerHour: totalPlayed > 0 ? totalFatal * 3600 / totalPlayed : undefined,
      recoveryCount: samples.reduce((sum, item) => sum + (item.recoveries ?? 0), 0),
      playedSeconds: totalPlayed,
      samples,
    };
  }

  return Object.fromEntries(
    Object.entries(working)
      .sort((a, b) => b[1].lastSampleAt - a[1].lastSampleAt)
      .slice(0, MAX_SOURCES),
  );
}

/** Null means there is not enough real playback evidence to rank this source. */
export function scorePlaybackHealth(entry: PlaybackHealthEntry | undefined, now = Date.now()): number | null {
  if (!entry || entry.sampleCount < 2 || entry.playedSeconds < 60) return null;
  if (!Number.isFinite(entry.lastSampleAt) || now < entry.lastSampleAt || now - entry.lastSampleAt > TTL_MS) return null;

  const startup = entry.startupMsAvg === undefined
    ? 0.5
    : Math.max(0, Math.min(1, 1 - entry.startupMsAvg / 15_000));
  const stalls = entry.stallsPerHour === undefined
    ? 0.5
    : Math.max(0, Math.min(1, 1 - entry.stallsPerHour / 12));
  const errors = entry.fatalErrorsPerHour === undefined
    ? 0.5
    : Math.max(0, Math.min(1, 1 - entry.fatalErrorsPerHour / 4));
  const recovery = Math.max(0, Math.min(1, 1 - entry.recoveryCount / Math.max(1, entry.sampleCount * 2)));
  const bitrate = entry.mediaBitrateKbpsAvg && entry.throughputKbpsAvg
    ? Math.max(0, Math.min(1, entry.throughputKbpsAvg / (entry.mediaBitrateKbpsAvg * 1.35)))
    : 0.5;

  return Math.round((startup * 0.15 + stalls * 0.3 + errors * 0.2 + recovery * 0.1 + bitrate * 0.25) * 100);
}

/** Rank only sources with sufficient playback evidence; ties and unknowns stay stable. */
export function rankSourcesByPlaybackHealth<T extends { key: string }>(
  sources: T[],
  health: PlaybackHealthMap,
  now = Date.now(),
): T[] {
  return sources
    .map((source, index) => ({
      source,
      index,
      score: scorePlaybackHealth(health[source.key], now),
    }))
    .sort((a, b) => {
      if (a.score === null && b.score === null) return a.index - b.index;
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score || a.index - b.index;
    })
    .map(({ source }) => source);
}


/**
 * Quality-first source ordering.
 *
 * A source is considered sustainable only when observed fragment throughput
 * has at least 25% headroom over the measured media bitrate. This is a ranking
 * signal, not a promise that a future stream will keep the same quality.
 */
export function rankSourcesByPlaybackQuality<T extends { key: string }>(
  sources: T[],
  health: PlaybackHealthMap,
  now = Date.now(),
): T[] {
  const eligible = (entry: PlaybackHealthEntry | undefined) =>
    Boolean(entry && entry.sampleCount >= 2 && entry.playedSeconds >= 60 &&
      Number.isFinite(entry.lastSampleAt) && now >= entry.lastSampleAt &&
      now - entry.lastSampleAt <= TTL_MS);

  return sources
    .map((source, index) => {
      const entry = health[source.key];
      const measured = eligible(entry) ? entry : undefined;
      const sustainable = measured?.mediaBitrateKbpsAvg && measured.throughputKbpsAvg
        ? measured.throughputKbpsAvg >= measured.mediaBitrateKbpsAvg * 1.25
        : undefined;
      return {
        source,
        index,
        measured,
        sustainableRank: sustainable === true ? 2 : sustainable === false ? 0 : 1,
        height: measured?.heightMax ?? 0,
        bitrate: measured?.mediaBitrateKbpsAvg ?? 0,
        stability: measured ? scorePlaybackHealth(measured, now) ?? -1 : -1,
      };
    })
    .sort((a, b) =>
      b.sustainableRank - a.sustainableRank ||
      b.height - a.height ||
      b.bitrate - a.bitrate ||
      b.stability - a.stability ||
      a.index - b.index
    )
    .map(({ source }) => source);
}


/** Rank exact-title source candidates using title-specific observed quality first. */
export function rankMovieCandidatesByQuality<T extends { sourceKey: string; vodId: string }>(
  candidates: T[],
  qualityMap: Record<string, QualityEntry | undefined>,
  sourceHealth: PlaybackHealthMap,
  now = Date.now(),
  resourceHealth: PlaybackHealthMap = {},
): T[] {
  return candidates
    .map((candidate, index) => {
      const storedQuality = qualityMap[`${candidate.sourceKey}:${candidate.vodId}`];
      const quality = storedQuality && isQualityEntryFresh(storedQuality, now) ? storedQuality : undefined;
      const resourcePrefix = `${candidate.sourceKey}:${candidate.vodId}:`;
      const resourceEntry = Object.entries(resourceHealth)
        .filter(([key, value]) => key.startsWith(resourcePrefix) &&
          value.sampleCount >= 2 && value.playedSeconds >= 60 &&
          Number.isFinite(value.lastSampleAt) && now >= value.lastSampleAt &&
          now - value.lastSampleAt <= TTL_MS)
        .map(([, value]) => value)
        .sort((a, b) => b.lastSampleAt - a.lastSampleAt)[0];
      // A movie/episode observation takes precedence over the source-wide average.
      const entry = resourceEntry ?? sourceHealth[candidate.sourceKey];
      const fresh = entry && entry.sampleCount >= 2 && entry.playedSeconds >= 60 &&
        Number.isFinite(entry.lastSampleAt) && now >= entry.lastSampleAt &&
        now - entry.lastSampleAt <= TTL_MS;
      const sustainable = fresh && entry.mediaBitrateKbpsAvg && entry.throughputKbpsAvg
        ? entry.throughputKbpsAvg >= entry.mediaBitrateKbpsAvg * 1.25
        : undefined;
      return {
        candidate,
        index,
        confidence: quality?.from === 'play' ? 2 : quality?.from === 'probe' ? 1 : 0,
        height: quality?.height ?? 0,
        sustainableRank: sustainable === true ? 2 : sustainable === false ? 0 : 1,
        bitrate: fresh ? entry.mediaBitrateKbpsAvg ?? 0 : 0,
      };
    })
    .sort((a, b) =>
      b.sustainableRank - a.sustainableRank ||
      b.confidence - a.confidence ||
      b.height - a.height ||
      b.bitrate - a.bitrate ||
      a.index - b.index
    )
    .map(({ candidate }) => candidate);
}
