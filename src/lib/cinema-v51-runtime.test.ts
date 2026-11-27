import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {cinemaProcessV51Frame,cinemaVerifyHdr10PlusSample} from './cinema-v51-runtime';

function makePayload():Uint8Array {
 const bits:number[]=[];
 const write=(value:number,count:number)=>{for(let k=count-1;k>=0;k--)bits.push((value>>>k)&1);};
 write(1,2);write(8_000_000,27);write(0,1);
 for(const value of [5000,5000,5000])write(value,17);
 write(4000,17);write(0,4);write(100,10);
 write(0,1);write(1,1);write(2048,12);write(2200,12);write(0,4);write(0,1);
 while(bits.length%8!==0)bits.push(0);
 const bytes=[0xb5,0,0x3c,0,1,4,1];
 for(let i=0;i<bits.length;i+=8){let b=0;for(let k=0;k<8;k++)b=(b<<1)|bits[i+k];bytes.push(b);}
 return Uint8Array.from(bytes);
}
const mastering={maxDisplayNits:1000,minDisplayNits:.005,maxContentLightNits:1000};
const transform={
 sourceTransfer:'pq' as const,targetTransfer:'srgb' as const,
 sourcePrimaries:'rec2020' as const,targetPrimaries:'rec709' as const,
 sourceMatrix:'bt2020' as const,targetMatrix:'bt709' as const,
 sourceWhiteNits:203,targetWhiteNits:100,sourcePeakNits:1000,targetPeakNits:100,
 mastering,
};
const payload=makePayload();
const digest=createHash('sha256').update(payload).digest('hex');
const sample={
 sourceSha256:'a'.repeat(64),expectedSourceSha256:'a'.repeat(64),
 metadataSha256:digest,expectedMetadataSha256:digest,
 frameIndex:17,framePtsUs:700000,t35Payload:payload,
};
const frame={range:'limited' as const,width:2,height:2,y:new Uint16Array(4).fill(680<<6),
 uv:new Uint16Array([512<<6,512<<6])};
describe('Cinema V5.1 HDR10+ integrated 10-bit runtime',()=>{
 it('checks SHA256 before binding dynamic tone metadata to one P010 sample',async()=>{
  const bound=await cinemaVerifyHdr10PlusSample(sample);
  expect(bound.frameIndex).toBe(17);
  expect(bound.maxSclNits).toEqual([500,500,500]);
  expect(bound.provenance).toBe('verified-st2094-40');
  const result=await cinemaProcessV51Frame({decodedP010:frame,transform,metadata:sample});
  expect(result.colorConversion).toBe('software-p010-10bit');
  expect(result.dynamicMetadataApplied).toBe(true);
  expect(result.displayHdrOutput).toBe('unverified');
  expect(result.frame.y[0]).toBeGreaterThan(0);
 });
 it('rejects a changed payload despite the same declared source identity',async()=>{
  const corrupt=payload.slice();corrupt[10]^=1;
  await expect(cinemaVerifyHdr10PlusSample({...sample,t35Payload:corrupt})).rejects.toThrow();
  await expect(cinemaVerifyHdr10PlusSample({...sample,expectedSourceSha256:'b'.repeat(64)})).rejects.toThrow();
 });
 it('runs static 10-bit conversion without fabricating HDR10+ on missing metadata',async()=>{
  const result=await cinemaProcessV51Frame({decodedP010:frame,transform});
  expect(result.dynamicMetadataApplied).toBe(false);
  expect(result.frame.y.length).toBe(4);
 });
});

describe('Cinema RPU L1 frame processing on true decoded P010',()=>{
  const source='f'.repeat(64);
  const l1={sourceSha256:source,expectedSourceSha256:source,
    rpuSha256:'b'.repeat(64),expectedRpuSha256:'b'.repeat(64),
    frameIndex:0,framePtsUs:0,minPq:0,avgPq:1600,maxPq:3200};
  it('makes different actual 10-bit pixels for differing signed frame luminance',async()=>{
    const a=await cinemaProcessV51Frame({decodedP010:frame,transform,rpuL1:l1});
    const b=await cinemaProcessV51Frame({decodedP010:frame,transform,
      rpuL1:{...l1,maxPq:3800}});
    expect(a.dynamicMetadataApplied).toBe(true);
    expect(a.frame.y).not.toEqual(b.frame.y);
    expect(a.displayHdrOutput).toBe('unverified');
    expect(a.reason).toContain('自研');
  });
  it('fails on wrong source, invalid PQ levels and mixed HDR10+ paths',async()=>{
    await expect(cinemaProcessV51Frame({decodedP010:frame,transform,
      rpuL1:{...l1,expectedSourceSha256:'a'.repeat(64)}})).rejects.toThrow();
    await expect(cinemaProcessV51Frame({decodedP010:frame,transform,
      rpuL1:{...l1,avgPq:4000,maxPq:3000}})).rejects.toThrow();
    await expect(cinemaProcessV51Frame({decodedP010:frame,transform,rpuL1:l1,metadata:sample})).rejects.toThrow();
  });
});
