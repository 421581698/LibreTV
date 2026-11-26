import {
  cinemaToneMapNits,cinemaInverseToneMapNits,cinemaTransformPixel,
  cinemaQuantize10,cinemaUnpack10,type CinemaPixelOptions,
  type CinemaRgb,
} from './cinema-v51-color';

/**
 * Real metadata-driven per-frame tone mapping for trusted *decoded* HDR data.
 *
 * This is NOT a bitstream HDR10+ parser. Values must come from a verified
 * ST 2094-40/HEVC T.35 extractor and be bound to the exact frame/sample.
 * The API never treats an HLS PQ attribute as dynamic metadata.
 */
export interface CinemaMasteringMetadata {
  maxDisplayNits:number;
  minDisplayNits:number;
  maxContentLightNits?:number;
  maxFrameAverageLightNits?:number;
}
export interface CinemaDynamicToneFrame {
  frameIndex:number;
  framePtsUs:number;
  /** ST 2094-40 targeted system display maximum luminance (nits). */
  targetedPeakNits:number;
  /** Validated window maximum RGB channels in absolute nits. */
  maxSclNits:readonly [number,number,number];
  averageMaxRgbNits:number;
  /** Optional knee onset normalized within target peak. */
  kneePoint?:number;
  /** Derived from a checked HDR10+ provider payload, never guessed. */
  provenance:'verified-st2094-40';
}
export interface CinemaMetadataEnvelope {
  sourceSha256:string;
  mastering:CinemaMasteringMetadata;
  frames:readonly CinemaDynamicToneFrame[];
}
export function cinemaValidateMetadata(input:CinemaMetadataEnvelope):CinemaMetadataEnvelope {
  if(!/^[a-f0-9]{64}$/i.test(input.sourceSha256)) throw new Error('Unbound dynamic HDR metadata');
  const m=input.mastering;
  if(!Number.isFinite(m.maxDisplayNits)||m.maxDisplayNits<=0||m.maxDisplayNits>10000||
    !Number.isFinite(m.minDisplayNits)||m.minDisplayNits<0||m.minDisplayNits>=m.maxDisplayNits) {
    throw new Error('Invalid mastering luminance');
  }
  for(const optional of [m.maxContentLightNits,m.maxFrameAverageLightNits]) {
    if(optional!==undefined&&(!Number.isFinite(optional)||optional<=0||optional>10000)) {
      throw new Error('Invalid content light metadata');
    }
  }
  if(input.frames.length>240000) throw new Error('Unbounded dynamic HDR frame sequence');
  let lastPts=-1,lastIndex=-1;
  for(const frame of input.frames) {
    if(frame.provenance!=='verified-st2094-40'||
       !Number.isSafeInteger(frame.frameIndex)||frame.frameIndex<=lastIndex||
       !Number.isSafeInteger(frame.framePtsUs)||frame.framePtsUs<=lastPts||
       !Number.isFinite(frame.targetedPeakNits)||frame.targetedPeakNits<=0||frame.targetedPeakNits>10000||
       !Number.isFinite(frame.averageMaxRgbNits)||frame.averageMaxRgbNits<0||frame.averageMaxRgbNits>10000||
       frame.maxSclNits.length!==3||frame.maxSclNits.some(v=>!Number.isFinite(v)||v<0||v>10000)||
       (frame.kneePoint!==undefined&&(!Number.isFinite(frame.kneePoint)||frame.kneePoint<0||frame.kneePoint>.95))
    ) throw new Error('Invalid or out-of-order HDR10+ metadata');
    lastPts=frame.framePtsUs;
    lastIndex=frame.frameIndex;
  }
  return input;
}
export function cinemaResolveDynamicFrame(
  envelope:CinemaMetadataEnvelope,ptsUs:number,sourceSha256:string,
):CinemaDynamicToneFrame|null {
  if(envelope.sourceSha256!==sourceSha256||!Number.isSafeInteger(ptsUs)||ptsUs<0) return null;
  // Never carry metadata from a future frame backwards or continue it across
  // an unbounded seek, stale source, unverified gap or discontinuity.
  let lo=0,hi=envelope.frames.length-1,result:CinemaDynamicToneFrame|null=null;
  while(lo<=hi) {
    const mid=(lo+hi)>>>1,frame=envelope.frames[mid];
    if(frame.framePtsUs<=ptsUs){result=frame;lo=mid+1;}else hi=mid-1;
  }
  return result&&ptsUs-result.framePtsUs<=500000?result:null;
}
/** Tone map using the per-frame source estimate, not the static playlist range. */
export function cinemaTransformMetadataFrame(
  rgb:CinemaRgb,options:CinemaPixelOptions,mastering:CinemaMasteringMetadata,
  dynamic:CinemaDynamicToneFrame|null,
):[number,number,number] {
  const contentPeak=Math.max(1,Math.min(10000,
    dynamic?Math.max(...dynamic.maxSclNits,dynamic.averageMaxRgbNits):
    mastering.maxContentLightNits??mastering.maxDisplayNits));
  const target=Math.max(1,Math.min(options.targetPeakNits,10000));
  const peak=Math.max(1,Math.min(options.sourcePeakNits,Math.max(contentPeak,mastering.maxDisplayNits)));
  return cinemaTransformPixel(rgb,{
    ...options,sourcePeakNits:peak,targetPeakNits:target,
    knee:dynamic?.kneePoint??options.knee,
  });
}
/** Convert actual packed 10-bit RGB samples to packed output; no UI/display claim. */
export function cinemaTransform10BitFrame(
  samples:Uint16Array,options:CinemaPixelOptions,
  mastering?:CinemaMasteringMetadata,dynamic?:CinemaDynamicToneFrame|null,
):Uint16Array {
  if(samples.length%3!==0) throw new Error('Expected packed 10-bit RGB triples');
  const output=new Uint16Array(samples.length);
  for(let i=0;i<samples.length;i+=3){
    const rgb:CinemaRgb=[
      cinemaUnpack10(samples[i]),cinemaUnpack10(samples[i+1]),cinemaUnpack10(samples[i+2]),
    ];
    const encoded=mastering
      ? cinemaTransformMetadataFrame(rgb,options,mastering,dynamic??null)
      : cinemaTransformPixel(rgb,options);
    output[i]=cinemaQuantize10(encoded[0]);
    output[i+1]=cinemaQuantize10(encoded[1]);
    output[i+2]=cinemaQuantize10(encoded[2]);
  }
  return output;
}
/** Separately measurable tone curves for scene adaptation, not metadata proof. */
export function cinemaMetadataCurveNits(nits:number,sourcePeak:number,targetPeak:number,knee:number):number {
  return sourcePeak>targetPeak?
    cinemaToneMapNits(nits,sourcePeak,targetPeak,knee):
    cinemaInverseToneMapNits(nits,sourcePeak,targetPeak);
}
