import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({
  db: {},
  clearLiveProbeResultsDb: vi.fn(async () => {}),
  loadLiveProbeResults: vi.fn(async () => ({})),
  saveLiveProbeResults: vi.fn(async () => {}),
}));

import { api } from './client-api';
import { useAppStore } from './store';
import { registerValidatedCmsSource } from './resource-collector-workflow';

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  useAppStore.setState({
    customAPIs: [],
    envSources: [],
    selectedKeys: [],
    yellowFilter: false,
  });
});

describe('Scrapling candidate to LibreTV VOD workflow', () => {
  it('registers a verified public CMS API, enables it, searches, and opens movie detail', async () => {
    const candidate = {
      id: 'a'.repeat(32),
      url: 'https://catalog.example/api.php/provide/vod/?ac=list',
      kind: 'cms-api-candidate',
      host: 'catalog.example',
      title: 'Catalog',
    };
    const result = registerValidatedCmsSource(
      useAppStore.getState(),
      candidate,
      {
        cms_shape: true,
        reachable: true,
        source_url: 'https://catalog.example/api.php/provide/vod',
        access: { access_state: 'PUBLIC' },
      },
      'https://catalog.example',
    );

    expect(result).toMatchObject({ registered: true, duplicate: false });
    const state = useAppStore.getState();
    expect(state.customAPIs).toHaveLength(1);
    expect(state.customAPIs[0].url).toBe('https://catalog.example/api.php/provide/vod');
    expect(state.selectedKeys).toContain(state.customAPIs[0].key);

    const source = state.customAPIs[0];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        list: [{
          sourceKey: source.key,
          sourceName: source.name,
          vodId: 'vod-100',
          name: 'Example Movie',
          sourceUrl: source.url,
        }],
        failures: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        episodes: ['https://media.example/episode-1.m3u8'],
        videoInfo: {
          title: 'Example Movie',
          sourceKey: source.key,
          sourceName: source.name,
          sourceUrl: source.url,
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const search = await api.search('Example Movie', [source], false);
    expect(search.list).toHaveLength(1);
    expect(search.list[0].vodId).toBe('vod-100');
    const searchRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(searchRequest.sources).toContainEqual(source);

    const detail = await api.detail('vod-100', source);
    expect(detail.videoInfo.title).toBe('Example Movie');
    expect(detail.episodes).toHaveLength(1);
  });

  it('never registers a webpage or direct-media candidate as a CMS VOD source', () => {
    const store = useAppStore.getState();
    const validation = {
      cms_shape: true,
      reachable: true,
      access: { access_state: 'PUBLIC' },
    };
    for (const kind of ['webpage', 'embedded-player', 'direct-media']) {
      const result = registerValidatedCmsSource(store, {
        url: 'https://media.example/watch',
        kind,
        host: 'media.example',
      }, validation);
      expect(result.registered).toBe(false);
    }
    expect(useAppStore.getState().customAPIs).toHaveLength(0);
    expect(useAppStore.getState().selectedKeys).toHaveLength(0);
  });

  it('does not register a CMS-looking URL when its response shape or access is unverified', () => {
    const result = registerValidatedCmsSource(useAppStore.getState(), {
      url: 'https://catalog.example/api.php/provide/vod',
      kind: 'cms-api-candidate',
      host: 'catalog.example',
    }, {
      cms_shape: false,
      reachable: true,
      access: { access_state: 'PUBLIC' },
      reason: 'Response is not a CMS VOD list',
    });
    expect(result.registered).toBe(false);
    expect(result.reason).toBe('Response is not a CMS VOD list');
    expect(useAppStore.getState().customAPIs).toHaveLength(0);
  });
});
