import {describe,expect,it} from 'vitest';
import {cinemaWaitForPresentation} from './cinema-v51-clock';
const source='b'.repeat(64);
const clock=(time:number,playing=true)=>({
  sourceSha256:source,presentationOffsetUs:250000,
  currentMediaTimeSeconds:()=>time,playing:()=>playing,
});
describe('Cinema presentation clock and HDR10+ PTS synchronization',()=>{
  it('renders only inside the video media-time presentation window',async()=>{
    expect(await cinemaWaitForPresentation(1275000,clock(1.0))).toBe('ready');
    expect(await cinemaWaitForPresentation(1100000,clock(1.0))).toBe('late');
  });
  it('waits for actual media clock advance and refuses stale or detached source time',async()=>{
    let current=1,now=0;
    const advance=async()=>{current+=.016;now+=16;};
    const status=await cinemaWaitForPresentation(1350000,{
      ...clock(1),currentMediaTimeSeconds:()=>current,
    },{sleep:advance,now:()=>now});
    expect(status).toBe('ready');
    expect(current).toBeGreaterThan(1.06);
  });
  it('fails closed if playback never starts or the user seeks away',async()=>{
    let now=0;
    expect(await cinemaWaitForPresentation(2000000,clock(1,false),{
      now:()=>now,sleep:async()=>{now+=100;},
    })).toBe('expired');
    expect(await cinemaWaitForPresentation(1250000,clock(1),{
      cancelled:()=>true,
    })).toBe('cancelled');
    expect(await cinemaWaitForPresentation(1250000,{
      ...clock(1),sourceSha256:'changed-source',
    })).toBe('expired');
  });
});
