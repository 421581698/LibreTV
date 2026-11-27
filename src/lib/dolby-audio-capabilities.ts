/**
 * Evidence-based audio capability and output classification.
 *
 * Browser feature availability is not proof of a decoded codec or physical
 * output route. Dolby/JOC claims require explicit runtime evidence.
 */

export type VerificationEvidence = 'verified' | 'not-integrated' | 'unsupported' | 'unknown';
export type SpatialProcessingEvidence = 'configured' | 'not-configured' | 'unknown';

export interface BrowserAudioFeatureSet {
  webAudio: boolean;
  mediaElementSource: boolean;
  hrtfPanner: boolean;
  audioWorklet: boolean;
  mediaCapabilitiesApi: boolean;
  webCodecsAudioDecoderApi: boolean;
}

export interface AudioVerificationEvidence {
  codec: string | null;
  inputChannels: number | null;
  hasJocMarker: boolean;
  nativeDolbyOutput: VerificationEvidence;
  jocDecode: VerificationEvidence;
  objectRendering: VerificationEvidence;
  binauralProcessing: SpatialProcessingEvidence;
}

export type AudioVerificationStatus =
  | 'native-dolby-output-verified'
  | 'joc-object-rendering-verified'
  | 'binaural-processing-configured'
  | 'joc-marker-only'
  | 'stereo-input'
  | 'unknown';

export interface AudioVerificationReport {
  status: AudioVerificationStatus;
  label: string;
  detail: string;
}

/**
 * Inspect browser API availability only. This does not instantiate AudioContext,
 * start audio, inspect OS settings, or claim native Dolby/Atmos support.
 */
export function inspectBrowserAudioFeatures(
  scope: {
    AudioContext?: { prototype?: { createMediaElementSource?: unknown; audioWorklet?: unknown } };
    PannerNode?: unknown;
    AudioWorkletNode?: unknown;
    AudioDecoder?: unknown;
    navigator?: { mediaCapabilities?: unknown };
  } = globalThis as unknown as {
    AudioContext?: { prototype?: { createMediaElementSource?: unknown; audioWorklet?: unknown } };
    PannerNode?: unknown;
    AudioWorkletNode?: unknown;
    AudioDecoder?: unknown;
    navigator?: { mediaCapabilities?: unknown };
  },
): BrowserAudioFeatureSet {
  const audioContext = scope.AudioContext;
  return {
    webAudio: Boolean(audioContext),
    mediaElementSource: typeof audioContext?.prototype?.createMediaElementSource === 'function',
    hrtfPanner: Boolean(scope.PannerNode),
    audioWorklet: Boolean(scope.AudioWorkletNode || audioContext?.prototype?.audioWorklet),
    mediaCapabilitiesApi: Boolean(scope.navigator?.mediaCapabilities),
    webCodecsAudioDecoderApi: Boolean(scope.AudioDecoder),
  };
}

/**
 * Classify only what the supplied evidence proves. A JOC marker alone is never
 * promoted to JOC decoding, object rendering, or Dolby Atmos output.
 */
export function classifyAudioVerification(
  evidence: AudioVerificationEvidence,
): AudioVerificationReport {
  if (evidence.nativeDolbyOutput === 'verified') {
    return {
      status: 'native-dolby-output-verified',
      label: '原生 Dolby 输出已验证',
      detail: '设备或系统提供了可追溯的实际输出证据。',
    };
  }

  if (evidence.jocDecode === 'verified' && evidence.objectRendering === 'verified') {
    return {
      status: 'joc-object-rendering-verified',
      label: 'JOC 解码与对象渲染已验证',
      detail: '解码和对象渲染均有独立证据；这仍不等于 Dolby 认证。',
    };
  }

  if (evidence.binauralProcessing === 'configured') {
    return {
      status: 'binaural-processing-configured',
      label: '软件双耳空间处理已配置',
      detail: '这是 Web Audio/HRTF 处理路径，不是 Dolby Atmos 对象解码，也不证明耳机实际输出效果。',
    };
  }

  if (evidence.hasJocMarker) {
    return {
      status: 'joc-marker-only',
      label: '检测到 JOC 标记，尚未解码验证',
      detail: '清单或音轨元数据中的 JOC 标记只代表格式提示，不代表浏览器已还原对象音频。',
    };
  }

  if (evidence.inputChannels === 2) {
    return {
      status: 'stereo-input',
      label: '普通立体声音轨',
      detail: '当前证据只确认双声道输入。',
    };
  }

  return {
    status: 'unknown',
    label: '音频输出状态未知',
    detail: '缺少足以确认解码、渲染或物理输出路径的证据。',
  };
}

/** Browser code intentionally cannot claim native OS Dolby output or JOC decoding. */
export function createBrowserAudioEvidence(input: {
  codec?: string | null;
  inputChannels?: number | null;
  hasJocMarker?: boolean;
  binauralProcessing?: SpatialProcessingEvidence;
} = {}): AudioVerificationEvidence {
  return {
    codec: input.codec ?? null,
    inputChannels: input.inputChannels ?? null,
    hasJocMarker: input.hasJocMarker ?? false,
    nativeDolbyOutput: 'unknown',
    jocDecode: 'not-integrated',
    objectRendering: 'not-integrated',
    binauralProcessing: input.binauralProcessing ?? 'not-configured',
  };
}
