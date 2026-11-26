import {cinemaCanvasGeometry} from './cinema-hdr-geometry';
import {createCinemaLiveVideoDecoder,type CinemaEncodedTrack} from './cinema-v51-live-decoder';
import {createCinemaWebCodecsDecodedProvider} from './cinema-v51-decoder-adapter';
import {startCinemaV51FrameBridge,type CinemaFrameBridge} from './cinema-v51-frame-bridge';
import {createCinemaP010VideoFrameRenderer} from './cinema-v51-frame-renderer';
import {createCinemaExtendedWebGpuPresenter} from './cinema-v51-webgpu-presenter';
import type {CinemaP010TransformOptions} from './cinema-v51-p010';
import type {CinemaVerifiedHdrSample} from './cinema-v51-runtime';

/**
 * Physically decoded/rendered Cinema HDR branch, opt-in only when a registered
 * DRM-free demuxer supplies authentic timestamped compressed packets and
 * frame-bound metadata. Arbitrary HLS URLs do not satisfy that requirement.
 */
export interface CinemaV51AuthorizedPlayback {
  mediaUrl:string;
  track:CinemaEncodedTrack;
  transform:CinemaP010TransformOptions;
  /** Independently authenticated PTS origin/edit-list mapping. */
  presentationOffsetUs:number;
  /** The exact payload, frame ordinal and hash bound by the demuxer. */
  hdr10PlusByPtsUs?:ReadonlyMap<number,CinemaVerifiedHdrSample>;
}
export interface CinemaV51PlaybackMount {
  stop():void;
  readonly active:boolean;
}
const VALID_HASH=/^[a-f0-9]{64}$/i;
export function cinemaCanMountAuthorizedPlayback(
  url:string,source:CinemaV51AuthorizedPlayback,
):boolean {
  return Boolean(source.mediaUrl===url&&
    VALID_HASH.test(source.track.sourceSha256)&&
    Number.isSafeInteger(source.presentationOffsetUs)&&
    source.track.packets&&typeof source.track.packets[Symbol.asyncIterator]==='function'&&
    source.transform.sourcePeakNits>0&&source.transform.targetPeakNits>0);
}
/** Returns null without modifying the current native Safari player on any
 * capability failure. No card/setting/UI change is made by this function.
 */
export async function mountCinemaV51AuthorizedPlayback(
  video:HTMLVideoElement,
  host:HTMLElement,
  source:CinemaV51AuthorizedPlayback,
  onReport:(state:'processed'|'native-fallback',reason:string)=>void,
):Promise<CinemaV51PlaybackMount|null> {
  if(!cinemaCanMountAuthorizedPlayback(video.currentSrc||video.src,source)||
    !video.isConnected||!host.isConnected||video.readyState<2)return null;
  const canvas=document.createElement('canvas');
  canvas.dataset.cinemaV51Playback='high-precision-candidate';
  canvas.setAttribute('aria-hidden','true');
  canvas.style.cssText='position:absolute;z-index:1;pointer-events:none;display:none;';
  host.append(canvas);
  const renderer=await createCinemaExtendedWebGpuPresenter(canvas,reason=>{
    onReport('native-fallback',reason);
  });
  if(!renderer){
    canvas.remove();
    onReport('native-fallback','Safari 未提供经过确认的 rgba16float + extended HDR 渲染上下文；保留原生播放。');
    return null;
  }
  let stopped=false;
  let bridge:CinemaFrameBridge|null=null;
  const fallback=(reason:string)=>{
    if(stopped)return;
    stopped=true;
    bridge?.stop();
    renderer.stop();
    canvas.remove();
    onReport('native-fallback',reason);
  };
  const layout=()=>{
    if(!video.isConnected||!host.isConnected||document.visibilityState==='hidden'||
      Array.from(video.textTracks).some(t=>t.mode==='showing')||
      document.fullscreenElement===video)return false;
    const geometry=cinemaCanvasGeometry(
      video.getBoundingClientRect(),host.getBoundingClientRect(),
      video.videoWidth,video.videoHeight,getComputedStyle(video).objectFit,
    );
    if(geometry.width<=0||geometry.height<=0)return false;
    canvas.style.left=`${geometry.left}px`;
    canvas.style.top=`${geometry.top}px`;
    canvas.style.width=`${geometry.width}px`;
    canvas.style.height=`${geometry.height}px`;
    return true;
  };
  const onSeek=()=>fallback('跳转改变了媒体 PTS 基准；已恢复原生播放。');
  const onError=()=>fallback('原播放器媒体发生错误，已关闭独立 HDR 图层。');
  const onMediaChange=()=>fallback('播放器切源，停止旧的解码视频和元数据同步。');
  video.addEventListener('seeking',onSeek);
  video.addEventListener('error',onError);
  video.addEventListener('emptied',onMediaChange);
  const cleanup=()=>{
    video.removeEventListener('seeking',onSeek);
    video.removeEventListener('error',onError);
    video.removeEventListener('emptied',onMediaChange);
  };
  const rawRenderer=createCinemaP010VideoFrameRenderer({
    transfer:source.transform.targetTransfer==='pq'?'pq':source.transform.targetTransfer==='hlg'?'hlg':'sdr',
    primaries:source.transform.targetPrimaries==='rec2020'?'bt2020':'bt709',
    onPresent:async(frame,ptsUs)=>{
      if(stopped||!layout())return false;
      return renderer.present(frame,ptsUs);
    },
  });
  const adapter={
    render:rawRenderer.render,
    stop(){rawRenderer.stop();renderer.stop();cleanup();canvas.remove();},
  };
  const decoder=createCinemaLiveVideoDecoder(source.track);
  const provider=createCinemaWebCodecsDecodedProvider({
    sourceSha256:source.track.sourceSha256,
    expectedPrimaries:source.transform.sourcePrimaries==='rec2020'?'bt2020':'bt709',
    expectedTransfer:source.transform.sourceTransfer==='pq'?'smpte2084':
      source.transform.sourceTransfer==='hlg'?'arib-std-b67':'bt709',
    decoder,
  });
  bridge=startCinemaV51FrameBridge(
    provider,adapter,frame=>({
      decodedP010:frame.decodedP010,
      transform:source.transform,
      metadata:source.hdr10PlusByPtsUs?.get(frame.ptsUs),
    }),event=>{
      if(event.state==='native-fallback')fallback(event.reason);
      else onReport('processed',event.dynamicMetadataApplied
        ?'已按真实 PTS 处理并提交已验证 HDR10+ P010 帧；实际屏幕 HDR 输出仍待真机测量。'
        :'已按真实 PTS 提交 10-bit P010 帧；实际屏幕 HDR 输出仍待真机测量。');
    },{
      sourceSha256:source.track.sourceSha256,
      presentationOffsetUs:source.presentationOffsetUs,
      currentMediaTimeSeconds:()=>video.currentTime,
      playing:()=>!video.paused&&!video.ended,
    },
  );
  if(stopped) {bridge.stop();return null;}
  return {
    stop(){if(stopped)return;stopped=true;bridge?.stop();adapter.stop();cleanup();canvas.remove();},
    get active(){return !stopped&&Boolean(bridge?.active);},
  };
}
