import {describe,it,expect} from 'vitest';
import {cinemaTransformP010Frame} from './cinema-v51-p010';

const sdrToHdr={
 sourceMatrix:'bt709' as const,targetMatrix:'bt2020' as const,
 sourceTransfer:'srgb' as const,targetTransfer:'pq' as const,
 sourcePrimaries:'rec709' as const,targetPrimaries:'rec2020' as const,
 sourceWhiteNits:100,targetWhiteNits:203,sourcePeakNits:100,targetPeakNits:1000,
};
const hdrToSdr={
 sourceMatrix:'bt2020' as const,targetMatrix:'bt709' as const,
 sourceTransfer:'pq' as const,targetTransfer:'srgb' as const,
 sourcePrimaries:'rec2020' as const,targetPrimaries:'rec709' as const,
 sourceWhiteNits:203,targetWhiteNits:100,sourcePeakNits:1000,targetPeakNits:100,
};
describe('Cinema P010 true 10-bit YUV420 transformer',()=>{
 it('transforms decoded 2x2 SDR limited-range YUV into valid HDR/PQ 10-bit samples',()=>{
  const neutral=32768; // 512/1023 chroma neutral
  const frame={width:2,height:2,y:new Uint16Array([100<<6,300<<6,600<<6,900<<6]),
    uv:new Uint16Array([neutral,neutral])};
  const out=cinemaTransformP010Frame(frame,sdrToHdr);
  expect(out.y.length).toBe(4);
  expect(out.uv.length).toBe(2);
  expect(out.y.every(n=>n>=64*64&&n<=940*64&&n%64===0)).toBe(true);
  expect(out.uv.every(n=>n>=64*64&&n<=960*64&&n%64===0)).toBe(true);
  expect(Array.from(out.y)).not.toEqual(Array.from(frame.y));
  expect(Array.from(frame.y)).toEqual([6400,19200,38400,57600]); // input untouched
 });
 it('converts HDR PQ into SDR pixels with bounded chroma and near-neutral grey',()=>{
  const input={width:2,height:2,y:new Uint16Array(4).fill(680<<6),
    uv:new Uint16Array([512<<6,512<<6])};
  const out=cinemaTransformP010Frame(input,hdrToSdr);
  expect(out.y.every(v=>v<940*64)).toBe(true);
  expect(out.uv[0]).toBeCloseTo(512<<6,-2);
  expect(out.uv[1]).toBeCloseTo(512<<6,-2);
 });
 it('rejects invalid P010 plane dimensions, nonaligned and oversized frames',()=>{
  expect(()=>cinemaTransformP010Frame({width:2,height:2,y:new Uint16Array(3),uv:new Uint16Array(2)},hdrToSdr)).toThrow();
  expect(()=>cinemaTransformP010Frame({width:3,height:2,y:new Uint16Array(6),uv:new Uint16Array(3)},hdrToSdr)).toThrow();
  expect(()=>cinemaTransformP010Frame({width:2,height:2,y:new Uint16Array([4,0,0,0]),uv:new Uint16Array(2)},hdrToSdr)).toThrow();
  expect(()=>cinemaTransformP010Frame({width:4096,height:2160,y:new Uint16Array(),uv:new Uint16Array()},hdrToSdr)).toThrow();
 });
});
