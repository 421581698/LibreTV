import {cinemaParseHdr10PlusT35} from './cinema-v51-hdr10plus';
import {cinemaValidateRpuL1Frame,type CinemaRpuL1Frame} from './cinema-v51-rpu-tone';
import {
  cinemaResolveDynamicFrame,cinemaValidateMetadata,
  type CinemaDynamicToneFrame,type CinemaMasteringMetadata,
} from './cinema-v51-metadata';
import {
  cinemaTransformP010Frame,type CinemaP010Frame,type CinemaP010TransformOptions,
} from './cinema-v51-p010';

/**
 * One cohesive HDR10+/10-bit input contract for explicitly decoded P010 frames.
 *
 * The source and payload digests MUST come from a separately validated
 * immutable asset/sample registry. Matching hashes establish byte integrity,
 * not end-to-end HDR hardware output, licensed Dolby decoding or DRM access.
 */
export interface CinemaVerifiedHdrSample {
  sourceSha256:string;
  expectedSourceSha256:string;
  metadataSha256:string;
  expectedMetadataSha256:string;
  frameIndex:number;
  framePtsUs:number;
  t35Payload:Uint8Array;
}
export interface CinemaV51FrameJob {
  decodedP010:CinemaP010Frame;
  transform:CinemaP010TransformOptions;
  metadata?:CinemaVerifiedHdrSample;
  rpuL1?:CinemaRpuL1Frame;
}
export interface CinemaV51FrameResult {
  frame:CinemaP010Frame;
  colorConversion:'software-p010-10bit';
  dynamicMetadataApplied:boolean;
  displayHdrOutput:'unverified';
  reason:string;
}
function assertSha(value:string):void {
  if(!/^[a-f0-9]{64}$/i.test(value))throw new Error('Invalid verified asset identity');
}
async function digestSha256(bytes:Uint8Array):Promise<string> {
  if(typeof crypto==='undefined'||!crypto.subtle) throw new Error('SHA-256 verification unavailable');
  const copy=new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const hash=await crypto.subtle.digest('SHA-256',copy.buffer);
  return Array.from(new Uint8Array(hash)).map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function cinemaVerifyHdr10PlusSample(
  input:CinemaVerifiedHdrSample,
):Promise<CinemaDynamicToneFrame> {
  [input.sourceSha256,input.expectedSourceSha256,input.metadataSha256,input.expectedMetadataSha256].forEach(assertSha);
  if(input.sourceSha256.toLowerCase()!==input.expectedSourceSha256.toLowerCase()||
     input.metadataSha256.toLowerCase()!==input.expectedMetadataSha256.toLowerCase()){
    throw new Error('HDR10+ metadata identity does not match registered source');
  }
  const actual=await digestSha256(input.t35Payload);
  if(actual!==input.expectedMetadataSha256.toLowerCase()){
    throw new Error('HDR10+ payload digest mismatch');
  }
  if(!Number.isSafeInteger(input.frameIndex)||input.frameIndex<0||
     !Number.isSafeInteger(input.framePtsUs)||input.framePtsUs<0) {
    throw new Error('HDR10+ sample has no valid presentation timestamp');
  }
  const parsed=cinemaParseHdr10PlusT35(input.t35Payload);
  if(parsed.windowCount!==1) {
    // Correct local multi-window processing requires the true geometry of
    // each processing window. Never silently apply window 0 to whole frame.
    throw new Error('Multi-window HDR10+ needs verified window geometry mapper');
  }
  const window=parsed.windows[0];
  return {
    frameIndex:input.frameIndex,framePtsUs:input.framePtsUs,
    targetedPeakNits:parsed.targetedDisplayNits,
    maxSclNits:window.maxSclNits,
    averageMaxRgbNits:window.averageMaxRgbNits,
    kneePoint:window.kneeX??undefined,
    kneePointY:window.kneeY??undefined,
    bezierAnchors:window.bezierAnchors,
    saturationWeight:window.colorSaturationWeight??undefined,
    provenance:'verified-st2094-40',
  };
}
export async function cinemaProcessV51Frame(job:CinemaV51FrameJob):Promise<CinemaV51FrameResult> {
  let dynamic:CinemaDynamicToneFrame|null=null;
  if(job.rpuL1 && job.metadata)throw new Error('Cannot mix Dolby RPU and HDR10+ frame paths');
  if(job.rpuL1)cinemaValidateRpuL1Frame(job.rpuL1);
  const mastering: CinemaMasteringMetadata | undefined=job.transform.mastering;
  if(job.metadata){
    if(!mastering)throw new Error('HDR10+ metadata requires mastering reference');
    dynamic=await cinemaVerifyHdr10PlusSample(job.metadata);
    const envelope=cinemaValidateMetadata({
      sourceSha256:job.metadata.sourceSha256,
      mastering,frames:[dynamic],
    });
    dynamic=cinemaResolveDynamicFrame(envelope,job.metadata.framePtsUs,job.metadata.expectedSourceSha256);
    if(!dynamic)throw new Error('HDR10+ metadata detached from presentation frame');
  }
  const frame=cinemaTransformP010Frame(job.decodedP010,{
    ...job.transform,
    dynamicFrame:dynamic,
    rpuL1Frame:job.rpuL1??null,
  });
  return {
    frame,colorConversion:'software-p010-10bit',dynamicMetadataApplied:dynamic!==null||Boolean(job.rpuL1),
    displayHdrOutput:'unverified',
    reason:job.rpuL1
      ? 'Cinema 自研逐帧 RPU L1 动态色调映射已应用于授权 PQ/P010 样本；不是杜比认证渲染，最终 HDR 输出未证明。'
      : dynamic
      ? '已对已校验的 P010 帧应用 HDR10+ 动态数据和 10-bit 色彩变换；最终显示输出尚未证明。'
      : '已对已解码 P010 帧应用 10-bit 色彩变换；无动态元数据，未假定 HDR10+。',
  };
}
