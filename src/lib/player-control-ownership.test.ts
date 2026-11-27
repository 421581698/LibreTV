import {describe,it,expect} from 'vitest';
import {claimPlaybackControlOwner,isPlaybackControlOwner,registerPlaybackControlOwner} from './player-control-ownership';
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
  it('switches control ownership when another video starts and never revives an unmounted owner',()=>{
    const first=Symbol('first'),second=Symbol('second');
    const closeFirst=registerPlaybackControlOwner(first);
    const closeSecond=registerPlaybackControlOwner(second);
    claimPlaybackControlOwner(first);
    expect(isPlaybackControlOwner(first)).toBe(true);
    closeFirst();
    expect(isPlaybackControlOwner(first)).toBe(false);
    expect(isPlaybackControlOwner(second)).toBe(true);
    closeSecond();
  });
});
