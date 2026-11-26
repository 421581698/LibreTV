import {describe,it,expect} from 'vitest';
import {cinemaPqOetf} from './cinema-v51-color';
import {cinemaResolveDynamicFrame,cinemaValidateMetadata,cinemaTransform10BitFrame,cinemaHdr10PlusToneMap,
  cinemaTransformMetadataFrame,type CinemaMetadataEnvelope} from './cinema-v51-metadata';
const sha='e'.repeat(64);
const envelope:CinemaMetadataEnvelope={
 sourceSha256:sha,
 mastering:{maxDisplayNits:1000,minDisplayNits:.005,maxContentLightNits:1200,maxFrameAverageLightNits:400},
 frames:[
  {frameIndex:100,framePtsUs:3333333,targetedPeakNits:600,
   maxSclNits:[1200,600,300],averageMaxRgbNits:400,kneePoint:.48,provenance:'verified-st2094-40'},
  {frameIndex:101,framePtsUs:3366666,targetedPeakNits:600,
   maxSclNits:[900,550,250],averageMaxRgbNits:350,kneePoint:.72,provenance:'verified-st2094-40'},
 ],
};
const opt={sourceTransfer:'pq' as const,targetTransfer:'srgb' as const,
 sourcePrimaries:'rec2020' as const,targetPrimaries:'rec709' as const,
 sourceWhiteNits:203,targetWhiteNits:100,sourcePeakNits:1200,targetPeakNits:100};
describe('Cinema V5.1 metadata / 10-bit pipeline',()=>{
 it('validates a trusted sample-bound HDR metadata timeline',()=>{
  expect(cinemaValidateMetadata(envelope)).toBe(envelope);
  expect(cinemaResolveDynamicFrame(envelope,3333333,sha)?.frameIndex).toBe(100);
  expect(cinemaResolveDynamicFrame(envelope,3366666,sha)?.frameIndex).toBe(101);
  expect(cinemaResolveDynamicFrame(envelope,3333333,'f'.repeat(64))).toBeNull();
  expect(cinemaResolveDynamicFrame(envelope,3000000,sha)).toBeNull();
  expect(cinemaResolveDynamicFrame(envelope,3900000,sha)).toBeNull();
 });
 it('rejects absent evidence and inconsistent metadata rather than treating PQ as HDR10+',()=>{
  expect(()=>cinemaValidateMetadata({...envelope,sourceSha256:'unbound'})).toThrow();
  expect(()=>cinemaValidateMetadata({...envelope,frames:[{...envelope.frames[0],provenance:'unverified' as never}]})).toThrow();
  expect(()=>cinemaValidateMetadata({...envelope,frames:[envelope.frames[1],envelope.frames[0]]})).toThrow();
  expect(()=>cinemaValidateMetadata({...envelope,frames:[{...envelope.frames[0],kneePoint:3}]})).toThrow();
 });
 it('changes packed 10-bit pixel values from verified per-frame knee metadata',()=>{
  const n=cinemaPqOetf(900);
  const code=Math.round(n*1023);
  const input=new Uint16Array([code,code,code]);
  const first=cinemaTransform10BitFrame(input,opt,envelope.mastering,envelope.frames[0]);
  const second=cinemaTransform10BitFrame(input,opt,envelope.mastering,envelope.frames[1]);
  expect(first.every(v=>v>=0&&v<=1023)).toBe(true);
  expect(second.every(v=>v>=0&&v<=1023)).toBe(true);
  expect(first[0]).not.toBe(second[0]);
  expect(()=>cinemaTransform10BitFrame(new Uint16Array([1,2]),opt)).toThrow();
  expect(()=>cinemaTransform10BitFrame(new Uint16Array([1024,0,0]),opt)).toThrow();
 });
 it('actually applies registered per-frame Bezier anchors rather than discarding the curve',()=>{
  const basis={...envelope.frames[0],kneePoint:.5,kneePointY:.6};
  const raised={...basis,bezierAnchors:[.95,.95]};
  const lowered={...basis,bezierAnchors:[.15,.15]};
  const a=cinemaHdr10PlusToneMap(800,1000,100,raised);
  const b=cinemaHdr10PlusToneMap(800,1000,100,lowered);
  expect(a).toBeGreaterThan(b);
  expect(a).toBeLessThanOrEqual(100);
  expect(b).toBeGreaterThanOrEqual(0);
  const transformedHigh=cinemaTransformMetadataFrame(
    [cinemaPqOetf(800),cinemaPqOetf(500),cinemaPqOetf(100)],
    opt,envelope.mastering,raised);
  const transformedLow=cinemaTransformMetadataFrame(
    [cinemaPqOetf(800),cinemaPqOetf(500),cinemaPqOetf(100)],
    opt,envelope.mastering,lowered);
  expect(transformedHigh[0]).not.toBeCloseTo(transformedLow[0],3);
  expect(()=>cinemaValidateMetadata({...envelope,frames:[{...raised,bezierAnchors:[1.5]}]})).toThrow();
 });
 it('uses the normative knee and shoulder anchors at exact boundaries',()=>{
  const frame={...envelope.frames[0],kneePoint:.4,kneePointY:.55,bezierAnchors:[.1,.9]};
  expect(cinemaHdr10PlusToneMap(400,1000,100,frame)).toBeCloseTo(55,6);
  expect(cinemaHdr10PlusToneMap(1000,1000,100,frame)).toBeCloseTo(100,6);
  expect(cinemaHdr10PlusToneMap(0,1000,100,frame)).toBe(0);
  const below=cinemaHdr10PlusToneMap(399.999,1000,100,frame);
  const above=cinemaHdr10PlusToneMap(400.001,1000,100,frame);
  expect(Math.abs(below-above)).toBeLessThan(.01);
 });
 it('handles static mastering metadata independently of missing dynamic fields',()=>{
  const result=cinemaTransformMetadataFrame([cinemaPqOetf(200),cinemaPqOetf(100),cinemaPqOetf(40)],opt,
     envelope.mastering,null);
  expect(result.every(v=>Number.isFinite(v)&&v>=0&&v<=1)).toBe(true);
 });
});
