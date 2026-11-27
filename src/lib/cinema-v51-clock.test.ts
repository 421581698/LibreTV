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
  it('cancels an in-flight HDR frame when the authenticated source changes while waiting',async()=>{
    let activeSource=source, current=.5, elapsed=0;
    const sourceClock={
      get sourceSha256(){return activeSource;},
      presentationOffsetUs:250000,
      currentMediaTimeSeconds:()=>current,
      playing:()=>true,
    };
    const status=await cinemaWaitForPresentation(1275000,sourceClock,{
      now:()=>elapsed,
      sleep:async()=>{elapsed+=16;current+=.016;activeSource='a'.repeat(64);},
    });
    expect(status).toBe('source-changed');
  });
  it('does not expire only because playback stays paused briefly',async()=>{
    let now=0;
    let playing=false;
    let current=1;
    let waits=0;
    const result=await cinemaWaitForPresentation(1275000,{
      ...clock(1),playing:()=>playing,currentMediaTimeSeconds:()=>current,
    },{
      now:()=>now,
      sleep:async()=>{
        now+=40;
        waits++;
        if(waits===6)playing=true;
      },
    });
    expect(result).toBe('ready');
    expect(now).toBeGreaterThan(160);
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
