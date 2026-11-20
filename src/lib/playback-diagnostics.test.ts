import { describe, expect, it, vi } from 'vitest';
import { getBufferedAheadSeconds, readPlaybackQualityCounters } from './playback-diagnostics';

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
