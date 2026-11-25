import { describe, expect, it } from 'vitest';
import type { DoubanItem, SearchResultItem } from '../types';
import { createPosterAsset, fromBangumiItem, fromCmsArtwork, fromCmsSearchResult, fromDoubanItem, fromEpisodeArtwork } from './poster-source';
import { classifyPosterAspect, inferPosterImageKind, matchesArtworkOrientation, meetsMinimumImageWidth, withPosterDimensions } from './poster-normalizer';
import { selectPreferredTmdbBackdrop, selectPreferredTmdbPoster } from './tmdb-poster-preference';

describe('poster source adapters', () => {
  const douban: DoubanItem = { id: '1292052', title: '肖申克的救赎', cover: 'https://img3.doubanio.com/p.jpg' };

  it('does not emit poster assets from the disabled Douban provider', () => {
    expect(fromDoubanItem(douban)).toBeUndefined();
  });

  it('uses distinct provider namespaces for Bangumi and Douban', () => {
    expect(fromBangumiItem(douban)?.id).toBe('bangumi:1292052:poster');
  });

  it('adapts CMS images without coupling the renderer to CMS field names', () => {
    const item: SearchResultItem = {
      sourceKey: 'site-a', sourceName: '站点 A', vodId: '42',
      name: '测试影片', pic: 'https://cdn.example/poster.jpg',
    };
    expect(fromCmsSearchResult(item)).toMatchObject({
      provider: 'cms',
      providerItemId: 'site-a:42',
      originalUrl: item.pic,
    });
  });

  it('preserves TMDB episode provenance and does not invent missing TMDB identity', () => {
    expect(fromEpisodeArtwork({
      sourceKey: 'cms-a', vodId: '42', episodeIndex: 2, title: '第三集',
      imageUrl: 'https://image.tmdb.org/still.jpg', imageSource: 'tmdb', tmdbSeriesId: 100,
      seasonNumber: 1, episodeNumber: 3,
    })).toMatchObject({ provider: 'tmdb', providerItemId: '100:s1:e3', kind: 'still' });
    expect(fromEpisodeArtwork({
      sourceKey: 'cms-a', vodId: '42', episodeIndex: 2, title: '第三集',
      imageUrl: 'https://image.tmdb.org/still.jpg', imageSource: 'tmdb',
    })).toBeUndefined();
  });

  it('adapts stored CMS artwork using stable source and video identity', () => {
    expect(fromCmsArtwork({ sourceKey: 'source-a', vodId: '77', title: '收藏影片', imageUrl: 'https://cdn.example/cover.jpg' })).toMatchObject({
      id: 'cms:source-a:77:poster', providerItemId: 'source-a:77', originalUrl: 'https://cdn.example/cover.jpg',
    });
  });

  it('rejects unsafe, malformed, credential-bearing and non-http image URLs', () => {
    for (const imageUrl of ['javascript:alert(1)', 'data:image/png;base64,AA', 'file:///tmp/a', 'https://u:p@example.com/a', 'not a url']) {
      expect(createPosterAsset({ provider: 'unknown', providerItemId: 'x', title: 'x', imageUrl })).toBeUndefined();
    }
  });

  it('keeps rights unknown unless an explicit rights declaration is provided', () => {
    expect(fromBangumiItem(douban)?.rights).toBe('unknown');
    expect(createPosterAsset({
      provider: 'tmdb', providerItemId: '1', title: 'x',
      imageUrl: 'https://image.example/x.jpg', rights: 'restricted',
    })?.rights).toBe('restricted');
  });
});

describe('poster dimension normalization', () => {
  it('classifies portrait, landscape and square image geometry', () => {
    expect(classifyPosterAspect(600, 900)).toBe('portrait');
    expect(classifyPosterAspect(1200, 675)).toBe('landscape');
    expect(classifyPosterAspect(600, 600)).toBe('square');
    expect(classifyPosterAspect(0, 600)).toBe('unknown');
  });

  it('adds measured dimensions while retaining the exact original URL', () => {
    const asset = fromBangumiItem({ id: '1', title: 'x', cover: 'https://img.example/x.jpg' })!;
    expect(withPosterDimensions(asset, 600, 900)).toMatchObject({
      originalUrl: asset.originalUrl, width: 600, height: 900,
      aspectRatio: 2 / 3, aspectClass: 'portrait',
    });
  });

  it('infers artwork kind only from measured geometry', () => {
    expect(inferPosterImageKind(600, 900)).toBe('poster');
    expect(inferPosterImageKind(1600, 900)).toBe('backdrop');
    expect(inferPosterImageKind()).toBe('unknown');
  });

  it('accepts only decoded images that meet the minimum source width', () => {
    expect(meetsMinimumImageWidth(1600, 1000)).toBe(true);
    expect(meetsMinimumImageWidth(800, 1000)).toBe(false);
    expect(meetsMinimumImageWidth(0, 1000)).toBe(false);
    expect(meetsMinimumImageWidth(Number.NaN, 1000)).toBe(false);
  });

  it('rejects poster/backdrop orientation mismatches', () => {
    expect(matchesArtworkOrientation(1000, 1500, 'portrait')).toBe(true);
    expect(matchesArtworkOrientation(1600, 900, 'landscape')).toBe(true);
    expect(matchesArtworkOrientation(1600, 900, 'portrait')).toBe(false);
    expect(matchesArtworkOrientation(900, 1600, 'landscape')).toBe(false);
  });
});

describe('TMDB poster language preference', () => {
  it('prefers Chinese artwork over neutral and English artwork', () => {
    expect(selectPreferredTmdbPoster([
      { file_path: '/english.jpg', iso_639_1: 'en' },
      { file_path: '/neutral.jpg', iso_639_1: null },
      { file_path: '/chinese.jpg', iso_639_1: 'zh' },
    ], '/default.jpg')).toBe('/chinese.jpg');
  });

  it('uses language-neutral artwork before English when Chinese artwork is absent', () => {
    expect(selectPreferredTmdbPoster([
      { file_path: '/english.jpg', iso_639_1: 'en' },
      { file_path: '/neutral.jpg', iso_639_1: null },
    ])).toBe('/neutral.jpg');
  });

  it('prefers the highest-resolution image even when the localized image is smaller', () => {
    expect(selectPreferredTmdbPoster([
      { file_path: '/small-zh.jpg', iso_639_1: 'zh', width: 342, height: 513 },
      { file_path: '/large-zh.jpg', iso_639_1: 'zh', width: 2000, height: 3000 },
      { file_path: '/huge-en.jpg', iso_639_1: 'en', width: 4000, height: 6000 },
    ])).toBe('/huge-en.jpg');
  });

  it('rejects square or malformed dimensions when a strict artwork orientation is required', () => {
    expect(selectPreferredTmdbPoster([
      { file_path: '/square.jpg', iso_639_1: 'zh', width: 1000, height: 1000 },
      { file_path: '/invalid.jpg', iso_639_1: 'zh', width: -1, height: 900 },
    ])).toBeUndefined();
    expect(selectPreferredTmdbBackdrop([
      { file_path: '/almost-square.jpg', iso_639_1: 'zh', width: 1100, height: 1000 },
    ])).toBeUndefined();
  });

  it('does not choose landscape artwork for a poster slot when dimensions are known', () => {
    expect(selectPreferredTmdbPoster([
      { file_path: '/landscape.jpg', iso_639_1: 'zh', width: 1600, height: 900 },
      { file_path: '/portrait.jpg', iso_639_1: 'zh', width: 1000, height: 1500 },
    ])).toBe('/portrait.jpg');
  });

  it('uses English artwork only as a secondary fallback, then preserves the localized default', () => {
    expect(selectPreferredTmdbPoster([
      { file_path: '/english.jpg', iso_639_1: 'en' },
    ], '/localized-default.jpg')).toBe('/english.jpg');
    expect(selectPreferredTmdbPoster([], '/localized-default.jpg')).toBe('/localized-default.jpg');
  });

  it('ignores malformed poster paths', () => {
    expect(selectPreferredTmdbPoster([
      { file_path: 'javascript:alert(1)', iso_639_1: 'zh' },
      { file_path: '/english.jpg', iso_639_1: 'en' },
    ])).toBe('/english.jpg');
  });

  it('selects the highest-resolution landscape backdrop without mixing poster assets', () => {
    expect(selectPreferredTmdbBackdrop([
      { file_path: '/small-backdrop.jpg', iso_639_1: 'zh', width: 1280, height: 720 },
      { file_path: '/large-backdrop.jpg', iso_639_1: 'zh', width: 3840, height: 2160 },
      { file_path: '/portrait-poster.jpg', iso_639_1: 'zh', width: 1000, height: 1500 },
    ])).toBe('/large-backdrop.jpg');
  });

  it('preserves the existing backdrop only when no valid landscape candidate exists', () => {
    expect(selectPreferredTmdbBackdrop([
      { file_path: '/portrait.jpg', iso_639_1: 'zh', width: 1000, height: 1500 },
    ], '/source-backdrop.jpg')).toBe('/source-backdrop.jpg');
  });
});
