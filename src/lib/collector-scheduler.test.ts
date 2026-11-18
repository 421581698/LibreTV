import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  discoverCollectorSites,
  getCollectorTaskStatus,
  ingestJobResult,
  receiveCollectorTaskResult,
  startCollectorCrawl,
} from './collector-scheduler';
import type { CollectorSourceStore } from './resource-collector-workflow';
import type { SourceConfig } from './types';

function makeStore(): CollectorSourceStore & { state: { custom: SourceConfig[]; env: SourceConfig[] } } {
  const state = { custom: [] as SourceConfig[], env: [] as SourceConfig[] };
  return {
    state,
    get customAPIs() { return state.custom; },
    get envSources() { return state.env; },
    addCustomApi: (api) => {
      const key = 'custom_' + state.custom.length;
      state.custom.push({ ...api, key });
    },
  };
}
const JOB_ID = 'b'.repeat(32);
const CRAWL_TASK_ID = 'd'.repeat(32);
const CANDIDATE_ID = 'c'.repeat(32);
const VALID_CMS = {
  id: CANDIDATE_ID,
  url: 'https://catalog.example/api.php/provide/vod',
  kind: 'cms-api-candidate',
  host: 'catalog.example',
  title: 'Catalog',
};
const VALIDATION = {
  cms_shape: true,
  reachable: true,
  source_url: 'https://catalog.example/api.php/provide/vod',
  access: { access_state: 'PUBLIC' },
  reason: 'Apple/MacCMS VOD structure verified',
};
function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
beforeEach(() => {
  vi.stubEnv('SCRAPLING_API_BASE', 'https://collector.example');
  vi.stubEnv('SCRAPLING_API_TOKEN', 'server-only-token-should-never-leak');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Collector scheduler bridge — durable worker queue contract', () => {
  it('discovers sites through the existing /v1/discover endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      directory: 'https://fmhy.net',
      count: 1,
      sites: [{ title: 'Catalog', url: 'https://catalog.example', host: 'catalog.example' }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await discoverCollectorSites();
    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe('https://collector.example/v1/discover');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    expect((await response.json()).sites).toHaveLength(1);
  });

  it('submits crawl work to the durable queue instead of blocking on /v1/crawl', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: JOB_ID, status: 'queued', job_type: 'crawl' }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await startCollectorCrawl({
      url: 'https://catalog.example',
      mode: 'auto',
      limit: 50,
      searchKeyword: 'documentary',
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ task_id: JOB_ID, status: 'queued' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://collector.example/v1/tasks/submit');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({
      job_type: 'crawl',
      payload: { url: 'https://catalog.example', mode: 'auto', limit: 50, search_keyword: 'documentary' },
    });
    expect(body.idempotency_key).toMatch(/^resource-studio:crawl:/);
  });

  it('rejects an empty crawl URL without contacting the Collector', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await startCollectorCrawl({ url: '' });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads a durable job and normalizes worker succeeded to UI completed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: JOB_ID, status: 'succeeded', result: '{"task_id":"' + CRAWL_TASK_ID + '"}' }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await getCollectorTaskStatus(JOB_ID);
    expect(response.status).toBe(200);
    expect((await response.json()).task).toMatchObject({
      id: JOB_ID, status: 'completed', result: { task_id: CRAWL_TASK_ID },
    });
    expect(fetchMock.mock.calls[0][0]).toBe(`https://collector.example/v1/jobs/${JOB_ID}`);
  });

  it('rejects malformed task ids without issuing a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(getCollectorTaskStatus('../etc/passwd')).rejects.toThrow('Invalid collector task id');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves the underlying crawl task, validates candidates, and returns CMS source', async () => {
    const store = makeStore();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: JOB_ID, status: 'succeeded', result: { task_id: CRAWL_TASK_ID } }))
      .mockResolvedValueOnce(jsonResponse({ id: JOB_ID, status: 'succeeded', result: { task_id: CRAWL_TASK_ID } }))
      .mockResolvedValueOnce(jsonResponse({ candidates: [VALID_CMS] }))
      .mockResolvedValueOnce(jsonResponse({ candidate_id: CANDIDATE_ID, validation: VALIDATION }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await receiveCollectorTaskResult(store, JOB_ID);
    expect(result.status).toBe(200);
    expect(result.ingest).toMatchObject({ considered: 1, registered: 1, rejected: 0, duplicates: 0 });
    expect(result.ingest.sources).toEqual([{ url: VALIDATION.source_url, name: 'Catalog' }]);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `https://collector.example/v1/jobs/${JOB_ID}`,
      `https://collector.example/v1/jobs/${JOB_ID}`,
      `https://collector.example/v1/tasks/${CRAWL_TASK_ID}/candidates`,
      `https://collector.example/v1/candidates/${CANDIDATE_ID}/validate`,
    ]);
    expect(JSON.stringify(result)).not.toContain('server-only-token-should-never-leak');
  });

  it('does not fetch candidates or ingest a queued/failed job', async () => {
    const store = makeStore();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: JOB_ID, status: 'queued', result: '{}' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await receiveCollectorTaskResult(store, JOB_ID);
    expect(result.status).toBe(409);
    expect(result.ingest.considered).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.customAPIs).toHaveLength(0);
  });

  it('ingests only public validated CMS candidates and dedupes against existing sources', () => {
    const store = makeStore();
    store.state.env.push({ key: 'env_0', name: 'existing', url: VALIDATION.source_url + '/' });
    const outcome = ingestJobResult(store, {
      status: 'completed',
      result: { candidates: [{ ...VALID_CMS, validation: VALIDATION }] },
    });
    expect(outcome).toMatchObject({ considered: 1, registered: 0, duplicates: 1, rejected: 0 });
    expect(store.customAPIs).toHaveLength(0);
  });

  it('rejects gated CMS candidates and failed jobs', () => {
    const store = makeStore();
    const gated = { ...VALIDATION, access: { access_state: 'ACCESS_UNKNOWN' } };
    const gatedResult = ingestJobResult(store, {
      status: 'completed', result: { candidates: [{ ...VALID_CMS, validation: gated }] },
    });
    const failedResult = ingestJobResult(store, {
      status: 'failed', result: { candidates: [{ ...VALID_CMS, validation: VALIDATION }] },
    });
    expect(gatedResult.rejected).toBe(1);
    expect(failedResult.considered).toBe(0);
    expect(store.customAPIs).toHaveLength(0);
  });
});
