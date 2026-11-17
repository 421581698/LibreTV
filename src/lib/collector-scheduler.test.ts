import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getJobEvents, getJobStatus, ingestJobResult, receiveJobResult, submitDiscoverJob } from './collector-scheduler';
import type { CollectorSourceStore } from './resource-collector-workflow';
import type { SourceConfig } from './types';
function makeStore(): CollectorSourceStore & { state: { custom: SourceConfig[]; env: SourceConfig[] } } {
  const state = { custom: [] as SourceConfig[], env: [] as SourceConfig[] };
  return {
    state, get customAPIs() { return state.custom; }, get envSources() { return state.env; },
    addCustomApi: (api) => {
      const key = (api as SourceConfig).key ?? 'custom_' + state.custom.length;
      state.custom.push({ ...api, key });
    },
  };
}
const VALID_CMS = {
  id: 'c'.repeat(32), url: 'https://catalog.example/api.php/provide/vod',
  kind: 'cms-api-candidate', host: 'catalog.example', title: 'Catalog',
  validation: { cms_shape: true, reachable: true, source_url: 'https://catalog.example/api.php/provide/vod', access: { access_state: 'PUBLIC' } },
};
const GATED_CMS = {
  ...VALID_CMS, id: 'd'.repeat(32), url: 'https://gated.example/api.php/provide/vod',
  host: 'gated.example', title: 'Gated',
  validation: { cms_shape: true, reachable: true, source_url: 'https://gated.example/api.php/provide/vod', access: { access_state: 'ACCESS_UNKNOWN' } },
};
beforeEach(() => {
  vi.stubEnv('SCRAPLING_API_BASE', 'https://collector.example');
  vi.stubEnv('SCRAPLING_API_TOKEN', 'server-only-token-should-never-leak');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('Collector scheduling bridge — no real crawl', () => {
  it('submits a discover task through the server proxy with Bearer injected', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'a'.repeat(32), status: 'queued' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await submitDiscoverJob({ searchKeyword: '  documentary  ' });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://collector.example/v1/tasks/submit');
    expect(init.headers.Authorization).toBe('Bearer server-only-token-should-never-leak');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ job_type: 'discover', idempotency_key: 'resource-studio:discover:documentary' });
    expect(body.payload.search_keyword).toBe('documentary');
  });
  it('queries a single task status and reads persisted events', async () => {
    const jobId = 'b'.repeat(32);
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      id: jobId, status: 'failed',
      events: [{ event: 'queued', detail: { job_type: 'discover' }, created_at: 1 }, { event: 'claimed', detail: { worker_id: 'collector-live-4' }, created_at: 2 }, { event: 'dead_letter', detail: { error: 'HTTPException' }, created_at: 3 }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchMock);
    const status = await getJobStatus(jobId);
    expect(status.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://collector.example/v1/jobs/${jobId}`);
    const events = await getJobEvents(jobId);
    const payload = await events.json();
    expect(payload.events.map((e: { event: string }) => e.event)).toEqual(['queued', 'claimed', 'dead_letter']);
  });
  it('rejects malformed job ids without issuing any request', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(getJobStatus('../etc/passwd')).rejects.toThrow('Invalid collector job id');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('ingests only validated, non-duplicate CMS sources from a successful job', () => {
    const store = makeStore();
    const outcome = ingestJobResult(store, { status: 'succeeded', result: { candidates: [VALID_CMS, GATED_CMS] } });
    expect(outcome).toMatchObject({ considered: 2, registered: 1, rejected: 1, duplicates: 0 });
    expect(store.customAPIs).toHaveLength(1);
    expect(store.customAPIs[0].url).toBe('https://catalog.example/api.php/provide/vod');
  });
  it('does NOT ingest from a fail-closed / dead-letter job (no bypass)', () => {
    const store = makeStore();
    const outcome = ingestJobResult(store, { status: 'failed', result: { candidates: [VALID_CMS] }, events: [{ event: 'dead_letter', detail: { error: 'HTTPException (503 egress gate)' } }] });
    expect(outcome.registered).toBe(0); expect(outcome.considered).toBe(0); expect(store.customAPIs).toHaveLength(0);
  });
  it('dedupes against existing custom and env sources', () => {
    const store = makeStore();
    store.state.env.push({ key: 'env_0', name: 'existing', url: 'https://catalog.example/api.php/provide/vod/' });
    const outcome = ingestJobResult(store, { status: 'succeeded', result: { candidates: [VALID_CMS] } });
    expect(outcome.duplicates).toBe(1); expect(outcome.registered).toBe(0); expect(store.customAPIs).toHaveLength(0);
  });
  it('receiveJobResult completes the chain via mocked proxy and never leaks the token', async () => {
    const store = makeStore(), jobId = 'e'.repeat(32);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: jobId, status: 'succeeded', result: { candidates: [VALID_CMS] }, events: [{ event: 'finished' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await receiveJobResult(store, jobId);
    expect(result.status).toBe(200); expect(result.ingest.registered).toBe(1); expect(store.customAPIs).toHaveLength(1);
    const serialized = JSON.stringify(fetchMock.mock.calls) + JSON.stringify(result);
    expect(serialized).toContain('Bearer server-only-token-should-never-leak');
    expect(JSON.stringify(store.customAPIs)).not.toContain('server-only-token-should-never-leak');
  });
});
