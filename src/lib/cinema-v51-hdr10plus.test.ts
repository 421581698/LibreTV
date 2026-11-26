import {describe,it,expect} from 'vitest';
import {cinemaParseHdr10PlusT35} from './cinema-v51-hdr10plus';

/** Independent test bit writer to exercise the complete ST2094-40 grammar. */
function t35Payload(knee=2048):Uint8Array {
 const bits:number[]=[];
 const write=(value:number,count:number)=>{
  for(let i=count-1;i>=0;i--) bits.push((value>>>i)&1);
 };
 write(1,2); // num_windows
 write(600,27); // targeted_display nits
 write(0,1); // targeted grid absent
 for(const raw of [10000,6000,2000]) write(raw,17); // 1000/600/200 nits
 write(8000,17); // avg 800 nits
 write(2,4); // 2 distribution percentile entries
 write(50,7);write(5000,17);
 write(99,7);write(10000,17);
 write(100,10); // 10% bright pixels
 write(0,1); // mastering peak grid absent
 write(1,1); // tone mapping enabled
 write(knee,12);write(2800,12);
 write(2,4);write(256,10);write(800,10);
 write(1,1);write(8,6); // color saturation weight
 while(bits.length%8!==0)bits.push(0);
 const output=new Uint8Array([0xb5,0,0x3c,0,1,4,1,...Array.from({length:bits.length/8},(_,j)=>{
  let b=0;for(let k=0;k<8;k++)b=(b<<1)|bits[j*8+k];return b;
 })]);
 return output;
}
describe('bounded HDR10+ T.35 parser',()=>{
 it('extracts MaxSCL, average RGB, distribution, knee, anchors and saturation',()=>{
  const report=cinemaParseHdr10PlusT35(t35Payload());
  expect(report.targetedDisplayNits).toBe(600);
  expect(report.windowCount).toBe(1);
  expect(report.windows[0].maxSclNits).toEqual([1000,600,200]);
  expect(report.windows[0].averageMaxRgbNits).toBe(800);
  expect(report.windows[0].distribution).toEqual([
    {percentage:50,luminanceNits:500},{percentage:99,luminanceNits:1000},
  ]);
  expect(report.windows[0].fractionBrightPixels).toBe(.1);
  expect(report.windows[0].kneeX).toBeCloseTo(2048/4095,6);
  expect(report.windows[0].kneeY).toBeCloseTo(2800/4095,6);
  expect(report.windows[0].bezierAnchors).toEqual([256/1023,800/1023]);
  expect(report.windows[0].colorSaturationWeight).toBe(1);
 });
 it('rejects truncated T35, wrong provider, unsupported version and trailing data',()=>{
  const valid=t35Payload();
  expect(()=>cinemaParseHdr10PlusT35(valid.subarray(0,10))).toThrow();
  const badProvider=valid.slice();badProvider[2]=0x3b;
  expect(()=>cinemaParseHdr10PlusT35(badProvider)).toThrow();
  const badVersion=valid.slice();badVersion[6]=2;
  expect(()=>cinemaParseHdr10PlusT35(badVersion)).toThrow();
  const extra=new Uint8Array([...valid,0,0]);
  expect(()=>cinemaParseHdr10PlusT35(extra)).toThrow();
 });
 it('rejects invalid bit grammar rather than inventing a dynamic scene',()=>{
  expect(()=>cinemaParseHdr10PlusT35(t35Payload(4095))).not.toThrow();
  const corrupt=t35Payload();
  corrupt[7]=0; // num_windows becomes zero
  expect(()=>cinemaParseHdr10PlusT35(corrupt)).toThrow();
 });
});
