import { describe, expect, it } from 'vitest';
import { buildContinueWatchingUrl } from './continue-watching-url';

describe('buildContinueWatchingUrl', () => {
  it('opens the iPad player directly at the last episode and saved position', () => {
    const url = new URL(buildContinueWatchingUrl({
      sourceKey: 'demo-source',
      sourceUrl: 'https://vod.example/api.php',
      vodId: 'movie-42',
      title: '示例影片',
      episodeIndex: 3,
      playbackPosition: 126.8,
    }), 'https://libretv.example');

    expect(url.pathname).toBe('/ipad-edition/watch');
    expect(url.searchParams.get('source')).toBe('demo-source');
    expect(url.searchParams.get('id')).toBe('movie-42');
    expect(url.searchParams.get('title')).toBe('示例影片');
    expect(url.searchParams.get('index')).toBe('3');
    expect(url.searchParams.get('sourceUrl')).toBe('https://vod.example/api.php');
    expect(url.searchParams.get('position')).toBe('126');
  });

  it('does not inject a position when the saved progress is only a few seconds', () => {
    const url = new URL(buildContinueWatchingUrl({
      sourceKey: 'demo-source',
      vodId: 'movie-42',
      title: '示例影片',
      episodeIndex: 0,
      playbackPosition: 4,
    }), 'https://libretv.example');

    expect(url.pathname).toBe('/ipad-edition/watch');
    expect(url.searchParams.has('position')).toBe(false);
  });
  it('preserves film identity hints while routing directly to the existing player', () => {
    const url = new URL(buildContinueWatchingUrl({
      sourceKey: 'cms', vodId: '123', title: '蜘蛛侠：崭新之日',
      year: '2026年', typeName: '科幻电影', episodeIndex: 0, playbackPosition: 140,
    }), 'https://libretv.example');
    expect(url.pathname).toBe('/ipad-edition/watch');
    expect(url.searchParams.get('identityYear')).toBe('2026');
    expect(url.searchParams.get('identityType')).toBe('movie');
    expect(url.searchParams.get('position')).toBe('140');
  });

  it('preserves TV episode index and its series type', () => {
    const url = new URL(buildContinueWatchingUrl({
      sourceKey: 'cms', vodId: 'series', title: '测试剧集',
      typeName: '电视剧', episodeIndex: 4, playbackPosition: 88,
    }), 'https://libretv.example');
    expect(url.pathname).toBe('/ipad-edition/watch');
    expect(url.searchParams.get('identityType')).toBe('tv');
    expect(url.searchParams.get('index')).toBe('4');
  });
});
