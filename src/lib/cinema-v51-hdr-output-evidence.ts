import type { CinemaP010Frame } from './cinema-v51-p010';
import { cinemaSupportsExtendedConfiguration } from './cinema-v51-webgpu-presenter';

export type CinemaHdrPixelStage =
  'not-established' | 'decoded-p010-10bit' | 'modified-p010-10bit' | 'extended-gpu-submitted';
export interface CinemaHdrPixelObservation {
  readonly sourceSha256: string;
  readonly expectedSourceSha256: string;
  readonly decodedPtsUs: number;
  readonly submittedPtsUs: number | null;
  readonly decoded: CinemaP010Frame;
  readonly transformed: CinemaP010Frame;
  readonly outputTransfer: 'sdr' | 'pq' | 'hlg';
  readonly gpuConfiguration?: {format?:string;colorSpace?:string;toneMapping?:{mode?:string}} | null;
  readonly gpuSubmissionConfirmed: boolean;
}
export interface CinemaHdrOutputAssessment {
  stage: CinemaHdrPixelStage;
  highPrecisionSamplesModified: boolean;
  extendedGpuSubmission: boolean;
  /** A browser GPU confirmation is not a physical display's HDR output. */
  physicalHdrOutput: 'unverified';
}
/**
 * Every stage is observable in-browser. None is physical EOTF/luminance proof.
 * The only claimed pixel transformation uses actual left-aligned P010 buffers,
 * not CSS filters or RGBA8 canvas readbacks.
 */
export function assessCinemaHdrPixelOutput(input:CinemaHdrPixelObservation):CinemaHdrOutputAssessment {
  const unsupported: CinemaHdrOutputAssessment = {
    stage:'not-established',highPrecisionSamplesModified:false,
    extendedGpuSubmission:false,physicalHdrOutput:'unverified',
  };
  if (!/^[a-f0-9]{64}$/.test(input.sourceSha256) ||
      input.sourceSha256!==input.expectedSourceSha256 ||
      !Number.isSafeInteger(input.decodedPtsUs) || input.decodedPtsUs<0) return unsupported;
  const original=input.decoded,processed=input.transformed;
  if (original.range!=='limited' || processed.range!=='limited' ||
      original.width!==processed.width || original.height!==processed.height ||
      original.y.length!==processed.y.length || original.uv.length!==processed.uv.length ||
      original.y.length!==original.width*original.height ||
      original.uv.length!==original.width*original.height/2) return unsupported;
  let different=false;
  for (const [before,after] of [[original.y,processed.y],[original.uv,processed.uv]]) {
    for(let i=0;i<before.length;i++) {
      if ((before[i]&63)!==0 || (after[i]&63)!==0) return unsupported;
      if (before[i]!==after[i]) different=true;
    }
  }
  const extended = different && input.outputTransfer!=='sdr' &&
    cinemaSupportsExtendedConfiguration(input.gpuConfiguration) &&
    input.gpuSubmissionConfirmed && input.submittedPtsUs===input.decodedPtsUs;
  return {
    stage:extended?'extended-gpu-submitted':different?'modified-p010-10bit':'decoded-p010-10bit',
    highPrecisionSamplesModified:different,
    extendedGpuSubmission:extended,
    physicalHdrOutput:'unverified',
  };
}
