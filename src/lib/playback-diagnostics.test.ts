import { describe, expect, it, vi } from 'vitest';
import { getBufferedAheadSeconds, getFragmentQualityEvidence, readPlaybackQualityCounters } from './playback-diagnostics';

function ranges(items: Array<[number, number]>) {
  return {
    length: items.length,
    start: (index: number) => {
      if (!items[index]) throw new DOMException('Range not found', 'IndexSizeError');
      return items[index][0];
    },
    end: (index: number) => {
      if (!items[index]) throw new DOMException('Range not found', 'IndexSizeError');
      return items[index][1];
    },
  };
}

describe('fragment quality evidence', () => {
  it('uses byte and timing statistics from the same fragment', () => {
    expect(getFragmentQualityEvidence({ loaded: 1_000_000, loading: { start: 100, end: 1_100 } }, 4))
      .toEqual({ throughputKbps: 8_000, mediaBitrateKbps: 2_000 });
  });

  it('falls back to total bytes when loaded bytes are unavailable', () => {
    expect(getFragmentQualityEvidence({ total: 500_000, loading: { start: 0, end: 500 } }, 2))
      .toEqual({ throughputKbps: 8_000, mediaBitrateKbps: 2_000 });
  });

  it('rejects incomplete, zero-duration, and invalid fragment statistics', () => {
    expect(getFragmentQualityEvidence(undefined, 4)).toBeUndefined();
    expect(getFragmentQualityEvidence({ loaded: 100, loading: { start: 2, end: 2 } }, 4)).toBeUndefined();
    expect(getFragmentQualityEvidence({ loaded: 100, loading: { start: 0, end: 10 } }, 0)).toBeUndefined();
    expect(getFragmentQualityEvidence({ loaded: Number.NaN, total: -1, loading: { start: 0, end: 10 } }, 4)).toBeUndefined();
  });
});

describe('playback diagnostics', () => {
  it('measures the buffered range containing the playhead', () => {
    expect(getBufferedAheadSeconds(ranges([[0, 12], [20, 30]]), 5)).toBe(7);
    expect(getBufferedAheadSeconds(ranges([[0, 12], [20, 30]]), 25)).toBe(5);
  });

  it('returns zero when the playhead is outside buffered ranges', () => {
    expect(getBufferedAheadSeconds(ranges([[0, 8], [12, 20]]), 10)).toBe(0);
    expect(getBufferedAheadSeconds(ranges([[0, 8]]), 9)).toBe(0);
  });

  it('handles invalid time values and changing TimeRanges safely', () => {
    expect(getBufferedAheadSeconds(ranges([[0, 8]]), Number.NaN)).toBe(0);
    const unstable = { length: 1, start: () => { throw new Error('changed'); }, end: () => 8 };
    expect(getBufferedAheadSeconds(unstable, 2)).toBe(0);
    expect(getBufferedAheadSeconds(undefined, 2)).toBe(0);
  });

  it('reads standard browser frame counters', () => {
    const video = {
      getVideoPlaybackQuality: vi.fn(() => ({
        totalVideoFrames: 120,
        droppedVideoFrames: 3,
      })),
    };
    expect(readPlaybackQualityCounters(video)).toEqual({ totalFrames: 120, droppedFrames: 3 });
  });

  it('falls back to WebKit frame counters', () => {
    expect(readPlaybackQualityCounters({
      webkitDecodedFrameCount: 90,
      webkitDroppedFrameCount: 2,
    })).toEqual({ totalFrames: 90, droppedFrames: 2 });
  });

  it('returns undefined when counters are unavailable or throw', () => {
    expect(readPlaybackQualityCounters({})).toBeUndefined();
    expect(readPlaybackQualityCounters({
      getVideoPlaybackQuality: () => { throw new Error('unsupported'); },
    })).toBeUndefined();
  });
});
