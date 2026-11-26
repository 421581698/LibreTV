import { cinemaTransformPixel,cinemaClamp,type CinemaPixelOptions,type CinemaRgb } from './cinema-v51-color';
import { cinemaTransformMetadataFrame,type CinemaDynamicToneFrame,type CinemaMasteringMetadata } from './cinema-v51-metadata';

/**
 * P010 4:2:0 10-bit *decoded* video-frame processing, no codec decoder or DRM.
 * P010 stores 10-bit samples in the high bits of Uint16 samples. The buffers
 * below must be tightly packed, with 2x2 chroma subsampling and no padding.
 * For browser VideoFrame.copyTo(), obey its plane strides/offsets externally;
 * never reinterpret a random HDR Canvas RGBA buffer as P010.
 */
export interface CinemaP010Frame {
  /** Explicit studio-swing range; full-range data requires a different decoder. */
  range:'limited';
  width:number;
  height:number;
  y:Uint16Array;
  uv:Uint16Array;
}
export type CinemaYuvMatrix = 'bt709'|'bt2020';
export interface CinemaP010TransformOptions extends CinemaPixelOptions {
  sourceMatrix:CinemaYuvMatrix;
  targetMatrix:CinemaYuvMatrix;
  mastering?:CinemaMasteringMetadata;
  dynamicFrame?:CinemaDynamicToneFrame|null;
}
const COEFF:Record<CinemaYuvMatrix,{kr:number;kb:number}>={
  bt709:{kr:.2126,kb:.0722},
  bt2020:{kr:.2627,kb:.0593},
};
function decode10(v:number):number {
  if(!Number.isSafeInteger(v)||v<0||v>65535||v%64!==0)throw new Error('Invalid P010 left-aligned sample');
  return v>>>6;
}
function p010Y(v:number):number{return cinemaClamp((decode10(v)-64)/876);}
function p010C(v:number):number{return (decode10(v)-512)/896;}
function encodeY(v:number):number{return Math.round(64+876*cinemaClamp(v))<<6;}
function encodeC(v:number):number{return Math.round(512+896*cinemaClamp(v,-.5,.5))<<6;}
function yuvRgb(y:number,cb:number,cr:number,matrix:CinemaYuvMatrix):[number,number,number] {
  const {kr,kb}=COEFF[matrix];
  const r=y+2*(1-kr)*cr,b=y+2*(1-kb)*cb;
  const g=(y-kr*r-kb*b)/(1-kr-kb);
  return [cinemaClamp(r),cinemaClamp(g),cinemaClamp(b)];
}
function rgbYuv(rgb:CinemaRgb,matrix:CinemaYuvMatrix):[number,number,number] {
  const {kr,kb}=COEFF[matrix];
  const y=kr*rgb[0]+(1-kr-kb)*rgb[1]+kb*rgb[2];
  return [y,(rgb[2]-y)/(2*(1-kb)),(rgb[0]-y)/(2*(1-kr))];
}
export function cinemaTransformP010Frame(
  input:CinemaP010Frame,settings:CinemaP010TransformOptions,
):CinemaP010Frame {
  if(input.range!=='limited') throw new Error('Only declared limited-range P010 is supported');
  const {width,height,y,uv}=input;
  // The P010 range quantizer below implements studio swing (Y 64..940,
  // C 64..960), which cannot be applied to full-range raw P010 frames.
  // Restrict this API to explicitly declared video-range samples.
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<2||height<2||
    width%2!==0||height%2!==0||width*height>1920*1080||
    y.length!==width*height||uv.length!==width*height/2) {
    throw new Error('Unsafe or unsupported P010 plane geometry');
  }
  const outputY=new Uint16Array(y.length);
  const outputUv=new Uint16Array(uv.length);
  for(let row=0;row<height;row+=2){
    for(let col=0;col<width;col+=2){
      const uvIndex=(row/2)*width+col;
      const cb=p010C(uv[uvIndex]),cr=p010C(uv[uvIndex+1]);
      let sumCb=0,sumCr=0;
      for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
        const at=(row+dy)*width+col+dx;
        const rgb=yuvRgb(p010Y(y[at]),cb,cr,settings.sourceMatrix);
        const transformed=settings.mastering?
          cinemaTransformMetadataFrame(rgb,settings,settings.mastering,settings.dynamicFrame??null):
          cinemaTransformPixel(rgb,settings);
        const [luma,nextCb,nextCr]=rgbYuv(transformed,settings.targetMatrix);
        outputY[at]=encodeY(luma);
        sumCb+=nextCb;sumCr+=nextCr;
      }
      outputUv[uvIndex]=encodeC(sumCb/4);
      outputUv[uvIndex+1]=encodeC(sumCr/4);
    }
  }
  return {range:'limited',width,height,y:outputY,uv:outputUv};
}
