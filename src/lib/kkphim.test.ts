import { describe, expect, it } from 'vitest';
import { normalizeKkphimMovie, parseKkphimDetail, parseKkphimSearch } from './kkphim';

describe('KKPhim adapter', () => {
  it('normalizes list records into LibreTV search results', () => {
    const items = parseKkphimSearch({
      data: {
        APP_DOMAIN_CDN_IMAGE: 'https://phimimg.com/upload/vod/',
        items: [{
          slug: 'sample-film',
          name: '示例电影',
          poster_url: 'poster.jpg',
          year: 2025,
          quality: 'FHD',
          episode_current: 'Full',
          category: [{ name: '动作' }],
          country: [{ name: '韩国' }],
        }],
      },
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceKey: 'kkphim',
      sourceName: 'KKPhim',
      vodId: 'sample-film',
      name: '示例电影',
      pic: 'https://phimimg.com/upload/vod/poster.jpg',
      typeName: '动作',
      year: '2025',
      area: '韩国',
      remarks: 'FHD · Full',
    });
  });

  it('rejects unsafe or incomplete movie records', () => {
    expect(normalizeKkphimMovie({ slug: '../private', name: 'bad' })).toBeNull();
    expect(normalizeKkphimMovie({ slug: 'missing-title' })).toBeNull();
    expect(normalizeKkphimMovie({ slug: 'ok', name: 'ok', poster_url: 'http://insecure.test/a.jpg' })?.pic).toBeUndefined();
  });

  it('keeps episode labels and prefers direct HLS without claiming verification', () => {
    const detail = parseKkphimDetail({
      movie: {
        slug: 'sample-series',
        name: '示例剧集',
        year: 2024,
        poster_url: 'https://phimimg.com/poster.jpg',
        actor: ['演员甲'],
        director: ['导演乙'],
        category: [{ name: '剧情' }],
        country: [{ name: '越南' }],
        content: '<p>故事简介</p>',
      },
      episodes: [{
        server_name: 'Vietsub',
        server_data: [{
          name: '第1集',
          link_embed: 'https://player.example/embed/1',
          link_m3u8: 'https://media.example/1.m3u8',
        }],
      }],
    });
    expect(detail?.episodes).toEqual(['Vietsub · 第1集$https://media.example/1.m3u8']);
    expect(detail?.videoInfo).toMatchObject({
      sourceKey: 'kkphim',
      title: '示例剧集',
      desc: '故事简介',
      actor: '演员甲',
      director: '导演乙',
    });
  });

  it('falls back to embed when HLS is absent and ignores invalid episode URLs', () => {
    const detail = parseKkphimDetail({
      movie: { slug: 'sample', name: '示例' },
      episodes: [{
        server_data: [
          { name: '第1集', link_embed: 'https://player.example/1' },
          { name: '第2集', link_m3u8: 'javascript:alert(1)' },
        ],
      }],
    });
    expect(detail?.episodes).toEqual(['KKPhim · 第1集$https://player.example/1']);
  });
});
