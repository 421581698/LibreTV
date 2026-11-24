import { describe, expect, it } from 'vitest';
import { beginStallWindow, endStallWindow, evaluatePlaybackHealth, getBufferedAheadSeconds, getPlaybackRetryDelayMs } from './playback-stability';

const base = {
  nowMs: 20_000,
  lastProgressAtMs: 19_000,
  bufferedAheadSeconds: 20,
  readyState: 4,
  networkState: 1,
  online: true,
  paused: false,
  ended: false,
};

describe('evaluatePlaybackHealth', () => {
  it('reports healthy playback with sufficient buffer', () => {
    expect(evaluatePlaybackHealth(base).health).toBe('healthy');
  });

  it('detects low buffer without forcing a source switch', () => {
    const report = evaluatePlaybackHealth({ ...base, bufferedAheadSeconds: 1.5 });
    expect(report.health).toBe('low-buffer');
    expect(report.shouldShowBuffering).toBe(true);
    expect(report.shouldOfferRetry).toBe(false);
  });

  it('distinguishes initial buffering from a long stall', () => {
    expect(evaluatePlaybackHealth({ ...base, readyState: 2, bufferedAheadSeconds: 0 }).health).toBe('buffering');
    const stalled = evaluatePlaybackHealth({ ...base, readyState: 4, lastProgressAtMs: 0 });
    expect(stalled.health).toBe('stalled');
    expect(stalled.shouldOfferRetry).toBe(true);
  });

  it('reports offline independently of buffer state', () => {
    expect(evaluatePlaybackHealth({ ...base, online: false }).health).toBe('offline');
  });

  it('detects dropped-frame degradation', () => {
    const report = evaluatePlaybackHealth({ ...base, droppedFrames: 30, totalFrames: 100 });
    expect(report.health).toBe('degraded');
    expect(report.droppedFrameRatio).toBe(0.3);
  });

  it('does not label intentional pause or ended playback as stalled', () => {
    expect(evaluatePlaybackHealth({ ...base, paused: true, lastProgressAtMs: 0 }).health).toBe('healthy');
    expect(evaluatePlaybackHealth({ ...base, ended: true, lastProgressAtMs: 0 }).health).toBe('healthy');
  });

  it('handles missing frame metrics and future progress timestamps', () => {
    const report = evaluatePlaybackHealth({ ...base, droppedFrames: null, totalFrames: null, lastProgressAtMs: 30_000 });
    expect(report.droppedFrameRatio).toBeNull();
    expect(report.stallDurationMs).toBe(0);
  });
});

describe('getPlaybackRetryDelayMs', () => {
  it('uses capped exponential backoff', () => {
    expect([0, 1, 2, 3, 8].map((attempt) => getPlaybackRetryDelayMs(attempt))).toEqual([500, 1000, 2000, 4000, 8000]);
  });

  it('handles invalid attempts deterministically', () => {
    expect(getPlaybackRetryDelayMs(-1)).toBe(500);
    expect(getPlaybackRetryDelayMs(1.5)).toBe(500);
  });
});

describe('getBufferedAheadSeconds', () => {
  it('returns the remaining buffered duration at the current playhead', () => {
    const ranges = { length: 1, start: () => 10, end: () => 30 } as unknown as TimeRanges;
    expect(getBufferedAheadSeconds(ranges, 12)).toBe(18);
  });

  it('returns zero when the playhead is outside buffered ranges', () => {
    const ranges = { length: 1, start: () => 10, end: () => 30 } as unknown as TimeRanges;
    expect(getBufferedAheadSeconds(ranges, 35)).toBe(0);
  });

  it('returns null when the TimeRanges object throws', () => {
    const ranges = { length: 1, start: () => { throw new Error('detached'); }, end: () => 0 } as unknown as TimeRanges;
    expect(getBufferedAheadSeconds(ranges, 12)).toBeNull();
  });
});


describe('read-only stall window measurement', () => {
  it('keeps the first waiting timestamp when duplicate waiting events arrive', () => {
    const started = beginStallWindow(null, 1_000);
    expect(beginStallWindow(started, 2_500)).toBe(1_000);
  });

  it('measures the completed waiting interval', () => {
    const started = beginStallWindow(null, 1_000);
    expect(endStallWindow(started, 3_837)).toBe(2_837);
  });

  it('does not report a stall when no waiting window was opened', () => {
    expect(endStallWindow(null, 5_000)).toBe(0);
  });

  it('clamps clock skew to a zero-length interval', () => {
    expect(endStallWindow(5_000, 4_000)).toBe(0);
  });
});
