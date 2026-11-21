import Hls from 'hls.js';
import type { PlaybackBackend } from './backend-contract';
import type { PlaybackSource } from './types';
import { HlsMseBackend } from './hls-mse-backend';
import { NativeMediaBackend } from './native-media-backend';

export type BackendPreference = 'auto' | 'native' | 'hls-mse';

export interface BackendSelection {
  readonly backend: PlaybackBackend;
  readonly reason: string;
}

/** Selects a backend without touching the media element or changing the source. */
export function selectPlaybackBackend(
  source: PlaybackSource,
  preference: BackendPreference = 'auto',
  environment: { readonly hasWindow: boolean; readonly mseSupported: boolean; readonly nativeHlsSupported: boolean } = {
    hasWindow: typeof window !== 'undefined',
    mseSupported: typeof window !== 'undefined' && Hls.isSupported(),
    nativeHlsSupported: false,
  },
): BackendSelection {
  if (preference === 'hls-mse') {
    if (!environment.hasWindow || !environment.mseSupported) {
      return { backend: new NativeMediaBackend(), reason: 'HLS/MSE unavailable; native fallback selected.' };
    }
    return { backend: new HlsMseBackend(), reason: 'Explicit HLS/MSE preference.' };
  }

  if (preference === 'native') {
    return { backend: new NativeMediaBackend(), reason: 'Explicit native media preference.' };
  }

  if (source.kind === 'hls' && environment.hasWindow && environment.mseSupported) {
    return { backend: new HlsMseBackend(), reason: 'HLS source with MSE support; hls.js backend selected.' };
  }

  return { backend: new NativeMediaBackend(), reason: source.kind === 'hls' && environment.nativeHlsSupported
    ? 'Native HLS capability reported; native media backend selected.'
    : 'Native media backend selected as the safe default.' };
}
