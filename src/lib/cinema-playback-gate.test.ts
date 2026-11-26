import { describe, expect, it } from 'vitest';
import { isCinemaPlaybackEventCurrent, selectCinemaPlaybackMedia, type CinemaPlaybackMedia } from './cinema-playback-gate';

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

  it('promotes a different trusted Dolby asset only after the exact lookup settles', () => {
    const next = {
      ...verified, url: '/api/dolby-vision/assets/asset-456/content',
      dolbyVisionAssetId: 'asset-456',
      dolbyVisionSourceIdentity: 'resource-456',
      episodeKey: 'source:new:1',
    };
    const waiting = selectCinemaPlaybackMedia({
      isCinema: true, cmsLookupPending: true, current: next, lastReady: verified,
    });
    expect(waiting.media.dolbyVisionAssetId).toBe('asset-123');
    const settled = selectCinemaPlaybackMedia({
      isCinema: true, cmsLookupPending: false, current: next, lastReady: verified,
    });
    expect(settled.media.dolbyVisionAssetId).toBe('asset-456');
    expect(settled.media.episodeKey).toBe('source:new:1');
  });

  it('does not change the ordinary watch page loading behavior', () => {
    expect(selectCinemaPlaybackMedia({
      isCinema: false, cmsLookupPending: true, current: ordinary, lastReady: verified,
    })).toEqual({ media: ordinary, holdingPrevious: false, showPlayer: false });
  });
});

describe('Cinema retained-media event isolation', () => {
  const common = { isCinema: true, currentEpisodeKey: 'cms:vod:0' };

  it('rejects outgoing media events during verification, even with a reused episode key', () => {
    expect(isCinemaPlaybackEventCurrent({
      ...common, cmsLookupPending: true, holdingPrevious: true, eventEpisodeKey: 'cms:vod:0',
    })).toBe(false);
    expect(isCinemaPlaybackEventCurrent({
      ...common, cmsLookupPending: true, holdingPrevious: false, eventEpisodeKey: 'cms:vod:0',
    })).toBe(false);
  });

  it('rejects held media after verification state changes until it is released', () => {
    expect(isCinemaPlaybackEventCurrent({
      ...common, cmsLookupPending: false, holdingPrevious: true, eventEpisodeKey: 'cms:vod:0',
    })).toBe(false);
  });

  it('accepts only the verified current episode after the gate opens', () => {
    expect(isCinemaPlaybackEventCurrent({
      ...common, cmsLookupPending: false, holdingPrevious: false, eventEpisodeKey: 'cms:vod:0',
    })).toBe(true);
    expect(isCinemaPlaybackEventCurrent({
      ...common, cmsLookupPending: false, holdingPrevious: false, eventEpisodeKey: 'cms:vod:1',
    })).toBe(false);
  });

  it('preserves non-Cinema classic playback behavior', () => {
    expect(isCinemaPlaybackEventCurrent({
      ...common, isCinema: false, cmsLookupPending: true, holdingPrevious: false,
      eventEpisodeKey: 'cms:vod:0',
    })).toBe(true);
  });
});
