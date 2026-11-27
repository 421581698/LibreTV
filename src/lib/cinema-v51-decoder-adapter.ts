import type {CinemaDecodedFrameProvider,CinemaDecodedP010Sample} from './cinema-v51-frame-bridge';

/**
 * Adapter for a separately authorized, DRM-free WebCodecs VideoDecoder.
 * WebCodecs video output *may* expose P010 via VideoFrame.copyTo, but decoded
 * bit depth, range and primaries must be verified against trusted metadata.
 *
 * This does not capture raw frames from a <video> element, nor demux HLS.
 */
interface CinemaRawVideoFrame {
  timestamp:number;
  format?:string|null;
  codedWidth:number;
  codedHeight:number;
  colorSpace?:{fullRange?:boolean|null;primaries?:string|null;transfer?:string|null;matrix?:string|null};
  allocationSize(opts?:unknown):number;
  copyTo(destination:AllowSharedBufferSource,opts?:unknown):Promise<readonly {offset:number;stride:number}[]>;
  close():void;
}
export interface CinemaDemuxedDecoder {
  /** Returns real, already-decoded frames in presentation order. */
  start(onFrame:(frame:CinemaRawVideoFrame)=>void,onError:(message:string)=>void):Promise<void>|void;
  stop():void;
}
export interface CinemaDecodedVideoSource {
  sourceSha256:string;
  decoder:CinemaDemuxedDecoder;
  expectedPrimaries:'bt709'|'bt2020';
  expectedTransfer:'bt709'|'smpte2084'|'arib-std-b67';
}
export function cinemaExtractP010VideoFrame(
  frame:CinemaRawVideoFrame,
):Promise<CinemaDecodedP010Sample['decodedP010']> {
  return (async()=>{
    if(frame.format!=='P010'||!Number.isSafeInteger(frame.codedWidth)||
      !Number.isSafeInteger(frame.codedHeight)||frame.codedWidth<2||frame.codedHeight<2||
      frame.codedWidth%2!==0||frame.codedHeight%2!==0||
      frame.codedWidth*frame.codedHeight>1920*1080||
      frame.colorSpace?.fullRange!==false)throw new Error('Unsupported raw 10-bit P010 video format or range');
    const width=frame.codedWidth,height=frame.codedHeight;
    const length=frame.allocationSize({format:'P010'});
    if(!Number.isSafeInteger(length)||length<=0||length>16*1024*1024)throw new Error('Unsafe P010 allocation');
    const raw=new Uint8Array(length);
    const planes=await frame.copyTo(raw,{format:'P010'});
    if(planes.length!==2)throw new Error('Unexpected P010 plane count');
    const y=new Uint16Array(width*height);
    const uv=new Uint16Array(width*height/2);
    const view=new DataView(raw.buffer);
    for(let plane=0;plane<2;plane++){
      const lineCount=plane===0?height:height/2;
      const samplesPerLine=width;
      const output=plane===0?y:uv;
      const start=planes[plane].offset,stride=planes[plane].stride;
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(stride)||
        start<0||stride<width*2||start+stride*(lineCount-1)+width*2>raw.length)
        throw new Error('Invalid decoded P010 sample stride');
      for(let row=0;row<lineCount;row++)for(let col=0;col<samplesPerLine;col++){
        output[row*width+col]=view.getUint16(start+row*stride+col*2,true);
      }
    }
    return {range:'limited',width,height,y,uv};
  })();
}
/**
 * Accepts a true decoder output and forwards bound video sample timestamps.
 * Copying is serialized to prevent frame reordering when async copyTo latency
 * differs. On failure, release the decoder and fail closed to native playback.
 */
export function createCinemaWebCodecsDecodedProvider(
  input:CinemaDecodedVideoSource,
):CinemaDecodedFrameProvider {
  let stopped=false;
  let queue:Promise<void>=Promise.resolve();
  let sequence=0;
  let lastOutputPtsUs=-1;
  return {
    sourceSha256:input.sourceSha256,
    start(onFrame,onError) {
      const receive=(frame:CinemaRawVideoFrame)=>{
        if(stopped){frame.close();return;}
        const frameIndex=sequence++;
        queue=queue.then(async()=>{
          try{
            if(stopped)return;
            if(frame.colorSpace?.primaries!==input.expectedPrimaries||
              frame.colorSpace?.transfer!==input.expectedTransfer||
              !Number.isSafeInteger(frame.timestamp)||frame.timestamp<0||
              frame.timestamp<=lastOutputPtsUs)
              throw new Error('Decoded video colour metadata or PTS is untrusted');
            const decodedP010=await cinemaExtractP010VideoFrame(frame);
            lastOutputPtsUs=frame.timestamp;
            if(!stopped)onFrame({
              sourceSha256:input.sourceSha256,frameIndex,
              ptsUs:frame.timestamp,decodedP010,
            });
          }catch(error){
            if(!stopped){
              stopped=true;
              try {input.decoder.stop();} catch {/* retain original failure */}
              onError(error instanceof Error?error.message:'VideoFrame P010 extraction failed');
            }
          }finally{frame.close();}
        });
      };
      return input.decoder.start(receive,reason=>{
        if(stopped)return;
        stopped=true;
        onError(reason);
      });
    },
    stop(){if(stopped)return;stopped=true;input.decoder.stop();},
  };
}
