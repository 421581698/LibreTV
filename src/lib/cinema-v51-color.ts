/**
 * Cinema V5.1 Pro: reference-light HDR transfer / gamut / tone-mapping core.
 *
 * These operations work on explicitly decoded floating-point RGB samples.
 * HTMLVideoElement pixels must NOT be treated as raw PQ/HLG: browsers commonly
 * apply display conversion before Canvas/WebGPU exposes them. This CPU math
 * module is suitable for authenticated raw/VideoFrame pipelines where the
 * transfer and primaries are known, and provides deterministic test vectors.
 *
 * Colour management: D65, linear-light RGB -> XYZ -> RGB, no hidden clipping
 * until the target encoding step. Y values are absolute nits.
 */
export type CinemaTransferFunction = 'srgb' | 'pq' | 'hlg';
export type CinemaPrimaries = 'rec709' | 'display-p3' | 'rec2020';
export type CinemaPixelDirection = 'hdr-to-sdr' | 'sdr-to-hdr';
export type CinemaRgb = readonly [number, number, number];
export interface CinemaPixelOptions {
  sourceTransfer: CinemaTransferFunction;
  targetTransfer: CinemaTransferFunction;
  sourcePrimaries: CinemaPrimaries;
  targetPrimaries: CinemaPrimaries;
  /** Reference diffuse-white luminance, typically 100 nits for SDR. */
  sourceWhiteNits: number;
  targetWhiteNits: number;
  sourcePeakNits: number;
  targetPeakNits: number;
  /** HDR10+ metadata is not assumed from a PQ signal. */
  knee?: number;
}

const PQ_M1 = 2610 / 16384;
const PQ_M2 = 2523 / 32;
const PQ_C1 = 3424 / 4096;
const PQ_C2 = 2413 / 128;
const PQ_C3 = 2392 / 128;
const HLG_A = 0.17883277;
const HLG_B = 1 - 4 * HLG_A;
const HLG_C = 0.55991073;
const XYZ: Record<CinemaPrimaries, readonly number[]> = {
  rec709: [0.4123908,0.35758434,0.18048079,
           0.21263901,0.71516868,0.07219232,
           0.01933082,0.11919478,0.95053215],
  'display-p3': [0.48657095,0.26566769,0.19821729,
                 0.22897456,0.69173852,0.07928691,
                 0,0.04511338,1.04394437],
  rec2020: [0.63695805,0.14461690,0.16888098,
            0.26270021,0.67799807,0.05930172,
            0,0.02807269,1.06098506],
};

export function cinemaClamp(value:number,low=0,high=1):number {
  return Number.isFinite(value) ? Math.max(low,Math.min(high,value)) : low;
}

/** SMPTE ST 2084, maps normalized code values to *absolute* nits. */
export function cinemaPqEotf(value:number):number {
  const p=Math.pow(cinemaClamp(value),1/PQ_M2);
  const ratio=Math.max(p-PQ_C1,0)/(PQ_C2-PQ_C3*p);
  return 10000*Math.pow(ratio,1/PQ_M1);
}
export function cinemaPqOetf(nits:number):number {
  const l=Math.pow(cinemaClamp(nits,0,10000)/10000,PQ_M1);
  return Math.pow((PQ_C1+PQ_C2*l)/(1+PQ_C3*l),PQ_M2);
}
export function cinemaHlgInverseOetf(signal:number):number {
  const x=cinemaClamp(signal);
  return x<=0.5 ? (x*x)/3 : (Math.exp((x-HLG_C)/HLG_A)+HLG_B)/12;
}
export function cinemaHlgOetf(relativeScene:number):number {
  const v=cinemaClamp(relativeScene);
  return v<=1/12 ? Math.sqrt(3*v) : HLG_A*Math.log(12*v-HLG_B)+HLG_C;
}
export function cinemaSrgbToLinear(value:number):number {
  const x=cinemaClamp(value);
  return x<=0.04045 ? x/12.92 : Math.pow((x+0.055)/1.055,2.4);
}
export function cinemaLinearToSrgb(value:number):number {
  const x=cinemaClamp(value);
  return x<=0.0031308 ? 12.92*x : 1.055*Math.pow(x,1/2.4)-0.055;
}
export function cinemaDecodeLuminance(code:number, transfer:CinemaTransferFunction, whiteNits=100, peakNits=1000):number {
  if (transfer==='pq') return cinemaPqEotf(code);
  if (transfer==='srgb') return cinemaSrgbToLinear(code)*whiteNits;
  // BT.2100 HLG nominal display reference system gamma; requires a known
  // nominal display peak. This approximation never asserts exact device EOTF.
  const gamma=1.2+0.42*Math.log10(Math.max(100,peakNits)/1000);
  return Math.pow(cinemaHlgInverseOetf(code),Math.max(1,gamma))*peakNits;
}
export function cinemaEncodeLuminance(nits:number,transfer:CinemaTransferFunction,whiteNits=100,peakNits=1000):number {
  if (transfer==='pq') return cinemaPqOetf(nits);
  if (transfer==='srgb') return cinemaLinearToSrgb(nits/whiteNits);
  const gamma=1.2+0.42*Math.log10(Math.max(100,peakNits)/1000);
  return cinemaHlgOetf(Math.pow(cinemaClamp(nits,0,peakNits)/peakNits,1/Math.max(1,gamma)));
}
function multiply(m:readonly number[],v:CinemaRgb):[number,number,number] {
  return [m[0]*v[0]+m[1]*v[1]+m[2]*v[2],m[3]*v[0]+m[4]*v[1]+m[5]*v[2],m[6]*v[0]+m[7]*v[1]+m[8]*v[2]];
}
function inverse(m:readonly number[]):number[] {
  const [a,b,c,d,e,f,g,h,i]=m;
  const A=e*i-f*h,B=c*h-b*i,C=b*f-c*e;
  const det=a*A+b*(f*g-d*i)+c*(d*h-e*g);
  if (!Number.isFinite(det)||Math.abs(det)<1e-9) throw new Error('Invalid color matrix');
  return [A/det,B/det,C/det,(f*g-d*i)/det,(a*i-c*g)/det,(c*d-a*f)/det,
    (d*h-e*g)/det,(b*g-a*h)/det,(a*e-b*d)/det];
}
/** Gamut mapping in linear light via D65 XYZ. Clipping is postponed to encode. */
export function cinemaConvertGamut(rgb:CinemaRgb,from:CinemaPrimaries,to:CinemaPrimaries):[number,number,number] {
  if(from===to) return [rgb[0],rgb[1],rgb[2]];
  return multiply(inverse(XYZ[to]),multiply(XYZ[from],rgb));
}
export function cinemaToneMapNits(nits:number,sourcePeak:number,targetPeak:number,knee=0.65):number {
  if(sourcePeak<=0||targetPeak<=0||!Number.isFinite(nits)) return 0;
  const positive=Math.max(0,nits);
  if(sourcePeak<=targetPeak) return Math.min(targetPeak,positive);
  const start=Math.max(0,Math.min(0.95,knee))*targetPeak;
  if(positive<=start) return positive;
  const sourceRange=Math.max(1,sourcePeak-start);
  // Smooth compression with preserved knee and bounded white point.
  const x=cinemaClamp((positive-start)/sourceRange);
  const smooth=Math.log1p(9*x)/Math.log(10);
  return start+(targetPeak-start)*smooth;
}
export function cinemaInverseToneMapNits(nits:number,sourcePeak:number,targetPeak:number):number {
  if(sourcePeak<=0||targetPeak<=0||!Number.isFinite(nits)) return 0;
  const x=cinemaClamp(nits,0,sourcePeak);
  if(targetPeak<=sourcePeak) return x;
  // Conservative, highlight-only lift: does not recover clipped source data.
  const u=x/sourcePeak;
  return Math.min(targetPeak,x+(targetPeak-sourcePeak)*u*u*u);
}
export function cinemaTransformPixel(rgb:CinemaRgb,o:CinemaPixelOptions):[number,number,number] {
  const values=[o.sourceWhiteNits,o.targetWhiteNits,o.sourcePeakNits,o.targetPeakNits];
  if(values.some(v=>!Number.isFinite(v)||v<=0)) throw new Error('Invalid HDR luminance reference');
  const linear: CinemaRgb = [
    cinemaDecodeLuminance(rgb[0],o.sourceTransfer,o.sourceWhiteNits,o.sourcePeakNits),
    cinemaDecodeLuminance(rgb[1],o.sourceTransfer,o.sourceWhiteNits,o.sourcePeakNits),
    cinemaDecodeLuminance(rgb[2],o.sourceTransfer,o.sourceWhiteNits,o.sourcePeakNits),
  ];
  const sourcePeak=o.sourcePeakNits,targetPeak=o.targetPeakNits;
  const isDown=sourcePeak>targetPeak;
  // Use one luminance scale for the entire linear RGB triplet. Tonemapping
  // channels independently changes hue (most severely on saturated blue/red
  // highlights) and produces chroma inversion after a wide-gamut transform.
  const sourceMax=Math.max(0,...linear);
  const mappedMax=isDown
    ? cinemaToneMapNits(sourceMax,sourcePeak,targetPeak,o.knee)
    : cinemaInverseToneMapNits(sourceMax,sourcePeak,targetPeak);
  const scale=sourceMax>0?mappedMax/sourceMax:0;
  const mapped:CinemaRgb=[linear[0]*scale,linear[1]*scale,linear[2]*scale];
  const converted=cinemaConvertGamut(mapped,o.sourcePrimaries,o.targetPrimaries);
  return [
    cinemaEncodeLuminance(Math.max(0,converted[0]),o.targetTransfer,o.targetWhiteNits,targetPeak),
    cinemaEncodeLuminance(Math.max(0,converted[1]),o.targetTransfer,o.targetWhiteNits,targetPeak),
    cinemaEncodeLuminance(Math.max(0,converted[2]),o.targetTransfer,o.targetWhiteNits,targetPeak),
  ];
}
/** True integer 10-bit packing/unpacking, not proof of browser output precision. */
export function cinemaQuantize10(value:number):number {return Math.round(cinemaClamp(value)*1023);}
export function cinemaUnpack10(code:number):number {
  if(!Number.isSafeInteger(code)||code<0||code>1023) throw new Error('Invalid 10-bit sample');
  return code/1023;
}
export function cinemaTransformFrameFloat(
  input:Float32Array, options:CinemaPixelOptions,
):Float32Array {
  if(input.length%3!==0) throw new Error('Expected interleaved RGB input');
  const result=new Float32Array(input.length);
  for(let i=0;i<input.length;i+=3){
    const transformed=cinemaTransformPixel([input[i],input[i+1],input[i+2]],options);
    result.set(transformed,i);
  }
  return result;
}
