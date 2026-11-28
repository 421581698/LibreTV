import { describe, expect, it } from 'vitest';
import { preferOriginalCinemaImage, selectCinemaTitleLogo } from './cinema-artwork-policy';

describe('Cinema artwork policy', () => {
  it('rejects superwide logo canvases and uses another usable language', () => {
    expect(selectCinemaTitleLogo([
      { file_path: '/too-wide.png', width: 1200, height: 72, iso_639_1: 'zh' },
      { file_path: '/english.png', width: 540, height: 210, iso_639_1: 'en' },
    ])).toBe('/english.png');
  });
  it('prioritizes an appropriately proportioned Chinese logo', () => {
    expect(selectCinemaTitleLogo([
      { file_path: '/english.png', width: 540, height: 210, iso_639_1: 'en' },
      { file_path: '/zh.png', width: 490, height: 150, iso_639_1: 'zh' },
    ])).toBe('/zh.png');
    expect(selectCinemaTitleLogo([{ file_path: '/bad.jpg', width: 500, height: 200 }])).toBeUndefined();
    expect(selectCinemaTitleLogo([{ file_path: '/bad.png', width: 200, height: 0 }])).toBeUndefined();
  });
  it('preserves original bytes first for opt-in iPad proxy media only', () => {
    const original = 'https://image.tmdb.org/t/p/original/sample.jpg';
    const proxy = '/api/proxy?url=sample';
    expect(preferOriginalCinemaImage([proxy, original], original, 'proxy', true)).toEqual([original, proxy]);
    expect(preferOriginalCinemaImage([proxy], original, 'proxy', false)).toEqual([proxy]);
    expect(preferOriginalCinemaImage([proxy], original, 'custom', true)).toEqual([proxy]);
    expect(preferOriginalCinemaImage([proxy], 'http://example.org/x', 'proxy', true)).toEqual([proxy]);
  });
  it('keeps the original fallback image ahead of transcoding proxy URLs', () => {
    const original = 'https://image.tmdb.org/t/p/original/fallback.jpg';
    const proxy = '/api/proxy?url=fallback';
    expect(preferOriginalCinemaImage([proxy], original, 'proxy', true)).toEqual([original, proxy]);
    expect(preferOriginalCinemaImage([proxy], original, 'proxy', false)).toEqual([proxy]);
  });
});
