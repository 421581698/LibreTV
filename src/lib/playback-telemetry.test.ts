import { describe, expect, it } from 'vitest';
import {
  mergePlaybackHealth,
  rankSourcesByPlaybackHealth,
  rankSourcesByPlaybackQuality,
  rankMovieCandidatesByQuality,
  scorePlaybackHealth,
  type PlaybackHealthMap,
} from './playback-telemetry';

describe('playback telemetry', () => {
  it('aggregates real playback samples without storing media URLs', () => {
    const health = mergePlaybackHealth({}, [
      {
        sourceKey: 'source-a',
        resourceKey: 'source-a:movie-1',
        timestamp: 10_000,
        startupMs: 1_000,
        throughputKbps: 8_000,
        mediaBitrateKbps: 4_000,
        selectedRenditionIndex: 3,
        selectedRenditionHeight: 2160,
        selectedRenditionBitrateKbps: 18_000,
        height: 2160,
        stalls: 0,
        fatalErrors: 0,
        playedSeconds: 600,
      },
    ], 10_000);
    expect(health['source-a'].heightMax).toBe(2160);
    expect(health['source-a'].startupMsAvg).toBe(1_000);
    expect(JSON.stringify(health)).toContain('"selectedRenditionIndex":3');
    expect(JSON.stringify(health)).toContain('"selectedRenditionHeight":2160');
    expect(JSON.stringify(health)).toContain('"selectedRenditionBitrateKbps":18000');
    expect(JSON.stringify(health)).not.toContain('https://');
  });

  it('expires stale samples and rejects future-dated observations', () => {
    const now = 8 * 24 * 60 * 60 * 1000;
    const health = mergePlaybackHealth({}, [
      { sourceKey: 'stale', resourceKey: 'stale:1', timestamp: 1 },
      { sourceKey: 'future', resourceKey: 'future:1', timestamp: now + 1_000 },
    ], now);
    expect(health).toEqual({});
  });

  it('requires enough playback evidence before scoring', () => {
    expect(scorePlaybackHealth({
      sampleCount: 1,
      lastSampleAt: 10_000,
      recoveryCount: 0,
      playedSeconds: 30,
    })).toBeNull();
  });

  it('ranks measured sources first and preserves order for unknown sources', () => {
    const healthy: PlaybackHealthMap = {
      good: {
        sampleCount: 3,
        lastSampleAt: 10_000,
        startupMsAvg: 800,
        throughputKbpsAvg: 12_000,
        mediaBitrateKbpsAvg: 4_000,
        heightMax: 2160,
        stallsPerHour: 0,
        fatalErrorsPerHour: 0,
        recoveryCount: 0,
        playedSeconds: 900,
      },
      poor: {
        sampleCount: 3,
        lastSampleAt: 10_000,
        startupMsAvg: 12_000,
        throughputKbpsAvg: 1_000,
        mediaBitrateKbpsAvg: 5_000,
        stallsPerHour: 8,
        fatalErrorsPerHour: 2,
        recoveryCount: 5,
        playedSeconds: 900,
      },
    };
    const ranked = rankSourcesByPlaybackHealth(
      [{ key: 'unknown' }, { key: 'poor' }, { key: 'good' }],
      healthy,
      10_000,
    );
    expect(ranked.map((source) => source.key)).toEqual(['good', 'poor', 'unknown']);
  });

  it('can aggregate per-resource health independently from source health', () => {
    const sample = { sourceKey: 'source-a', resourceKey: 'source-a:movie:2', timestamp: 10_000, height: 1080, playedSeconds: 300 };
    const source = mergePlaybackHealth({}, [sample], 10_000, 'source');
    const resource = mergePlaybackHealth({}, [sample], 10_000, 'resource');
    expect(Object.keys(source)).toEqual(['source-a']);
    expect(Object.keys(resource)).toEqual(['source-a:movie:2']);
  });

  it('prioritizes sustainable high-resolution, high-bitrate sources over faster but lower-quality sources', () => {
    const health: PlaybackHealthMap = {
      low: {
        sampleCount: 4, lastSampleAt: 10_000, startupMsAvg: 500,
        throughputKbpsAvg: 8_000, mediaBitrateKbpsAvg: 5_000,
        heightMax: 1080, stallsPerHour: 0, fatalErrorsPerHour: 0,
        recoveryCount: 0, playedSeconds: 1_200,
      },
      high: {
        sampleCount: 4, lastSampleAt: 10_000, startupMsAvg: 2_000,
        throughputKbpsAvg: 24_000, mediaBitrateKbpsAvg: 12_000,
        heightMax: 2160, stallsPerHour: 0, fatalErrorsPerHour: 0,
        recoveryCount: 0, playedSeconds: 1_200,
      },
      unstable4k: {
        sampleCount: 4, lastSampleAt: 10_000, startupMsAvg: 300,
        throughputKbpsAvg: 4_000, mediaBitrateKbpsAvg: 15_000,
        heightMax: 2160, stallsPerHour: 3, fatalErrorsPerHour: 0,
        recoveryCount: 1, playedSeconds: 1_200,
      },
    };
    const ranked = rankSourcesByPlaybackQuality(
      [{ key: 'low' }, { key: 'unstable4k' }, { key: 'high' }, { key: 'unknown' }],
      health,
      10_000,
    );
    expect(ranked.map((source) => source.key)).toEqual(['high', 'low', 'unknown', 'unstable4k']);
  });

  it('chooses the best measured source for the same exact movie while retaining unknown fallbacks', () => {
    const candidates = [
      { sourceKey: 'source-unknown', vodId: 'movie-1' },
      { sourceKey: 'source-1080', vodId: 'movie-1' },
      { sourceKey: 'source-4k', vodId: 'movie-1' },
    ];
    const quality = {
      'source-1080:movie-1': { from: 'play' as const, height: 1080, timestamp: 10_000 },
      'source-4k:movie-1': { from: 'play' as const, height: 2160, timestamp: 10_000 },
    };
    const health: PlaybackHealthMap = {
      'source-1080': {
        sampleCount: 3, lastSampleAt: 10_000, throughputKbpsAvg: 12_000,
        mediaBitrateKbpsAvg: 5_000, recoveryCount: 0, playedSeconds: 600,
      },
      'source-4k': {
        sampleCount: 3, lastSampleAt: 10_000, throughputKbpsAvg: 24_000,
        mediaBitrateKbpsAvg: 12_000, recoveryCount: 0, playedSeconds: 600,
      },
    };
    const ranked = rankMovieCandidatesByQuality(candidates, quality, health, 10_000);
    expect(ranked.map((item) => item.sourceKey)).toEqual([
      'source-4k', 'source-1080', 'source-unknown',
    ]);
  });

  it('uses this movie episode history before the source-wide average', () => {
    const candidates = [
      { sourceKey: 'source-a', vodId: 'movie-1' },
      { sourceKey: 'source-b', vodId: 'movie-1' },
    ];
    const quality = {
      'source-a:movie-1': { from: 'play' as const, height: 2160, timestamp: 10_000 },
      'source-b:movie-1': { from: 'play' as const, height: 1080, timestamp: 10_000 },
    };
    const sourceHealth: PlaybackHealthMap = {
      'source-a': {
        sampleCount: 5, lastSampleAt: 10_000, throughputKbpsAvg: 30_000,
        mediaBitrateKbpsAvg: 12_000, recoveryCount: 0, playedSeconds: 1_000,
      },
      'source-b': {
        sampleCount: 5, lastSampleAt: 10_000, throughputKbpsAvg: 12_000,
        mediaBitrateKbpsAvg: 5_000, recoveryCount: 0, playedSeconds: 1_000,
      },
    };
    const resourceHealth: PlaybackHealthMap = {
      'source-a:movie-1:0': {
        sampleCount: 3, lastSampleAt: 10_000, throughputKbpsAvg: 2_000,
        mediaBitrateKbpsAvg: 12_000, recoveryCount: 2, playedSeconds: 600,
      },
    };
    const ranked = rankMovieCandidatesByQuality(
      candidates, quality, sourceHealth, 10_000, resourceHealth,
    );
    expect(ranked.map((item) => item.sourceKey)).toEqual(['source-b', 'source-a']);
  });

  it('ignores expired title-specific 4K probe evidence', () => {
    const candidates = [
      { sourceKey: 'source-old-4k', vodId: 'movie-1' },
      { sourceKey: 'source-unknown', vodId: 'movie-1' },
    ];
    const quality = {
      'source-old-4k:movie-1': {
        from: 'probe' as const, height: 2160, timestamp: 1,
      },
    };
    const ranked = rankMovieCandidatesByQuality(
      candidates, quality, {}, 31 * 24 * 60 * 60 * 1000,
    );
    expect(ranked.map((item) => item.sourceKey)).toEqual([
      'source-old-4k', 'source-unknown',
    ]);
  });

  it('does not trust expired high-bitrate evidence for quality ordering', () => {
    const ranked = rankSourcesByPlaybackQuality(
      [{ key: 'unmeasured' }, { key: 'old-4k' }],
      {
        'old-4k': {
          sampleCount: 8,
          lastSampleAt: 1,
          throughputKbpsAvg: 40_000,
          mediaBitrateKbpsAvg: 18_000,
          heightMax: 2160,
          recoveryCount: 0,
          playedSeconds: 3_600,
        },
      },
      8 * 24 * 60 * 60 * 1000,
    );
    expect(ranked.map((source) => source.key)).toEqual(['unmeasured', 'old-4k']);
  });

  it('keeps source order stable when no source has enough fresh playback evidence', () => {
    const ranked = rankSourcesByPlaybackQuality(
      [{ key: 'b' }, { key: 'a' }],
      {},
      10_000,
    );
    expect(ranked.map((source) => source.key)).toEqual(['b', 'a']);
  });

  it('does not mutate the input health map', () => {
    const input: PlaybackHealthMap = {};
    mergePlaybackHealth(input, [], 10_000);
    expect(input).toEqual({});
  });
});
