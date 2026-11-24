import type { AudioCodec, DolbyFamily } from './format-detector';

export interface AudioCapabilityEnvironment {
  userAgent?: string;
  audioContextAvailable: boolean;
  mediaSourceAvailable: boolean;
  mediaCapabilitiesAvailable: boolean;
  canPlayType?: (mimeType: string) => string;
  outputMaxChannels?: number | null;
  outputLatencyMs?: number | null;
}

export interface AudioCapabilityProfile {
  browserFamily: 'safari' | 'chromium' | 'firefox' | 'other' | 'unknown';
  audioContext: boolean;
  mediaSource: boolean;
  mediaCapabilities: boolean;
  outputMaxChannels: number | null;
  outputLatencyMs: number | null;
  nativeDolbyDecode: 'unknown';
  bitstreamPassthrough: 'unknown';
  notes: string[];
}

export interface CodecCapabilityAssessment {
  codec: AudioCodec;
  dolbyFamily: DolbyFamily;
  browserDecode: 'not-probed' | 'can-play-hint' | 'cannot-play-hint';
  atmosObjectDecode: 'not-established';
  bitstreamPassthrough: 'not-established';
  safeDefault: 'native-media-playback';
  notes: string[];
}

export function inspectAudioCapabilities(environment: AudioCapabilityEnvironment): AudioCapabilityProfile {
  const ua = (environment.userAgent ?? '').toLowerCase();
  const browserFamily = !ua ? 'unknown'
    : /safari/.test(ua) && !/(chrome|chromium|crios|edg)/.test(ua) ? 'safari'
      : /(chrome|chromium|crios|edg)/.test(ua) ? 'chromium'
        : /firefox|fxios/.test(ua) ? 'firefox' : 'other';
  return {
    browserFamily,
    audioContext: environment.audioContextAvailable,
    mediaSource: environment.mediaSourceAvailable,
    mediaCapabilities: environment.mediaCapabilitiesAvailable,
    outputMaxChannels: Number.isFinite(environment.outputMaxChannels) ? environment.outputMaxChannels ?? null : null,
    outputLatencyMs: Number.isFinite(environment.outputLatencyMs) ? environment.outputLatencyMs ?? null : null,
    nativeDolbyDecode: 'unknown',
    bitstreamPassthrough: 'unknown',
    notes: [
      'Web API 不提供跨浏览器通用且可靠的 Dolby Atmos 对象解码状态。',
      'AudioContext、声道数和 canPlayType 提示不能证明 HDMI/AVR 位流直通。',
    ],
  };
}

/** A canPlayType result is only a browser hint, never proof of successful decode. */
export function assessCodecCapability(
  codec: AudioCodec,
  dolbyFamily: DolbyFamily,
  mimeType: string,
  environment: AudioCapabilityEnvironment,
): CodecCapabilityAssessment {
  let browserDecode: CodecCapabilityAssessment['browserDecode'] = 'not-probed';
  if (environment.canPlayType) {
    const answer = environment.canPlayType(mimeType);
    browserDecode = answer === 'probably' || answer === 'maybe' ? 'can-play-hint'
      : answer === '' ? 'cannot-play-hint' : 'not-probed';
  }
  const notes = ['canPlayType 仅是格式提示，实际解码仍需播放成功与设备侧验证。'];
  if (dolbyFamily !== 'none' && dolbyFamily !== 'unknown') {
    notes.push('未验证 Dolby 位流直通或 Atmos 对象解码；保持浏览器原生媒体路径。');
  }
  return {
    codec,
    dolbyFamily,
    browserDecode,
    atmosObjectDecode: 'not-established',
    bitstreamPassthrough: 'not-established',
    safeDefault: 'native-media-playback',
    notes,
  };
}
