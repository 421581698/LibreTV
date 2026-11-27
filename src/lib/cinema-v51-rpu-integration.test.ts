import {describe,it,expect,vi} from 'vitest';
import {startCinemaV51FrameBridge,type CinemaDecodedP010Sample,type CinemaFrameBridgeEvent} from './cinema-v51-frame-bridge';
import {cinemaBuildVerifiedRpuL1Job} from './cinema-v51-rpu-frame-binding';
const source='f'.repeat(64),rpu='a'.repeat(64),map='b'.repeat(64);
const mapping={sourceMediaSha256:source,mappingSha256:map,timeBase:{numerator:1,denominator:90000},frameCount:1};
const l1={version:1 as const,sourceMediaSha256:source,mappingSha256:map,playerRpuApplication:'not-verified' as const,
 frames:[{frameOrdinal:0,pts:'3003',rpuSha256:rpu,minPq:0,avgPq:1500,maxPq:3200}]};
const transform={
 sourceTransfer:'pq' as const,targetTransfer:'srgb' as const,
 sourcePrimaries:'rec2020' as const,targetPrimaries:'rec709' as const,
 sourceMatrix:'bt2020' as const,targetMatrix:'bt709' as const,
 sourceWhiteNits:203,targetWhiteNits:100,sourcePeakNits:1000,targetPeakNits:100,
};
const sample: CinemaDecodedP010Sample={sourceSha256:source,frameIndex:0,ptsUs:33367,
 decodedP010:{range:'limited',width:2,height:2,
  y:new Uint16Array(4).fill(580<<6),uv:new Uint16Array([512<<6,512<<6])}};
const tick=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
describe('authenticated PCM-independent RPU signed P010 frame bus',()=>{
 it('passes exact sample PTS and real L1 through 10-bit pixel transform before renderer reports success',async()=>{
  let ingest:(frame:CinemaDecodedP010Sample)=>void=()=>{};
  const renderer={render:vi.fn(async()=>true),stop:vi.fn()};
  const events:CinemaFrameBridgeEvent[]=[];
  const bridge=startCinemaV51FrameBridge({
   sourceSha256:source,start(onFrame){ingest=onFrame;},stop:vi.fn(),
  },renderer,frame=>cinemaBuildVerifiedRpuL1Job(frame,transform,mapping,l1),ev=>events.push(ev));
  ingest(sample);
  await tick();
  expect(bridge.active).toBe(true);
  expect(renderer.render).toHaveBeenCalledWith(expect.objectContaining({
   y:expect.any(Uint16Array),uv:expect.any(Uint16Array)}),33367);
  expect(events).toEqual([expect.objectContaining({
   state:'processed',ptsUs:33367,dynamicMetadataApplied:true,
  })]);
  bridge.stop();
 });
 it('does not display mismatched frame metadata after source or timestamp drift',async()=>{
  let ingest:(frame:CinemaDecodedP010Sample)=>void=()=>{};
  const renderer={render:vi.fn(async()=>true),stop:vi.fn()};
  const events:CinemaFrameBridgeEvent[]=[];
  startCinemaV51FrameBridge({
   sourceSha256:source,start(onFrame){ingest=onFrame;},stop:vi.fn(),
  },renderer,frame=>cinemaBuildVerifiedRpuL1Job(frame,transform,mapping,l1),ev=>events.push(ev));
  ingest({...sample,ptsUs:33368});
  await tick();
  expect(renderer.render).not.toHaveBeenCalled();
  expect(events[0]?.state).toBe('native-fallback');
 });
});
