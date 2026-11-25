import { describe, expect, it } from 'vitest';
import {
  advanceNativePlaybackObservation,
  emptyNativePlaybackObservation,
  type NativePlaybackSample,
} from './native-playback-observation';

const playing: NativePlaybackSample = {
  currentTime: 0,
  videoWidth: 1920,
  videoHeight: 1080,
  readyState: 3,
  paused: false,
  seeking: false,
  ended: false,
  mediaErrorCode: null,
};

describe('real HTMLVideoElement observation state machine', () => {
  it('does not claim playback based on metadata, playing event, or dimensions alone', () => {
    const start = emptyNativePlaybackObservation();
    const paused = advanceNativePlaybackObservation(start, 'sample', { ...playing, paused: true });
    expect(paused.status).toBe('waiting');
    const initial = advanceNativePlaybackObservation(paused, 'sample', playing);
    expect(initial.status).toBe('waiting');
    expect(initial.videoWidth).toBe(1920);
    expect(initial.progressedSeconds).toBe(0);
    expect(advanceNativePlaybackObservation(initial, 'sample', { ...playing, currentTime: 0.5 }).status).toBe('waiting');
  });

  it('records observed media timeline progression without claiming HDR or Dolby Vision', () => {
    const start = advanceNativePlaybackObservation(emptyNativePlaybackObservation(), 'sample', playing);
    const progressed = advanceNativePlaybackObservation(start, 'sample', { ...playing, currentTime: 1.5 });
    expect(progressed.status).toBe('progress-observed');
    expect(progressed.progressedSeconds).toBe(1.5);
    expect(progressed.videoHeight).toBe(1080);
    expect(progressed).not.toHaveProperty('dolbyVisionOutput');
  });

  it('rejects audio-only or no-image video and stalled/paused timelines', () => {
    const start = emptyNativePlaybackObservation();
    expect(advanceNativePlaybackObservation(start, 'sample', { ...playing, videoWidth: 0 })).toEqual(start);
    expect(advanceNativePlaybackObservation(start, 'sample', { ...playing, readyState: 1 })).toEqual(start);
    expect(advanceNativePlaybackObservation(start, 'sample', { ...playing, seeking: true })).toEqual(start);
    expect(advanceNativePlaybackObservation(start, 'sample', { ...playing, currentTime: Number.NaN })).toEqual(start);
  });

  it('does not count seek jumps as continuous progression', () => {
    const start = advanceNativePlaybackObservation(emptyNativePlaybackObservation(), 'sample', playing);
    const beforeSeek = advanceNativePlaybackObservation(start, 'sample', { ...playing, currentTime: 2 });
    expect(beforeSeek.status).toBe('progress-observed');
    const afterJump = advanceNativePlaybackObservation(beforeSeek, 'sample', { ...playing, currentTime: 200 });
    expect(afterJump.status).toBe('waiting');
    expect(afterJump.progressedSeconds).toBe(0);
    expect(advanceNativePlaybackObservation(beforeSeek, 'reset')).toEqual(emptyNativePlaybackObservation());
  });

  it('clears old playback success when a video pauses or stops being decodable', () => {
    const start = advanceNativePlaybackObservation(emptyNativePlaybackObservation(), 'sample', playing);
    const progressed = advanceNativePlaybackObservation(start, 'sample', { ...playing, currentTime: 2 });
    expect(progressed.status).toBe('progress-observed');

    const paused = advanceNativePlaybackObservation(progressed, 'sample', { ...playing, currentTime: 2, paused: true });
    expect(paused.status).toBe('waiting');
    expect(paused.progressedSeconds).toBe(0);
    expect(paused.baselineTime).toBeNull();

    const resume = advanceNativePlaybackObservation(paused, 'sample', { ...playing, currentTime: 2 });
    expect(resume.status).toBe('waiting');
    const stalled = advanceNativePlaybackObservation(progressed, 'sample', { ...playing, currentTime: 2, readyState: 1 });
    expect(stalled.status).toBe('waiting');
    expect(stalled.progressedSeconds).toBe(0);
  });

  it('does not retain progress from duplicate timeline samples', () => {
    const start = advanceNativePlaybackObservation(emptyNativePlaybackObservation(), 'sample', playing);
    const progressed = advanceNativePlaybackObservation(start, 'sample', { ...playing, currentTime: 2 });
    const duplicate = advanceNativePlaybackObservation(progressed, 'sample', { ...playing, currentTime: 2 });
    expect(duplicate.status).toBe('waiting');
  });

  it('fails closed when the video reports an error during sampling', () => {
    const progressed = advanceNativePlaybackObservation(
      advanceNativePlaybackObservation(emptyNativePlaybackObservation(), 'sample', playing),
      'sample',
      { ...playing, currentTime: 2 },
    );
    const failed = advanceNativePlaybackObservation(progressed, 'sample', { ...playing, currentTime: 3, mediaErrorCode: 3 });
    expect(failed.status).toBe('error');
    expect(failed.mediaErrorCode).toBe(3);
  });

  it('fails closed on native media errors until a new source is loaded', () => {
    const start = advanceNativePlaybackObservation(emptyNativePlaybackObservation(), 'sample', playing);
    const error = advanceNativePlaybackObservation(start, 'error', { ...playing, mediaErrorCode: 4 });
    expect(error.status).toBe('error');
    expect(error.mediaErrorCode).toBe(4);
    expect(advanceNativePlaybackObservation(error, 'sample', { ...playing, currentTime: 5 })).toEqual(error);
    expect(advanceNativePlaybackObservation(error, 'reset').status).toBe('waiting');
  });
});
