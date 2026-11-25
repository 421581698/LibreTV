import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_SOURCES, getEnvSources } from './env-sources';

const original = process.env.DEFAULT_SOURCES;

afterEach(() => {
  if (original === undefined) delete process.env.DEFAULT_SOURCES;
  else process.env.DEFAULT_SOURCES = original;
  vi.restoreAllMocks();
});

describe('built-in CMS sources', () => {
  it('does not activate external providers before content and security review', () => {
    expect(BUILTIN_SOURCES).toEqual([]);
  });

  it('returns no external providers by default', () => {
    delete process.env.DEFAULT_SOURCES;
    expect(getEnvSources()).toEqual([]);
  });

  it('accepts deployment-managed source fixtures without adding built-ins', () => {
    process.env.DEFAULT_SOURCES = JSON.stringify([
      { key: 'cms-fixture', name: 'Reviewed fixture', url: 'https://cms-fixture.example/api.php/provide/vod' },
    ]);
    expect(getEnvSources()).toMatchObject([
      { key: 'cms-fixture', name: 'Reviewed fixture', url: 'https://cms-fixture.example/api.php/provide/vod' },
    ]);
  });

  it('returns no providers when deployment configuration is malformed', () => {
    process.env.DEFAULT_SOURCES = '{invalid';
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(getEnvSources()).toEqual([]);
  });
});
