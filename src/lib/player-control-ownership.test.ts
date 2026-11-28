import {describe,it,expect} from 'vitest';
import {claimPlaybackControlOwner,isPlaybackControlOwner,registerPlaybackControlOwner} from './player-control-ownership';
import {bindPlaybackUiEvents} from './player-playback-ui';
import {executeFridayPlayerCommand} from './friday/player-control';
import {vi} from 'vitest';
describe('single-owner playback command arbitration',()=>{
  it('routes global controls to the latest mounted player and restores prior owner on teardown',()=>{
    const first=Symbol('first'),second=Symbol('second');
    const closeFirst=registerPlaybackControlOwner(first);
    expect(isPlaybackControlOwner(first)).toBe(true);
    const closeSecond=registerPlaybackControlOwner(second);
    expect(isPlaybackControlOwner(first)).toBe(false);
    expect(isPlaybackControlOwner(second)).toBe(true);
    closeSecond();
    expect(isPlaybackControlOwner(first)).toBe(true);
    closeFirst();
    expect(isPlaybackControlOwner(first)).toBe(false);
  });
  it('keeps native play, global seek/pause, source changes and teardown under one owner',()=>{
    const first=Symbol('first playback'),second=Symbol('second playback');
    const videoA=new EventTarget() as HTMLVideoElement;
    const videoB=new EventTarget() as HTMLVideoElement;
    const unregisterA=registerPlaybackControlOwner(first);
    const unregisterB=registerPlaybackControlOwner(second);
    const detachA=bindPlaybackUiEvents(videoA,event=>{
      if(event==='play')claimPlaybackControlOwner(first);
    });
    const detachB=bindPlaybackUiEvents(videoB,event=>{
      if(event==='play')claimPlaybackControlOwner(second);
    });
    const firstTarget={currentTime:10,duration:120,play:vi.fn(),pause:vi.fn()};
    const secondTarget={currentTime:1,duration:90,play:vi.fn(),pause:vi.fn()};
    const perform=(owner:symbol,target:typeof firstTarget,action:'pause'|'seek_to',seconds?:number)=>
      isPlaybackControlOwner(owner)
        ? executeFridayPlayerCommand(target,{action,seconds})
        : false;
    try{
      videoA.dispatchEvent(new Event('play'));
      expect(perform(second,secondTarget,'pause')).toBe(false);
      expect(perform(first,firstTarget,'seek_to',95)).toBe(true);
      expect(firstTarget.currentTime).toBe(95);
      expect(perform(first,firstTarget,'pause')).toBe(true);
      expect(firstTarget.pause).toHaveBeenCalledOnce();
      // Same element, new episode. Native play retains the same owner.
      firstTarget.currentTime=0;
      firstTarget.duration=42;
      videoA.dispatchEvent(new Event('play'));
      expect(perform(first,firstTarget,'seek_to',99)).toBe(true);
      expect(firstTarget.currentTime).toBe(42);
      videoB.dispatchEvent(new Event('play'));
      expect(perform(first,firstTarget,'pause')).toBe(false);
      expect(perform(second,secondTarget,'pause')).toBe(true);
      expect(secondTarget.pause).toHaveBeenCalledOnce();
      detachB();unregisterB();
      expect(isPlaybackControlOwner(first)).toBe(true);
      // A late native event from an unmounted player may not claim control.
      videoB.dispatchEvent(new Event('play'));
      claimPlaybackControlOwner(second);
      expect(isPlaybackControlOwner(first)).toBe(true);
    } finally {
      detachA();detachB();unregisterA();unregisterB();
    }
  });
  it('switches control ownership when another video starts and never revives an unmounted owner',()=>{
    const first=Symbol('first'),second=Symbol('second');
    const closeFirst=registerPlaybackControlOwner(first);
    const closeSecond=registerPlaybackControlOwner(second);
    claimPlaybackControlOwner(first);
    expect(isPlaybackControlOwner(first)).toBe(true);
    closeFirst();
    claimPlaybackControlOwner(first);
    expect(isPlaybackControlOwner(first)).toBe(false);
    expect(isPlaybackControlOwner(second)).toBe(true);
    closeSecond();
  });
});
