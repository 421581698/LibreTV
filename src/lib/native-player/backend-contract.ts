import type { PlaybackError, PlaybackSource, PlaybackSnapshot } from './types';
import type { PlaybackEventEnvelope, PlaybackSessionIdentity } from './session-identity';

export type BackendKind = 'native-media' | 'hls-mse' | 'experimental';

export interface BackendCapabilities {
  readonly kind: BackendKind;
  readonly nativeHls: boolean;
  readonly mse: boolean;
  readonly audioTrackSelection: boolean;
  readonly textTrackSelection: boolean;
  readonly qualitySelection: boolean;
  readonly reportsDecodedFrames: boolean;
}

export type BackendCommandResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'unsupported' | 'not-ready' | 'failed'; readonly error?: PlaybackError };

export type BackendEvent =
  | { type: 'LOAD_START' }
  | { type: 'METADATA'; duration: number }
  | { type: 'CAN_PLAY' }
  | { type: 'PLAYING' }
  | { type: 'PAUSE' }
  | { type: 'WAITING' }
  | { type: 'TIME_UPDATE'; currentTime: number; bufferedAhead: number }
  | { type: 'SEEK_START' }
  | { type: 'SEEKED' }
  | { type: 'ENDED' }
  | { type: 'ERROR'; error: PlaybackError };

export interface PlaybackBackend {
  readonly kind: BackendKind;
  attach(element: HTMLMediaElement): void;
  load(source: PlaybackSource, identity: PlaybackSessionIdentity, signal?: AbortSignal): Promise<BackendCommandResult>;
  play(): Promise<BackendCommandResult>;
  pause(): BackendCommandResult;
  seek(seconds: number): BackendCommandResult;
  setVolume(volume: number): BackendCommandResult;
  setMuted(muted: boolean): BackendCommandResult;
  setPlaybackRate(rate: number): BackendCommandResult;
  selectAudioTrack(index: number): BackendCommandResult;
  selectTextTrack(index: number | null): BackendCommandResult;
  selectQuality(index: number | null): BackendCommandResult;
  getCapabilities(): BackendCapabilities;
  getSnapshot(): PlaybackSnapshot;
  subscribe(listener: (event: PlaybackEventEnvelope<BackendEvent>) => void): () => void;
  dispose(): void;
}

export const unsupported = (): BackendCommandResult => ({ ok: false, reason: 'unsupported' });
