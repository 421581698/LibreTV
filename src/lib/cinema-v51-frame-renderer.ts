import type {CinemaP010FrameRenderer} from './cinema-v51-frame-bridge';
import type {CinemaP010Frame} from './cinema-v51-p010';

/**
 * Present converted P010 samples as real, uncompressed VideoFrames with
 * their exact timestamps; browser compositor may still output SDR/8-bit.
 *
 * Unlike drawing P010 into an RGBA8 canvas, this adapter constructs a
 * genuine P010 VideoFrame. Presenting on a canvas succeeds only if the
 * browser's VideoFrame constructor, Canvas 2D drawing, and the particular
 * frame format are all supported. Display HDR is never assumed.
 */
interface RawVideoFrame {
  readonly timestamp:number;
  close():void;
}
interface RawVideoFrameConstructor {
  new(data:BufferSource,init:{
    format:'P010';codedWidth:number;codedHeight:number;timestamp:number;
    colorSpace:{primaries:'bt709'|'bt2020';transfer:'bt709'|'smpte2084'|'arib-std-b67';matrix:'bt709'|'bt2020-ncl';fullRange:false};
  }):RawVideoFrame;
}
export interface CinemaP010PresentationOptions {
  transfer:'sdr'|'pq'|'hlg';
  primaries:'bt709'|'bt2020';
  /** Must be a proven raw 10-bit renderer, not a color-managed <video>. */
  onPresent?:(frame:RawVideoFrame,ptsUs:number)=>Promise<boolean>;
}
export function cinemaPackP010(frame:CinemaP010Frame):Uint8Array {
  if(frame.range!=='limited'||frame.width<2||frame.height<2||frame.width%2||frame.height%2||
    frame.y.length!==frame.width*frame.height||frame.uv.length!==frame.width*frame.height/2) {
    throw new Error('Invalid P010 packed plane geometry');
  }
  const byteLength=(frame.y.length+frame.uv.length)*2;
  if(byteLength>16*1024*1024)throw new Error('P010 frame buffer exceeds safety limit');
  const output=new Uint8Array(byteLength);
  const view=new DataView(output.buffer);
  let index=0;
  for(const p of [frame.y,frame.uv])for(const sample of p){
    if((sample&63)!==0)throw new Error('P010 sample not left aligned');
    view.setUint16(index,sample,true);
    index+=2;
  }
  return output;
}
export function createCinemaP010VideoFrameRenderer(
  options:CinemaP010PresentationOptions,
  api:RawVideoFrameConstructor|null=
    typeof globalThis!=='undefined'&&'VideoFrame' in globalThis
      ? (globalThis as unknown as {VideoFrame:RawVideoFrameConstructor}).VideoFrame : null,
):CinemaP010FrameRenderer {
  let stopped=false;
  let lastPts=-1;
  return {
    async render(frame,ptsUs){
      if(stopped||!api||!options.onPresent||
        !Number.isSafeInteger(ptsUs)||ptsUs<0||ptsUs<=lastPts)return false;
      let videoFrame:RawVideoFrame|null=null;
      try{
        const bytes=cinemaPackP010(frame);
        videoFrame=new api(bytes,{
          format:'P010',codedWidth:frame.width,codedHeight:frame.height,timestamp:ptsUs,
          colorSpace:{
            primaries:options.primaries,
            matrix:options.primaries==='bt2020'?'bt2020-ncl':'bt709',
            transfer:options.transfer==='pq'?'smpte2084':options.transfer==='hlg'?'arib-std-b67':'bt709',
            fullRange:false,
          },
        });
        if(videoFrame.timestamp!==ptsUs)return false;
        const presented=await options.onPresent(videoFrame,ptsUs);
        if(!presented||stopped)return false;
        lastPts=ptsUs;
        return true;
      }catch{return false;}
      finally{videoFrame?.close();}
    },
    stop(){stopped=true;},
  };
}
