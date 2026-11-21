export type PlaybackAxis = 'idle' | 'active' | 'failed';
export type NetworkAxis = 'idle' | 'fetching' | 'stalled' | 'offline';
export type DecodeAxis = 'unknown' | 'decoding' | 'waiting' | 'failed';
export type SeekAxis = 'idle' | 'seeking' | 'settled';
export type AudioAxis = 'native' | 'processing' | 'bypassed' | 'failed';
export type FullscreenAxis = 'inline' | 'fullscreen' | 'picture-in-picture';

export interface PlaybackAxes {
  readonly playback: 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error' | 'disposed';
  readonly network: NetworkAxis;
  readonly decode: DecodeAxis;
  readonly seek: SeekAxis;
  readonly audio: AudioAxis;
  readonly fullscreen: FullscreenAxis;
}

export type PlaybackAxisEvent =
  | { type: 'LOAD' }
  | { type: 'READY' }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'END' }
  | { type: 'ERROR' }
  | { type: 'DISPOSE' }
  | { type: 'NETWORK'; value: NetworkAxis }
  | { type: 'DECODE'; value: DecodeAxis }
  | { type: 'SEEK'; value: SeekAxis }
  | { type: 'AUDIO'; value: AudioAxis }
  | { type: 'FULLSCREEN'; value: FullscreenAxis };

export const initialPlaybackAxes: PlaybackAxes = Object.freeze({
  playback: 'idle',
  network: 'idle',
  decode: 'unknown',
  seek: 'idle',
  audio: 'native',
  fullscreen: 'inline',
});

export function reducePlaybackAxes(state: PlaybackAxes, event: PlaybackAxisEvent): PlaybackAxes {
  if (state.playback === 'disposed' && event.type !== 'LOAD') return state;
  switch (event.type) {
    case 'LOAD': return { ...initialPlaybackAxes, playback: 'loading', network: 'fetching' };
    case 'READY': return { ...state, playback: 'ready', network: state.network === 'fetching' ? 'idle' : state.network };
    case 'PLAY': return { ...state, playback: 'playing' };
    case 'PAUSE': return { ...state, playback: 'paused' };
    case 'END': return { ...state, playback: 'ended', seek: 'idle' };
    case 'ERROR': return { ...state, playback: 'error' };
    case 'DISPOSE': return { ...state, playback: 'disposed', seek: 'idle', audio: 'native', fullscreen: 'inline' };
    case 'NETWORK': return { ...state, network: event.value };
    case 'DECODE': return { ...state, decode: event.value };
    case 'SEEK': return { ...state, seek: event.value };
    case 'AUDIO': return { ...state, audio: event.value };
    case 'FULLSCREEN': return { ...state, fullscreen: event.value };
    default: return state;
  }
}
