import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({
  register:vi.fn(),
  unregister:vi.fn(),
  mode:'closed' as 'closed'|'hold',
}));
vi.mock('@/lib/api-guard',()=>({guardRequest:()=>null}));
vi.mock('@/lib/infra/inflight',()=>({
  registerInflight:mocks.register,
  unregisterInflight:mocks.unregister,
}));
vi.mock('@opennextjs/cloudflare',()=>({
  getCloudflareContext:()=>({env:{}}),
}));
vi.mock('@ai-sdk/openai-compatible',()=>({
  createOpenAICompatible:()=>()=>({}),
}));
vi.mock('@/lib/friday/model-provider',()=>({
  resolveFridayModelConfig:()=>({
    providerName:'mock',apiKey:'integration-test',baseURL:'https://model.example',
    modelName:'stub-model',headers:{},
  }),
}));
vi.mock('@/lib/friday/assistant-profiles',()=>({
  buildFridayAssistantSystemPrompt:()=> 'test system',
}));
vi.mock('@/lib/search',()=>({
  searchSources:vi.fn(),mergeSearchResults:vi.fn(),
}));
vi.mock('ai',()=>({
  convertToModelMessages:vi.fn(async()=>[]),
  createUIMessageStream:()=>new ReadableStream<Uint8Array>({
    start(controller){
      if(mocks.mode==='closed'){
        controller.enqueue(new TextEncoder().encode('data: test\\n\\n'));
        controller.close();
      }
    },
  }),
  createUIMessageStreamResponse:({stream,headers}:{stream:ReadableStream<Uint8Array>;headers:HeadersInit})=>
    new Response(stream,{headers}),
  stepCountIs:()=>()=>false,
  streamText:vi.fn(),
  tool:(definition:unknown)=>definition,
}));

import {POST} from './route';

function chatRequest(id?:string):Request {
  return new Request('http://localhost/api/chat',{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      ...(id!==undefined?{'x-libretv-request-id':id}:{}),
    },
    body:JSON.stringify({
      messages:[{id:'first-message',role:'user',parts:[{type:'text',text:'帮我找电影'}]}],
      sources:[],filterAdult:true,language:'zh',assistantId:'friday',playerActive:false,
    }),
  });
}

beforeEach(()=>{
  vi.clearAllMocks();
  mocks.mode='closed';
  mocks.register.mockReturnValue(true);
});
afterEach(()=>{mocks.mode='closed';});

describe('active Friday /api/chat distributed cancellation lifecycle',()=>{
  it('registers the browser request ID and releases it after the streamed response finishes',async()=>{
    const response=await POST(chatRequest('request_123'));
    expect(response.status).toBe(200);
    expect(mocks.register).toHaveBeenCalledOnce();
    const [id,owner,controller]=mocks.register.mock.calls[0] as [string,string,AbortController];
    expect(id).toBe('request_123');
    expect(owner).toBe('libretv-authenticated-user');
    expect(controller.signal.aborted).toBe(false);
    expect(await response.text()).toContain('data: test');
    expect(mocks.unregister).toHaveBeenCalledOnce();
    expect(mocks.unregister).toHaveBeenCalledWith('request_123');
  });

  it('aborts both the registered task and stream on consumer cancellation',async()=>{
    mocks.mode='hold';
    const response=await POST(chatRequest('request_client_stop'));
    expect(response.status).toBe(200);
    const controller=mocks.register.mock.calls[0][2] as AbortController;
    expect(controller.signal.aborted).toBe(false);
    await response.body?.cancel('browser closed player/chat');
    expect(controller.signal.aborted).toBe(true);
    expect(mocks.unregister).toHaveBeenCalledOnce();
    expect(mocks.unregister).toHaveBeenCalledWith('request_client_stop');
  });

  it('cleans up when cancellation originates from another instance',async()=>{
    mocks.mode='hold';
    const response=await POST(chatRequest('request_remote_stop'));
    const controller=mocks.register.mock.calls[0][2] as AbortController;
    controller.abort(new Error('CANCELLED_BY_CLIENT'));
    expect(mocks.unregister).toHaveBeenCalledOnce();
    expect(mocks.unregister).toHaveBeenCalledWith('request_remote_stop');
    await response.body?.cancel();
    expect(mocks.unregister).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid or already-registered request id without starting a stream',async()=>{
    expect((await POST(chatRequest('../invalid'))).status).toBe(400);
    expect(mocks.register).not.toHaveBeenCalled();
    mocks.register.mockReturnValue(false);
    expect((await POST(chatRequest('duplicate-request'))).status).toBe(409);
    expect(mocks.unregister).not.toHaveBeenCalled();
  });

  it('keeps compatibility with clients that do not supply the new header',async()=>{
    const response=await POST(chatRequest());
    expect(response.status).toBe(200);
    const [id]=mocks.register.mock.calls[0] as [string];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await response.text();
    expect(mocks.unregister).toHaveBeenCalledWith(id);
  });
});
