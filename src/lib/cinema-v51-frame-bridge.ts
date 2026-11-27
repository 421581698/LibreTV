import type {CinemaV51FrameJob,CinemaV51FrameResult} from './cinema-v51-runtime';
import {cinemaProcessV51Frame} from './cinema-v51-runtime';
import {cinemaWaitForPresentation,type CinemaPresentationClock} from './cinema-v51-clock';

export interface CinemaDecodedP010Sample {
  /** Immutable, authenticated source identity, never a display name or URL. */
  sourceSha256:string;
  frameIndex:number;
  ptsUs:number;
  decodedP010:CinemaV51FrameJob['decodedP010'];
}
export type CinemaFrameBridgeEvent =
  | {state:'processed';ptsUs:number;dynamicMetadataApplied:boolean;frame:CinemaV51FrameResult['frame']}
  | {state:'native-fallback';reason:string};
/**
 * Input from an independently authorized real demux+decoder.
 * A browser HTMLVideoElement is not a source of verified raw P010 frames;
 * Browser Canvas and WebGL readbacks may be 8-bit, color-converted or blocked.
 */
export interface CinemaDecodedFrameProvider {
  readonly sourceSha256:string;
  start(onFrame:(frame:CinemaDecodedP010Sample)=>void,onError:(reason:string)=>void):void|Promise<void>;
  stop():void;
}
export interface CinemaP010FrameRenderer {
  /** Renderer must upload authentic 10-bit samples and signal success after presenting. */
  render(frame:CinemaV51FrameResult['frame'],ptsUs:number):Promise<boolean>;
  stop():void;
}
export interface CinemaFrameBridge {
  stop():void;
  readonly active:boolean;
}
/** Never route frame PTS or metadata from an unrelated episode into output. */
export function cinemaFrameMatchesSource(
  sourceSha256:string,previousPtsUs:number,frame:CinemaDecodedP010Sample,
):boolean {
  return Boolean(/^[a-f0-9]{64}$/i.test(sourceSha256) &&
    frame.sourceSha256.toLowerCase()===sourceSha256.toLowerCase() &&
    Number.isSafeInteger(frame.frameIndex)&&frame.frameIndex>=0 &&
    Number.isSafeInteger(frame.ptsUs)&&frame.ptsUs>=0 &&
    frame.ptsUs>previousPtsUs);
}
/**
 * Coherent decode/transform/render lifecycle: one frame at a time, exact
 * microsecond presentation timestamp and source identity. Any failed upload,
 * unsupported decoder, invalid metadata, or out-of-order PTS restores the
 * original Safari playback rather than pretending the custom pipeline works.
 */
export function startCinemaV51FrameBridge(
  provider:CinemaDecodedFrameProvider,
  renderer:CinemaP010FrameRenderer,
  buildJob:(frame:CinemaDecodedP010Sample)=>CinemaV51FrameJob,
  report:(event:CinemaFrameBridgeEvent)=>void,
  clock?:CinemaPresentationClock,
):CinemaFrameBridge {
  let stopped=false;
  let active=false;
  let busy=false;
  let lastPtsUs=-1;
  const fallback=(reason:string)=>{
    if(stopped)return;
    stopped=true;
    active=false;
    try {provider.stop();} catch {/* release */}
    try {renderer.stop();} catch {/* release */}
    report({state:'native-fallback',reason});
  };
  const consume=async(frame:CinemaDecodedP010Sample)=>{
    if(stopped)return;
    if(busy){fallback('实时 HDR 渲染超载，保留原生视频播放。');return;}
    if(!cinemaFrameMatchesSource(provider.sourceSha256,lastPtsUs,frame)) {
      fallback('源校验或 PTS 顺序不正确；无法安全同步 HDR 元数据。');
      return;
    }
    busy=true;
    try {
      const job=buildJob(frame);
      if(job.decodedP010!==frame.decodedP010 ||
         (job.metadata && (job.metadata.sourceSha256.toLowerCase()!==frame.sourceSha256.toLowerCase() ||
         job.metadata.framePtsUs!==frame.ptsUs || job.metadata.frameIndex!==frame.frameIndex)) ||
         (job.rpuL1 && (job.rpuL1.sourceSha256.toLowerCase()!==frame.sourceSha256.toLowerCase() ||
           job.rpuL1.framePtsUs!==frame.ptsUs || job.rpuL1.frameIndex!==frame.frameIndex))) {
        throw new Error('HDR metadata detached from actual decoded frame');
      }
      const result=await cinemaProcessV51Frame(job);
      if(stopped)return;
      if(clock) {
        if(clock.sourceSha256.toLowerCase()!==frame.sourceSha256.toLowerCase())
          throw new Error('Presentation clock belongs to a different source');
        const timing=await cinemaWaitForPresentation(frame.ptsUs,clock,{cancelled:()=>stopped});
        if(stopped)return;
        if(timing!=='ready')throw new Error('Frame presentation PTS synchronization failed: '+timing);
      }
      const presented=await renderer.render(result.frame,frame.ptsUs);
      if(stopped)return;
      if(!presented)throw new Error('10-bit frame renderer did not confirm presentation');
      active=true;
      lastPtsUs=frame.ptsUs;
      report({state:'processed',ptsUs:frame.ptsUs,
        dynamicMetadataApplied:result.dynamicMetadataApplied,frame:result.frame});
    } catch(e) {
      fallback(e instanceof Error?e.message:'HDR video-frame conversion unavailable');
    } finally {busy=false;}
  };
  try {
    const task=provider.start(frame=>{void consume(frame);},reason=>fallback(reason));
    if(task instanceof Promise)void task.catch(e=>fallback(
      e instanceof Error?e.message:'HDR video-frame provider failed'));
  } catch(e) {
    fallback(e instanceof Error?e.message:'HDR video-frame provider unavailable');
  }
  return {
    stop(){
      if(stopped)return;
      stopped=true;active=false;
      try {provider.stop();} catch {/* always release remaining resources */}
      try {renderer.stop();} catch {/* best-effort cleanup */}
    },
    get active(){return active&&!stopped;},
  };
}
