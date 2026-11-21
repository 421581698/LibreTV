import { describe, expect, it } from 'vitest';
import { detectTimelineDiscontinuity, measureAvSync, mediaTicksToSeconds, presentationTimeSeconds } from './av-sync';

describe('media clock conversion', () => {
  it('converts independent track timescales and composition offsets', () => {
    expect(mediaTicksToSeconds(90_000, 90_000)).toBe(1);
    expect(presentationTimeSeconds({ decodeTime: 180_000, compositionTimeOffset: -900, timescale: 90_000 })).toBe(1.99);
  });

  it('rejects invalid timescales', () => {
    expect(() => mediaTicksToSeconds(1, 0)).toThrow(/timescale/i);
  });
});

describe('measureAvSync', () => {
  const video = { decodeTime: 90_000, compositionTimeOffset: 0, timescale: 90_000 };
  it('treats a small presentation difference as synchronized', () => {
    expect(measureAvSync(video, { decodeTime: 48_500, timescale: 48_000 }).status).toBe('synced');
  });

  it('reports audio ahead and video ahead with signed offsets', () => {
    expect(measureAvSync(video, { decodeTime: 52_800, timescale: 48_000 }).status).toBe('audio-ahead');
    expect(measureAvSync(video, { decodeTime: 43_200, timescale: 48_000 }).status).toBe('video-ahead');
  });
});

describe('detectTimelineDiscontinuity', () => {
  const previous = { decodeTime: 0, duration: 1000, timescale: 1000 };
  it('recognizes continuous, gap, overlap and reset boundaries', () => {
    expect(detectTimelineDiscontinuity(previous, { decodeTime: 1010, timescale: 1000 }).kind).toBe('continuous');
    expect(detectTimelineDiscontinuity(previous, { decodeTime: 1500, timescale: 1000 }).kind).toBe('gap');
    expect(detectTimelineDiscontinuity(previous, { decodeTime: 800, timescale: 1000 }).kind).toBe('overlap');
    expect(detectTimelineDiscontinuity({ decodeTime: 5000, duration: 1000, timescale: 1000 }, { decodeTime: 0, timescale: 1000 }).kind).toBe('reset');
  });

  it('requires a known previous sample duration', () => {
    expect(() => detectTimelineDiscontinuity({ decodeTime: 0, timescale: 1000 }, { decodeTime: 1, timescale: 1000 })).toThrow(/duration/i);
  });
});
