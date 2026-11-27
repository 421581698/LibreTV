import {describe,it,expect} from 'vitest';
import {cinemaBuildVerifiedRpuL1Job,cinemaRpuPtsToMicroseconds} from './cinema-v51-rpu-frame-binding';
const source='a'.repeat(64),rpu='b'.repeat(64),mappingDigest='c'.repeat(64);
const mapping={sourceMediaSha256:source,mappingSha256:mappingDigest,timeBase:{numerator:1,denominator:90000},frameCount:1};
const l1={version:1 as const,sourceMediaSha256:source,mappingSha256:mappingDigest,
 playerRpuApplication:'not-verified' as const,
 frames:[{frameOrdinal:0,pts:'3003',rpuSha256:rpu,minPq:0,avgPq:1600,maxPq:3400}]};
const sample={sourceSha256:source,frameIndex:0,ptsUs:33367,
 decodedP010:{range:'limited' as const,width:2,height:2,y:new Uint16Array(4).fill(500<<6),
 uv:new Uint16Array([512<<6,512<<6])}};
const transform={sourceTransfer:'pq' as const,targetTransfer:'srgb' as const,
 sourcePrimaries:'rec2020' as const,targetPrimaries:'rec709' as const,
 sourceMatrix:'bt2020' as const,targetMatrix:'bt709' as const,
 sourceWhiteNits:203,targetWhiteNits:100,sourcePeakNits:1000,targetPeakNits:100};
describe('authorized RPU-to-P010 frame binding',()=>{
 it('maps timebase and RPU unit to exact decoder frame',()=>{
   expect(cinemaRpuPtsToMicroseconds('3003',mapping.timeBase)).toBe(33367);
   const job=cinemaBuildVerifiedRpuL1Job(sample,transform,mapping,l1);
   expect(job.rpuL1?.maxPq).toBe(3400);
   expect(job.rpuL1?.framePtsUs).toBe(sample.ptsUs);
 });
 it('rejects a different source, timestamp, mapping signature, or missing metadata',()=>{
   for(const value of [
     {...sample,ptsUs:33366},
     {...sample,sourceSha256:'d'.repeat(64)},
     {...sample,frameIndex:1},
   ])expect(()=>cinemaBuildVerifiedRpuL1Job(value,transform,mapping,l1)).toThrow();
   expect(()=>cinemaBuildVerifiedRpuL1Job(sample,transform,mapping,{...l1,mappingSha256:'f'.repeat(64)})).toThrow();
   expect(()=>cinemaBuildVerifiedRpuL1Job(sample,transform,mapping,{...l1,frames:[]})).toThrow();
   expect(()=>cinemaBuildVerifiedRpuL1Job(sample,{...transform,sourceTransfer:'srgb'},mapping,l1)).toThrow();
 });
});
