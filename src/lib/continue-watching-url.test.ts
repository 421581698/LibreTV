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
});
