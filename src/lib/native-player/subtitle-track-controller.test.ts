import { describe, expect, it } from 'vitest';
import { applySubtitleTrack, listSubtitleTracks } from './subtitle-track-controller';

function videoWithTracks() {
  const tracks = [
    { id: 'en', label: 'English', language: 'en', kind: 'subtitles', mode: 'disabled' as TextTrackMode },
    { id: 'zh', label: '简体中文', language: 'zh-CN', kind: 'subtitles', mode: 'disabled' as TextTrackMode },
  ];
  return {
    video: { textTracks: tracks } as unknown as HTMLMediaElement,
    tracks,
  };
}

describe('subtitle track selection', () => {
  it('lists HLS subtitle renditions with stable source-prefixed IDs', () => {
    const { video } = videoWithTracks();
    const hls = {
      subtitleTracks: [
        { name: 'English', lang: 'en', default: true },
        { name: '简体中文', lang: 'zh-CN' },
      ],
      subtitleTrack: -1,
      subtitleDisplay: false,
    };
    expect(listSubtitleTracks(video, hls)).toEqual([
      { id: 'hls:0', label: 'English', language: 'en', source: 'hls', index: 0, isDefault: true },
      { id: 'hls:1', label: '简体中文', language: 'zh-CN', source: 'hls', index: 1, isDefault: false },
    ]);
  });

  it('lists native tracks and ignores non-subtitle text tracks', () => {
    const { video } = videoWithTracks();
    const options = listSubtitleTracks(video);
    expect(options.map(track => track.id)).toEqual(['native:en', 'native:zh']);
  });

  it('selects one HLS track and turns off competing native tracks', () => {
    const { video, tracks } = videoWithTracks();
    const hls = {
      subtitleTracks: [{ name: 'English' }, { name: '中文' }],
      subtitleTrack: -1,
      subtitleDisplay: false,
    };
    expect(applySubtitleTrack(video, hls, 'hls:1', true)).toBe(true);
    expect(hls.subtitleTrack).toBe(1);
    expect(hls.subtitleDisplay).toBe(true);
    expect(tracks.every(track => track.mode === 'disabled')).toBe(true);
  });

  it('selects one native track and disables HLS subtitle display', () => {
    const { video, tracks } = videoWithTracks();
    const hls = { subtitleTracks: [{ name: 'English' }], subtitleTrack: 0, subtitleDisplay: true };
    expect(applySubtitleTrack(video, hls, 'native:zh', true)).toBe(true);
    expect(hls.subtitleTrack).toBe(-1);
    expect(hls.subtitleDisplay).toBe(false);
    expect(tracks.map(track => track.mode)).toEqual(['disabled', 'showing']);
  });

  it('disables every subtitle renderer when subtitles are turned off', () => {
    const { video, tracks } = videoWithTracks();
    const hls = { subtitleTracks: [{ name: 'English' }], subtitleTrack: 0, subtitleDisplay: true };
    expect(applySubtitleTrack(video, hls, null, false)).toBe(true);
    expect(hls.subtitleTrack).toBe(-1);
    expect(hls.subtitleDisplay).toBe(false);
    expect(tracks.every(track => track.mode === 'disabled')).toBe(true);
  });
});
