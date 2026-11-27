/**
 * Cinema 5.1 display-clock discipline for an authenticated decoded frame.
 * PTS must be mapped to HTMLMediaElement mediaTime by a verified demux/edit
 * list offset. Never infer it from the first observed browser frame.
 */
export interface CinemaPresentationClock {
  readonly sourceSha256:string;
  /** Verified mapping from source presentation timestamp to media clock. */
  readonly presentationOffsetUs:number;
  currentMediaTimeSeconds():number;
  playing():boolean;
}
export type CinemaClockResult='ready'|'late'|'expired'|'source-changed'|'cancelled';
export interface CinemaClockOptions {
  cancelled?:()=>boolean;
  sleep?:(ms:number)=>Promise<void>;
  now?:()=>number;
}
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
/**
 * A frame is ready when it is at most 30ms early or 120ms late.
 * Frames more than 120ms late are discarded via native fallback, not
 * displayed at an incorrect time.
 * The browser composition timestamp itself still needs real-device checks.
 */
export async function cinemaWaitForPresentation(
  ptsUs:number,clock:CinemaPresentationClock,options:CinemaClockOptions={},
):Promise<CinemaClockResult> {
  if(!Number.isSafeInteger(ptsUs)||ptsUs<0||
    !Number.isSafeInteger(clock.presentationOffsetUs)||
    !/^[0-9a-f]{64}$/i.test(clock.sourceSha256))return 'expired';
  const boundSourceSha=clock.sourceSha256.toLowerCase();
  const now=options.now??(()=>performance.now());
  const pause=options.sleep??sleep;
  let activeStart=now();
  let pausedAt:number|null=null;
  let activeIterations=0;
  while(activeIterations<320){
    if(options.cancelled?.())return 'cancelled';
    if(clock.sourceSha256.toLowerCase()!==boundSourceSha)return 'source-changed';
    const seconds=clock.currentMediaTimeSeconds();
    if(!Number.isFinite(seconds)||seconds<0)return 'expired';
    const currentUs=Math.round(seconds*1e6)+clock.presentationOffsetUs;
    if(!Number.isSafeInteger(currentUs))return 'expired';
    const delta=ptsUs-currentUs;
    if(delta<-120000)return 'late';
    const playing=clock.playing();
    if(playing && delta<=30000&&delta>=-120000)return 'ready';
    // Paused wall time must not be counted as an HDR synchronization miss.
    if(!playing) {
      if(pausedAt===null)pausedAt=now();
      // Paused time cannot exhaust the 320 active-frame polls. Still bound an
      // abandoned media session so an inaccessible player never polls forever.
      if(now()-pausedAt>=300_000)return 'expired';
      await pause(40);
      continue;
    }
    if(pausedAt!==null) {
      activeStart+=now()-pausedAt;
      pausedAt=null;
    }
    if(now()-activeStart>=2600)return 'expired';
    activeIterations++;
    await pause(delta>50000?16:8);
  }
  return 'expired';
}
