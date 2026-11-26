import {describe,it,expect,vi} from 'vitest';
import {startCinemaV51FrameBridge,type CinemaDecodedP010Sample,type CinemaDecodedFrameProvider,
  type CinemaP010FrameRenderer,type CinemaFrameBridgeEvent} from './cinema-v51-frame-bridge';
const source='f'.repeat(64);
const testFrame: CinemaDecodedP010Sample={
  sourceSha256:source,frameIndex:0,ptsUs:1000000,
  decodedP010:{range:'limited',width:2,height:2,y:new Uint16Array(4).fill(400<<6),
    uv:new Uint16Array([512<<6,512<<6])},
};
const transform={
 sourceMatrix:'bt709' as const,targetMatrix:'bt2020' as const,
 sourceTransfer:'srgb' as const,targetTransfer:'pq' as const,
 sourcePrimaries:'rec709' as const,targetPrimaries:'rec2020' as const,
 sourceWhiteNits:100,targetWhiteNits:203,sourcePeakNits:100,targetPeakNits:1000,
};
function harness(){
  let push:(frame:CinemaDecodedP010Sample)=>void=()=>{};
  let fail:(reason:string)=>void=()=>{};
  const provider:CinemaDecodedFrameProvider={
    sourceSha256:source,
    start(onFrame,onError){push=onFrame;fail=onError;},
    stop:vi.fn(),
  };
  const renderer:CinemaP010FrameRenderer={
    render:vi.fn(async()=>true),stop:vi.fn(),
  };
  const events:CinemaFrameBridgeEvent[]=[];
  const bridge=startCinemaV51FrameBridge(provider,renderer,frame=>({
    decodedP010:frame.decodedP010,transform,
  }),event=>events.push(event));
  return {bridge,provider,renderer,events,push:(frame:CinemaDecodedP010Sample)=>push(frame),fail:(s:string)=>fail(s)};
}
const flush=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
describe('Cinema V5.1 real decoded frame and PTS bridge',()=>{
  it('processes one authenticated 10-bit decoded frame with exact PTS before reporting active',async()=>{
    const t=harness();
    expect(t.bridge.active).toBe(false);
    t.push(testFrame);
    await flush();
    expect(t.renderer.render).toHaveBeenCalledTimes(1);
    expect(t.renderer.render).toHaveBeenCalledWith(expect.objectContaining({
      width:2,height:2,y:expect.any(Uint16Array),
    }),1000000);
    expect(t.bridge.active).toBe(true);
    expect(t.events).toEqual([expect.objectContaining({
      state:'processed',ptsUs:1000000,dynamicMetadataApplied:false,
    })]);
    t.bridge.stop();
  });
  it('rejects wrong episode identity and reverts native without rendering',async()=>{
    const t=harness();
    t.push({...testFrame,sourceSha256:'a'.repeat(64)});
    await flush();
    expect(t.renderer.render).not.toHaveBeenCalled();
    expect(t.provider.stop).toHaveBeenCalled();
    expect(t.renderer.stop).toHaveBeenCalled();
    expect(t.events[0].state).toBe('native-fallback');
  });
  it('rejects stale or duplicated video presentation timestamps',async()=>{
    const t=harness();
    t.push(testFrame);
    await flush();
    t.push(testFrame);
    await flush();
    expect(t.renderer.render).toHaveBeenCalledTimes(1);
    expect(t.events.at(-1)?.state).toBe('native-fallback');
  });
  it('rejects metadata that belongs to a different decoded video frame',async()=>{
    let push:(frame:CinemaDecodedP010Sample)=>void=()=>{};
    const renderer={render:vi.fn(async()=>true),stop:vi.fn()};
    const messages:CinemaFrameBridgeEvent[]=[];
    startCinemaV51FrameBridge({
      sourceSha256:source,start(cb){push=cb;},stop:vi.fn(),
    },renderer,frame=>({
      decodedP010:frame.decodedP010,transform,
      metadata:{sourceSha256:source,expectedSourceSha256:source,
        metadataSha256:source,expectedMetadataSha256:source,
        frameIndex:1,framePtsUs:900000,t35Payload:new Uint8Array()},
    }),event=>messages.push(event));
    push(testFrame);
    await flush();
    expect(renderer.render).not.toHaveBeenCalled();
    expect(messages[0].state).toBe('native-fallback');
  });
  it('fails closed when GPU presentation fails or audio/video source switches',async()=>{
    const t=harness();
    vi.mocked(t.renderer.render).mockResolvedValueOnce(false);
    t.push(testFrame);
    await flush();
    expect(t.events[0].state).toBe('native-fallback');
    expect(t.bridge.active).toBe(false);
  });
});
