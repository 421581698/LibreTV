/**
 * In one browser document several PlayerShell instances can temporarily coexist
 * (route transitions, hidden previews). Global voice/Friday transport commands
 * must have exactly one owner. Native play claims ownership; teardown releases it.
 * Playback and media state still belong to the actual HTMLVideoElement.
 */
const owners:symbol[]=[];
export function registerPlaybackControlOwner(owner:symbol):()=>void {
  claimPlaybackControlOwner(owner);
  return ()=>{
    const index=owners.indexOf(owner);
    if(index!==-1)owners.splice(index,1);
  };
}
export function claimPlaybackControlOwner(owner:symbol):void {
  const index=owners.indexOf(owner);
  if(index===-1&&owners.length===0){owners.push(owner);return;}
  if(index===-1){owners.push(owner);return;}
  owners.splice(index,1);
  owners.push(owner);
}
export function isPlaybackControlOwner(owner:symbol):boolean {
  return owners.length>0&&owners[owners.length-1]===owner;
}
