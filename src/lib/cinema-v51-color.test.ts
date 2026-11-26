import {describe,it,expect} from 'vitest';
import {
  cinemaPqEotf,cinemaPqOetf,cinemaHlgOetf,cinemaHlgInverseOetf,
  cinemaSrgbToLinear,cinemaLinearToSrgb,cinemaDecodeLuminance,
  cinemaConvertGamut,cinemaTransformPixel,cinemaQuantize10,cinemaUnpack10,
  cinemaTransformFrameFloat,
} from './cinema-v51-color';
describe('Cinema V5.1 Pro physically referenced HDR color pipeline',()=>{
  it('follows SMPTE ST2084 black, reference 100 nits and absolute white',()=>{
    expect(cinemaPqEotf(0)).toBeCloseTo(0,3);
    expect(cinemaPqEotf(cinemaPqOetf(100))).toBeCloseTo(100,3);
    expect(cinemaPqEotf(1)).toBeCloseTo(10000,2);
    expect(cinemaPqEotf(0.50807842)).toBeCloseTo(100,0);
  });
  it('roundtrips HLG reference samples and SDR transfer functions',()=>{
    for(const x of [0,0.01,0.18,0.5,0.75,1]) {
      expect(cinemaHlgInverseOetf(cinemaHlgOetf(x))).toBeCloseTo(x,5);
      expect(cinemaSrgbToLinear(cinemaLinearToSrgb(x))).toBeCloseTo(x,5);
    }
    expect(cinemaDecodeLuminance(.5,'hlg',100,1000)).toBeGreaterThan(0);
  });
  it('roundtrips Rec709, Display-P3 and Rec2020 via XYZ without silent clipping',()=>{
    const original:[number,number,number]=[.22,.48,.75];
    for(const primaries of ['rec709','display-p3'] as const) {
      const wide=cinemaConvertGamut(original,primaries,'rec2020');
      const reverse=cinemaConvertGamut(wide,'rec2020',primaries);
      reverse.forEach((v,i)=>expect(v).toBeCloseTo(original[i],5));
    }
  });
  it('converts 1000 nit PQ/Rec2020 to bounded SDR/Rec709 in reference float space',()=>{
    const options={
      sourceTransfer:'pq' as const,targetTransfer:'srgb' as const,
      sourcePrimaries:'rec2020' as const,targetPrimaries:'rec709' as const,
      sourceWhiteNits:203,targetWhiteNits:100,sourcePeakNits:1000,targetPeakNits:100,
    };
    const input:[number,number,number]=[cinemaPqOetf(800),cinemaPqOetf(400),cinemaPqOetf(100)];
    const output=cinemaTransformPixel(input,options);
    expect(output.every(v=>v>=0&&v<=1)).toBe(true);
    expect(output[0]).toBeGreaterThan(output[1]);
    expect(output[1]).toBeGreaterThan(output[2]);
    const frame=cinemaTransformFrameFloat(new Float32Array([...input,...input]),options);
    expect(frame.length).toBe(6);
    expect(frame[0]).toBeCloseTo(output[0],5);
    expect(()=>cinemaTransformFrameFloat(new Float32Array([0,1]),options)).toThrow();
  });
  it('converts SDR into valid PQ samples but cannot recreate clipped highlights',()=>{
    const options={
      sourceTransfer:'srgb' as const,targetTransfer:'pq' as const,
      sourcePrimaries:'rec709' as const,targetPrimaries:'rec2020' as const,
      sourceWhiteNits:100,targetWhiteNits:203,sourcePeakNits:100,targetPeakNits:1000,
    };
    const out=cinemaTransformPixel([.2,.5,.9],options);
    expect(out.every(v=>v>=0&&v<=1)).toBe(true);
    expect(out[0]).toBeLessThan(out[1]);
    expect(out[1]).toBeLessThan(out[2]);
  });
  it('preserves 10-bit endpoints and rejects malformed integer samples',()=>{
    expect(cinemaQuantize10(0)).toBe(0);
    expect(cinemaQuantize10(1)).toBe(1023);
    expect(cinemaUnpack10(1023)).toBe(1);
    expect(cinemaUnpack10(512)).toBeCloseTo(512/1023,8);
    expect(()=>cinemaUnpack10(1024)).toThrow();
    expect(()=>cinemaUnpack10(1.4)).toThrow();
  });
});
