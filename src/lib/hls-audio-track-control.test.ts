import { describe, expect, it, vi } from 'vitest';
import { selectHlsAudioTrack } from './hls-audio-track-control';

describe('selectHlsAudioTrack', () => {
  it('selects an available HLS rendition by changing only the audio track index', () => {
    const media = { paused: false, currentTime: 42, volume: 0.65 };
    const hls = {
      audioTracks: [{ id: 0 }, { id: 1 }, { id: 2 }],
      audioTrack: 0,
    };
    const before = { ...media };

    expect(selectHlsAudioTrack(hls, 2)).toBe(true);
    expect(hls.audioTrack).toBe(2);
    expect(media).toEqual(before);
  });

  it('rejects invalid indexes without changing the selected rendition', () => {
    const hls = { audioTracks: [{ id: 0 }, { id: 1 }], audioTrack: 1 };
    const setter = vi.fn((value: number) => { hls.audioTrack = value; });
    const controller = {
      audioTracks: hls.audioTracks,
      get audioTrack() { return hls.audioTrack; },
      set audioTrack(value: number) { setter(value); },
    };

    expect(selectHlsAudioTrack(controller, -1)).toBe(false);
    expect(selectHlsAudioTrack(controller, 2)).toBe(false);
    expect(selectHlsAudioTrack(controller, 1.5)).toBe(false);
    expect(setter).not.toHaveBeenCalled();
    expect(hls.audioTrack).toBe(1);
  });

  it('does not report a successful switch if the HLS setter throws or refuses it', () => {
    const throwing = {
      audioTracks: [{}, {}],
      get audioTrack() { return 0; },
      set audioTrack(_value: number) { throw new Error('HLS instance destroyed'); },
    };
    expect(selectHlsAudioTrack(throwing, 1)).toBe(false);
    const ignored = {
      audioTracks: [{}, {}],
      get audioTrack() { return 0; },
      set audioTrack(_value: number) { /* ignored by decoder */ },
    };
    expect(selectHlsAudioTrack(ignored, 1)).toBe(false);
  });

  it('supports an HLS source with no selectable audio renditions', () => {
    const hls = { audioTracks: [], audioTrack: -1 };
    expect(selectHlsAudioTrack(hls, 0)).toBe(false);
    expect(hls.audioTrack).toBe(-1);
  });
});
