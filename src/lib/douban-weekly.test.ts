import { describe, expect, it } from 'vitest';
import { baiduTeleplayToItem, isHotListId } from './douban-weekly';

describe('isHotListId', () => {
  it('只允许仍启用的百度热播剧榜', () => {
    expect(isHotListId('baidu_teleplay')).toBe(true);
    expect(isHotListId('douban_movie_weekly')).toBe(false);
    expect(isHotListId('douban_tv_chinese')).toBe(false);
    expect(isHotListId('maoyan')).toBe(false);
    expect(isHotListId('')).toBe(false);
  });
});

describe('baiduTeleplayToItem', () => {
  it('用序号生成 id，不输出 rating', () => {
    expect(baiduTeleplayToItem({ title: '某剧', cover: 'https://img.example/1.jpg' }, 3)).toEqual({
      id: 'baidu_3',
      title: '某剧',
      cover: 'https://img.example/1.jpg',
      isTv: true,
    });
  });

  it('无海报条目丢弃', () => {
    expect(baiduTeleplayToItem({ title: '某剧', cover: null }, 0)).toBeUndefined();
  });
});
