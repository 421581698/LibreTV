import { describe, expect, it } from 'vitest';
import { isCinemaPlaybackEventCurrent, isCinemaPlaybackTransitionPending, resolveCinemaBoundPlaybackUrl, selectCinemaPlaybackMedia, type CinemaPlaybackMedia } from './cinema-playback-gate';

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

describe('Cinema provider detail-to-binding transition', () => {
  it('retains the outgoing media before the new provider returns any URL', () => {
    const pending = isCinemaPlaybackTransitionPending({
      isCinema: true, cmsLookupPending: false, detailLoading: true, currentUrl: '',
    });
    expect(pending).toBe(true);
    expect(selectCinemaPlaybackMedia({
      isCinema: true, cmsLookupPending: pending,
      current: { ...ordinary, url: '' }, lastReady: verified,
    })).toEqual({ media: verified, holdingPrevious: true, showPlayer: true });
    expect(isCinemaPlaybackEventCurrent({
      isCinema: true, cmsLookupPending: pending, holdingPrevious: true,
      currentEpisodeKey: ordinary.episodeKey, eventEpisodeKey: verified.episodeKey,
    })).toBe(false);
  });

  it('retains the outgoing media while its replacement CMS registry lookup runs', () => {
    const pending = isCinemaPlaybackTransitionPending({
      isCinema: true, cmsLookupPending: true, detailLoading: false,
      currentUrl: ordinary.url,
    });
    expect(pending).toBe(true);
    expect(selectCinemaPlaybackMedia({
      isCinema: true, cmsLookupPending: pending, current: ordinary, lastReady: verified,
    }).media).toEqual(verified);
  });

  it('releases the outgoing media after details and binding settle', () => {
    const pending = isCinemaPlaybackTransitionPending({
      isCinema: true, cmsLookupPending: false, detailLoading: false, currentUrl: ordinary.url,
    });
    expect(pending).toBe(false);
    expect(selectCinemaPlaybackMedia({
      isCinema: true, cmsLookupPending: pending, current: ordinary, lastReady: verified,
    }).media).toEqual(ordinary);
  });

  it('does not keep a stale player forever when detail lookup fails', () => {
    const pending = isCinemaPlaybackTransitionPending({
      isCinema: true, cmsLookupPending: false, detailLoading: false, currentUrl: '',
    });
    expect(pending).toBe(false);
    expect(selectCinemaPlaybackMedia({
      isCinema: true, cmsLookupPending: pending,
      current: { ...ordinary, url: '' }, lastReady: verified,
    }).holdingPrevious).toBe(false);
  });

  it('keeps the classic player independent of Cinema detail hydration', () => {
    expect(isCinemaPlaybackTransitionPending({
      isCinema: false, cmsLookupPending: false, detailLoading: true, currentUrl: '',
    })).toBe(false);
  });
});

it('keeps the native HLS playback URL while separately carrying a verified registry identity', () => {
  const hls: CinemaPlaybackMedia = {
    url: 'https://example.org/season/master.m3u8',
    episodeKey: 'custom_1:167277:0',
    sourceKey: 'custom_1',
    mediaType: 'hls',
    dolbyVisionAssetId: 'dv_root',
    dolbyVisionSourceKind: 'registry',
    dolbyVisionSourceIdentity: 'resource-123',
  };
  const result = selectCinemaPlaybackMedia({
    isCinema: true, cmsLookupPending: false, current: hls, lastReady: verified,
  });
  expect(result.media.url).toBe(hls.url);
  expect(result.media.mediaType).toBe('hls');
  expect(result.media.dolbyVisionSourceIdentity).toBe('resource-123');
});

describe('exact CMS playback URL selection', () => {
  const hls = 'https://cdn.example.org/media/master.m3u8?token=opaque';
  it('does not redirect signed HLS graphs to an unusable standalone root M3U8', () => {
    expect(resolveCinemaBoundPlaybackUrl(hls, { assetId: 'dv_verified_root', mediaType: 'hls' })).toBe(hls);
  });
  it('retains the existing MP4 byte proxy only for an authorized stable asset ID', () => {
    expect(resolveCinemaBoundPlaybackUrl(hls, { assetId: 'dv_valid', mediaType: 'mp4' }))
      .toBe('/api/dolby-vision/assets/dv_valid/content');
    expect(resolveCinemaBoundPlaybackUrl(hls, { assetId: '../escape', mediaType: 'mp4' })).toBe(hls);
    expect(resolveCinemaBoundPlaybackUrl(hls, null)).toBe(hls);
  });
});
