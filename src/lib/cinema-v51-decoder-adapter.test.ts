import {describe,it,expect,vi} from 'vitest';
import {cinemaExtractP010VideoFrame,createCinemaWebCodecsDecodedProvider} from './cinema-v51-decoder-adapter';
function rawFrame(
  timestamp=1000000, stride=8, primaries='bt2020', fullRange=false,
){
 const raw=new Uint8Array(24);
 const view=new DataView(raw.buffer);
 for(let i=0;i<4;i++)view.setUint16(Math.floor(i/2)*stride+(i%2)*2,(64+i*100)<<6,true);
 view.setUint16(16,512<<6,true);
 view.setUint16(18,512<<6,true);
 const close=vi.fn();
 return {
  timestamp,format:'P010',codedWidth:2,codedHeight:2,
  colorSpace:{fullRange,primaries,transfer:'smpte2084',matrix:'bt2020-ncl'},
  allocationSize:()=>24,
  copyTo:async(out:AllowSharedBufferSource)=>{
   const target=out instanceof ArrayBuffer ||
     (typeof SharedArrayBuffer!=='undefined' && out instanceof SharedArrayBuffer)
       ? new Uint8Array(out)
       : new Uint8Array((out as ArrayBufferView).buffer,(out as ArrayBufferView).byteOffset,(out as ArrayBufferView).byteLength);
   target.set(raw);
   return [{offset:0,stride},{offset:16,stride:4}];
  },
  close,
 };
}
const pause=()=>new Promise<void>(r=>setTimeout(r,0));
describe('WebCodecs authentic P010 adapter',()=>{
 it('unpacks padded per-plane 16-bit stride with preserved PTS',async()=>{
  const frame=rawFrame();
  const result=await cinemaExtractP010VideoFrame(frame);
  expect(result).toEqual({
    range:'limited',width:2,height:2,
    y:new Uint16Array([64<<6,164<<6,264<<6,364<<6]),
    uv:new Uint16Array([512<<6,512<<6]),
  });
 });
 it('forwards true decoder frame identity and closes all decoded frames',async()=>{
  let emit:(f:ReturnType<typeof rawFrame>)=>void=()=>{};
  const source='a'.repeat(64);
  const decoder={start(cb:typeof emit){emit=cb;},stop:vi.fn()};
  const provider=createCinemaWebCodecsDecodedProvider({
    sourceSha256:source,decoder,expectedPrimaries:'bt2020',expectedTransfer:'smpte2084',
  });
  const frames:unknown[]=[],errors:string[]=[];
  provider.start(frame=>frames.push(frame),msg=>errors.push(msg));
  const frame=rawFrame();
  emit(frame);
  await pause();
  expect(frames).toEqual([expect.objectContaining({sourceSha256:source,ptsUs:1000000,frameIndex:0})]);
  expect(errors).toEqual([]);
  expect(frame.close).toHaveBeenCalledOnce();
  provider.stop();
  expect(decoder.stop).toHaveBeenCalledOnce();
 });
 it('rejects converted SDR, full-range, or wrong primaries and restores native decoder path',async()=>{
  const incorrect=rawFrame(1000000,8,'bt709');
  await expect(cinemaExtractP010VideoFrame(rawFrame(1,8,'bt2020',true))).rejects.toThrow();
  let emit:(f:ReturnType<typeof rawFrame>)=>void=()=>{};
  const decoder={start(cb:typeof emit){emit=cb;},stop:vi.fn()};
  const provider=createCinemaWebCodecsDecodedProvider({
    sourceSha256:'a'.repeat(64),decoder,expectedPrimaries:'bt2020',expectedTransfer:'smpte2084',
  });
  const errors:string[]=[];
  provider.start(()=>{},msg=>errors.push(msg));
  emit(incorrect);
  await pause();
  expect(errors).toHaveLength(1);
  expect(decoder.stop).toHaveBeenCalledOnce();
  expect(incorrect.close).toHaveBeenCalledOnce();
 });
 it('fails closed when decoded presentation frames are repeated or out of order',async()=>{
  let emit:(f:ReturnType<typeof rawFrame>)=>void=()=>{};
  const decoder={start(cb:typeof emit){emit=cb;},stop:vi.fn()};
  const provider=createCinemaWebCodecsDecodedProvider({
    sourceSha256:'a'.repeat(64),decoder,expectedPrimaries:'bt2020',expectedTransfer:'smpte2084',
  });
  const frames:unknown[]=[],errors:string[]=[];
  provider.start(frame=>frames.push(frame),reason=>errors.push(reason));
  emit(rawFrame(1000000));emit(rawFrame(999999));
  await pause();
  expect(frames).toHaveLength(1);
  expect(errors).toHaveLength(1);
  expect(decoder.stop).toHaveBeenCalledOnce();
 });
 it('caps pending native VideoFrame copies and releases the excess frame',async()=>{
  let emit:(f:ReturnType<typeof rawFrame>)=>void=()=>{};
  let release!:()=>void;
  const blocker=new Promise<void>(resolve=>{release=resolve;});
  const decoder={start(cb:typeof emit){emit=cb;},stop:vi.fn()};
  const provider=createCinemaWebCodecsDecodedProvider({
   sourceSha256:'a'.repeat(64),decoder,expectedPrimaries:'bt2020',expectedTransfer:'smpte2084',
  });
  const errors:string[]=[];
  provider.start(()=>{},reason=>errors.push(reason));
  const frames=Array.from({length:4},(_,i)=>({
   ...rawFrame(1000000+i*33333),
   copyTo:async(out:AllowSharedBufferSource)=>{
    await blocker;
    return rawFrame(1000000+i*33333).copyTo(out);
   },
  }));
  frames.forEach(emit);
  expect(errors).toEqual(['Decoded video frame-copy backpressure exceeded']);
  expect(decoder.stop).toHaveBeenCalledOnce();
  expect(frames[3].close).toHaveBeenCalledOnce();
  release();
  await pause();
  await pause();
  frames.slice(0,3).forEach(frame=>expect(frame.close).toHaveBeenCalledOnce());
 });
 it('refuses invalid plane offsets/strides or unknown format',async()=>{
  await expect(cinemaExtractP010VideoFrame({...rawFrame(),format:'I420'})).rejects.toThrow();
  await expect(cinemaExtractP010VideoFrame(rawFrame(0,1))).rejects.toThrow();
 });
});
