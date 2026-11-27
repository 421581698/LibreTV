import {describe,it,expect} from 'vitest';
import {assessCinemaHdrPixelOutput} from './cinema-v51-hdr-output-evidence';
const before={range:'limited' as const,width:2,height:2,
 y:Uint16Array.from([100<<6,200<<6,300<<6,400<<6]),
 uv:Uint16Array.from([512<<6,512<<6])};
const changed={...before,y:Uint16Array.from([100<<6,220<<6,320<<6,400<<6])};
const base={
 sourceSha256:'a'.repeat(64),expectedSourceSha256:'a'.repeat(64),
 decodedPtsUs:33367,submittedPtsUs:33367,decoded:before,transformed:changed,
 outputTransfer:'pq' as const,gpuSubmissionConfirmed:true,
 gpuConfiguration:{format:'rgba16float',colorSpace:'display-p3',toneMapping:{mode:'extended'}},
};
describe('actual 10-bit transformed HDR pixel path observation',()=>{
 it('measures a changed P010 sample and a confirmed extended-range GPU submission',()=>{
  expect(assessCinemaHdrPixelOutput(base)).toEqual({
   stage:'extended-gpu-submitted',highPrecisionSamplesModified:true,
   extendedGpuSubmission:true,physicalHdrOutput:'unverified',
  });
 });
 it('cannot upgrade into real display HDR by CSS query, SDR surface, stale frame or unsupported canvas',()=>{
  expect(assessCinemaHdrPixelOutput({...base,gpuSubmissionConfirmed:false}).stage).toBe('modified-p010-10bit');
  expect(assessCinemaHdrPixelOutput({...base,outputTransfer:'sdr'}).extendedGpuSubmission).toBe(false);
  expect(assessCinemaHdrPixelOutput({...base,submittedPtsUs:33368}).extendedGpuSubmission).toBe(false);
  expect(assessCinemaHdrPixelOutput({...base,gpuConfiguration:{format:'bgra8unorm'}}).extendedGpuSubmission).toBe(false);
  expect(assessCinemaHdrPixelOutput({...base,transformed:before}).stage).toBe('decoded-p010-10bit');
  expect(assessCinemaHdrPixelOutput({...base,sourceSha256:'b'.repeat(64)}).stage).toBe('not-established');
  expect(assessCinemaHdrPixelOutput({...base,transformed:{...changed,y:new Uint16Array([1,2,3,4])}}).stage).toBe('not-established');
 });
});
