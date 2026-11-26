import { describe, expect, it } from 'vitest';
import { selectCinemaPlaybackMedia, type CinemaPlaybackMedia } from './cinema-playback-gate';

const ordinary: CinemaPlaybackMedia = {
  url: 'https://cdn.example/new.m3u8',
  episodeKey: 'source:new:1',
  sourceKey: 'source',
  dolbyVisionSourceKind: 'cms',
  dolbyVisionSourceIdentity: 'source',
};
const verified: CinemaPlaybackMedia = {
  url: '/api/dolby-vision/assets/asset-123/content',
  episodeKey: 'source:old:0',
  sourceKey: 'source',
  mediaType: 'mp4',
  dolbyVisionAssetId: 'asset-123',
  dolbyVisionSourceKind: 'registry',
  dolbyVisionSourceIdentity: 'resource-123',
};

describe('Cinema CMS playback gate', () => {
  it('keeps the last verified media and asset identity during a new lookup', () => {
    const result = selectCinemaPlaybackMedia({
      isCinema: true, cmsLookupPending: true,
      current: ordinary, lastReady: verified,
    });
    expect(result).toEqual({ media: verified, holdingPrevious: true, showPlayer: true });
    expect(result.media.dolbyVisionAssetId).toBe('asset-123');
    expect(result.media.episodeKey).toBe('source:old:0');
  });

  it('resumes the newly verified or unbound media when lookup settles', () => {
    expect(selectCinemaPlaybackMedia({
      isCinema: true, cmsLookupPending: false, current: ordinary, lastReady: verified,
    })).toEqual({ media: ordinary, holdingPrevious: false, showPlayer: true });
  });

  it('never begins an unverified first CMS playback', () => {
    const result = selectCinemaPlaybackMedia({
      isCinema: true, cmsLookupPending: true, current: ordinary, lastReady: null,
    });
    expect(result.showPlayer).toBe(false);
  });

  it('does not change the ordinary watch page loading behavior', () => {
    expect(selectCinemaPlaybackMedia({
      isCinema: false, cmsLookupPending: true, current: ordinary, lastReady: verified,
    })).toEqual({ media: ordinary, holdingPrevious: false, showPlayer: false });
  });
});
