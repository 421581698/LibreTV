import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_SOURCES, getEnvSources } from './env-sources';

const original = process.env.DEFAULT_SOURCES;

afterEach(() => {
  if (original === undefined) delete process.env.DEFAULT_SOURCES;
  else process.env.DEFAULT_SOURCES = original;
  vi.restoreAllMocks();
});

describe('built-in CMS sources', () => {
  it('preloads all six providers in weight order with their original metadata', () => {
    expect(BUILTIN_SOURCES).toHaveLength(6);
    expect(BUILTIN_SOURCES.map(({ key, name, type, weight }) => ({ key, name, type, weight }))).toEqual([
      { key: 'gsm3u8', name: '光速资源', type: 1, weight: 1 },
      { key: 'jsm3u8', name: '极速资源', type: 1, weight: 2 },
      { key: 'wjm3u8', name: '无尽资源', type: 1, weight: 3 },
      { key: 'hnm3u8', name: '红牛资源', type: 1, weight: 4 },
      { key: 'dbm3u8', name: '百度资源', type: 1, weight: 5 },
      { key: 'zuidam3u8', name: '最大资源', type: 1, weight: 6 },
    ]);
    expect(BUILTIN_SOURCES.every((source) => source.api === `${source.url}/?ac=list` && source.from?.startsWith('https://'))).toBe(true);
  });

  it('returns built-ins by default so the status API exposes them without deployment env', () => {
    delete process.env.DEFAULT_SOURCES;
    expect(getEnvSources().map((source) => source.key)).toEqual(BUILTIN_SOURCES.map((source) => source.key));
  });

  it('keeps deployment-provided sources after built-ins and prevents key collisions', () => {
    process.env.DEFAULT_SOURCES = JSON.stringify([
      { key: 'gsm3u8', name: '覆盖尝试', url: 'https://override.example/api.php/provide/vod' },
      { key: 'custom_news', name: '自定义源', url: 'https://custom.example/api.php/provide/vod' },
    ]);
    const result = getEnvSources();
    expect(result.map((source) => source.key)).toEqual([...BUILTIN_SOURCES.map((source) => source.key), 'custom_news']);
  });

  it('keeps built-ins available when deployment configuration is malformed', () => {
    process.env.DEFAULT_SOURCES = '{invalid';
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(getEnvSources().map((source) => source.key)).toEqual(BUILTIN_SOURCES.map((source) => source.key));
  });
});
