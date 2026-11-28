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
  it('releases the renderer even if the decoder provider throws on stop',()=>{
    const t=harness();
    vi.mocked(t.provider.stop).mockImplementation(()=>{throw new Error('provider cleanup failed');});
    expect(()=>t.bridge.stop()).not.toThrow();
    expect(t.provider.stop).toHaveBeenCalledOnce();
    expect(t.renderer.stop).toHaveBeenCalledOnce();
    expect(t.bridge.active).toBe(false);
  });
  it('serializes two consecutive HDR frames without dropping PTS-bound metadata',async()=>{
    const t=harness();
    t.push(testFrame);
    t.push({...testFrame,frameIndex:1,ptsUs:1033333});
    await flush();
    expect(t.renderer.render).toHaveBeenCalledTimes(2);
    expect(t.events.map(e=>e.state)).toEqual(['processed','processed']);
    expect(t.events.map(e=>e.state==='processed'?e.ptsUs:-1)).toEqual([1000000,1033333]);
    expect(t.bridge.active).toBe(true);
    t.bridge.stop();
  });
  it('falls back safely when a burst exceeds the bounded HDR frame buffer',async()=>{
    let release!:()=>void;
    const blocked=new Promise<void>(resolve=>{release=resolve;});
    const t=harness();
    vi.mocked(t.renderer.render).mockImplementation(async()=>{await blocked;return true;});
    t.push(testFrame);
    t.push({...testFrame,frameIndex:1,ptsUs:1033333});
    t.push({...testFrame,frameIndex:2,ptsUs:1066666});
    release();
    await flush();
    expect(t.events.some(event=>event.state==='native-fallback')).toBe(true);
    expect(t.provider.stop).toHaveBeenCalled();
    expect(t.renderer.stop).toHaveBeenCalled();
    expect(t.bridge.active).toBe(false);
  });
  it('sustains 180 ordered authenticated HDR frames without spontaneous native fallback',async()=>{
    // Simulated 30 fps P010 frames. This guards sequencing and queue lifecycle,
    // not physical GPU throughput, power or panel HDR output.
    const t=harness();
    const total=180;
    const started=performance.now();
    for(let i=0;i<total;i++){
      const ptsUs=1000000+i*33333;
      t.push({...testFrame,frameIndex:i,ptsUs});
      await flush();
    }
    expect(t.events.filter(e=>e.state==='native-fallback')).toHaveLength(0);
    expect(t.renderer.render).toHaveBeenCalledTimes(total);
    const points=t.events.filter((e):e is Extract<CinemaFrameBridgeEvent,{state:'processed'}>=>e.state==='processed').map(e=>e.ptsUs);
    expect(points).toHaveLength(total);
    for(let i=0;i<total;i++)expect(points[i]).toBe(1000000+i*33333);
    expect(t.bridge.active).toBe(true);
    expect(performance.now()-started).toBeLessThan(10_000);
    t.bridge.stop();
    expect(t.provider.stop).toHaveBeenCalledOnce();
    expect(t.renderer.stop).toHaveBeenCalledOnce();
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
