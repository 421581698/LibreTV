import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cancellationStoreStatus,publishDistributedCancellation,watchDistributedCancellation} from './distributed-cancellation';
import {cancelInflight,registerInflight,unregisterInflight} from './inflight';
const URL='https://test-redis.upstash.io/';
beforeEach(()=>{
  vi.stubEnv('UPSTASH_REDIS_REST_URL',URL);
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN','test-secret');
});
afterEach(()=>{
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('shared cancellation protocol',()=>{
 it('requires a full HTTPS backend configuration and never assumes local memory is shared',()=>{
  expect(cancellationStoreStatus()).toBe('configured');
  vi.stubEnv('UPSTASH_REDIS_REST_URL','http://127.0.0.1/');
  expect(cancellationStoreStatus()).toBe('invalid');
  vi.stubEnv('UPSTASH_REDIS_REST_URL','');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN','');
  expect(cancellationStoreStatus()).toBe('disabled');
 });
 it('writes a bounded user-scoped cancellation ticket to the configured REST service',async()=>{
  const send=vi.fn().mockResolvedValue(new Response(JSON.stringify({result:'OK'}),{status:200}));
  vi.stubGlobal('fetch',send);
  await publishDistributedCancellation('req_123','user-a');
  const [url,init]=send.mock.calls[0] as [string,RequestInit];
  expect(url).toBe(URL);
  expect(JSON.parse(String(init.body))).toEqual([
    'SET','libretv:chat:cancel:v1:user-a:req_123','user-a','EX','120',
  ]);
  expect(init.redirect).toBe('error');
  expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-secret');
 });
 it('observes cancellation across separate requests without a shared local Map',async()=>{
  const send=vi.fn().mockResolvedValue(new Response(JSON.stringify({result:'user-a'}),{status:200}));
  vi.stubGlobal('fetch',send);
  const controller=new AbortController();
  const stop=watchDistributedCancellation('req_cross_instance','user-a',controller);
  await vi.waitFor(()=>expect(controller.signal.aborted).toBe(true));
  stop();
  expect(send).toHaveBeenCalled();
  expect(controller.signal.reason).toBeInstanceOf(Error);
 });
 it('releases polling immediately when a stream aborts before unregister',async()=>{
  vi.useFakeTimers();
  const send=vi.fn(async()=>new Response(JSON.stringify({result:null}),{status:200}));
  vi.stubGlobal('fetch',send);
  const controller=new AbortController();
  const stop=watchDistributedCancellation('req_abort_cleanup','user-a',controller);
  try {
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    expect(vi.getTimerCount()).toBe(0);
    const count=send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(count);
  } finally {stop();}
 });
 it('ignores cancellation owned by a different user even with an identical request id',async()=>{
  const send=vi.fn().mockResolvedValue(new Response(JSON.stringify({result:'user-b'}),{status:200}));
  vi.stubGlobal('fetch',send);
  const controller=new AbortController();
  const stop=watchDistributedCancellation('req_collision','user-a',controller);
  await vi.waitFor(()=>expect(send).toHaveBeenCalled());
  expect(controller.signal.aborted).toBe(false);
  stop();
 });
 it('aborts a registered stream if a configured coordinator cannot be reached',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
  const id='req_redis_failure';
  const controller=new AbortController();
  expect(registerInflight(id,'user-a',controller)).toBe(true);
  await vi.waitFor(()=>expect(controller.signal.aborted).toBe(true));
  unregisterInflight(id);
 });
 it('does not let a different user overwrite an early local cancellation ticket',()=>{
  vi.stubEnv('UPSTASH_REDIS_REST_URL','');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN','');
  const id='req_early_owner';
  expect(cancelInflight(id,'user-a')).toBe('pending');
  expect(cancelInflight(id,'user-b')).toBe('pending');
  const ctrl=new AbortController();
  expect(registerInflight(id,'user-a',ctrl)).toBe(true);
  expect(ctrl.signal.aborted).toBe(true);
  unregisterInflight(id);
 });
});
