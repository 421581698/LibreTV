import {describe,expect,it} from 'vitest';
import {cinemaSupportsExtendedConfiguration} from './cinema-v51-webgpu-presenter';
import {cinemaCanMountAuthorizedPlayback,type CinemaV51AuthorizedPlayback} from './cinema-v51-playback-mount';
const raw=(async function*(){yield {sourceSha256:'d'.repeat(64),ptsUs:0,durationUs:33333,key:true,data:new Uint8Array([0x26,1])};})();
const authorized:CinemaV51AuthorizedPlayback={
  mediaUrl:'https://example.test/authorized.m3u8',
  track:{
    sourceSha256:'d'.repeat(64),
    codec:'hvc1.2.4.L153.B0',codedWidth:640,codedHeight:360,
    packets:raw,
  },
  presentationOffsetUs:0,
  transform:{
    sourceTransfer:'pq',targetTransfer:'pq',
    sourcePrimaries:'rec2020',targetPrimaries:'rec2020',
    sourceMatrix:'bt2020',targetMatrix:'bt2020',
    sourceWhiteNits:203,targetWhiteNits:203,
    sourcePeakNits:1000,targetPeakNits:1000,
  },
};
describe('Cinema V5.1 verified HDR video mount gate',()=>{
  it('requires an independently supplied trusted stream, not a generic HLS url',()=>{
    expect(cinemaCanMountAuthorizedPlayback(authorized.mediaUrl,authorized)).toBe(true);
    expect(cinemaCanMountAuthorizedPlayback('https://example.test/untrusted.m3u8',authorized)).toBe(false);
    expect(cinemaCanMountAuthorizedPlayback(authorized.mediaUrl,{
      ...authorized,track:{...authorized.track,sourceSha256:'invalid'},
    })).toBe(false);
    expect(cinemaCanMountAuthorizedPlayback(authorized.mediaUrl,{
      ...authorized,transform:{...authorized.transform,targetPrimaries:'display-p3'},
    })).toBe(false);
  });
  it('requires actual float16 extended WebGPU mode, never 8-bit or standard mode',()=>{
    expect(cinemaSupportsExtendedConfiguration({
      format:'rgba16float',colorSpace:'display-p3',toneMapping:{mode:'extended'},
    })).toBe(true);
    expect(cinemaSupportsExtendedConfiguration({
      format:'bgra8unorm',colorSpace:'display-p3',toneMapping:{mode:'extended'},
    })).toBe(false);
    expect(cinemaSupportsExtendedConfiguration({
      format:'rgba16float',colorSpace:'display-p3',toneMapping:{mode:'standard'},
    })).toBe(false);
    expect(cinemaSupportsExtendedConfiguration(null)).toBe(false);
  });
});
