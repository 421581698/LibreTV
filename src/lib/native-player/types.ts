export type PlaybackPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'ended'
  | 'error'
  | 'disposed';

export type MediaKind = 'hls' | 'mp4' | 'webm' | 'unknown';

export interface PlaybackSource {
  url: string;
  kind: MediaKind;
  mimeType?: string;
  sourceId?: string;
  episodeId?: string;
}

export interface PlaybackError {
  code: string;
  message: string;
  recoverable: boolean;
  cause?: unknown;
}

export interface PlaybackSnapshot {
  phase: PlaybackPhase;
  source: PlaybackSource | null;
  currentTime: number;
  duration: number;
  bufferedAhead: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  seeking: boolean;
  error: PlaybackError | null;
  updatedAt: number;
}

export type PlaybackEvent =
  | { type: 'LOAD'; source: PlaybackSource }
  | { type: 'METADATA'; duration: number }
  | { type: 'CAN_PLAY' }
  | { type: 'PLAY_REQUEST' }
  | { type: 'PLAYING' }
  | { type: 'PAUSE' }
  | { type: 'WAITING' }
  | { type: 'TIME_UPDATE'; currentTime: number; bufferedAhead?: number }
  | { type: 'SEEK_START' }
  | { type: 'SEEKED' }
  | { type: 'ENDED' }
  | { type: 'ERROR'; error: PlaybackError }
  | { type: 'RESET' }
  | { type: 'DISPOSE' };
