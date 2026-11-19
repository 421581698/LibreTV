import { describe, expect, it } from 'vitest';
import type { DoubanItem, SearchResultItem } from '../types';
import { createPosterAsset, fromBangumiItem, fromCmsArtwork, fromCmsSearchResult, fromDoubanItem, fromEpisodeArtwork } from './poster-source';
import { classifyPosterAspect, inferPosterImageKind, withPosterDimensions } from './poster-normalizer';

describe('poster source adapters', () => {
  const douban: DoubanItem = { id: '1292052', title: '肖申克的救赎', cover: 'https://img3.doubanio.com/p.jpg' };

  it('preserves real provider identity and original image URL', () => {
    expect(fromDoubanItem(douban)).toMatchObject({
      id: 'douban:1292052:poster',
      provider: 'douban',
      providerItemId: '1292052',
      originalUrl: douban.cover,
      rights: 'unknown',
      kind: 'poster',
    });
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
    expect(fromDoubanItem(douban)?.rights).toBe('unknown');
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
    const asset = fromDoubanItem({ id: '1', title: 'x', cover: 'https://img.example/x.jpg' })!;
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
});
