import { createInitialPlaybackSnapshot } from './playback-state';
import type { PlaybackBackend, BackendCapabilities, BackendEvent, BackendCommandResult } from './backend-contract';
import type { PlaybackSessionIdentity, PlaybackEventEnvelope } from './session-identity';
import type { PlaybackError, PlaybackSnapshot, PlaybackSource } from './types';

function toError(error: MediaError | null): PlaybackError {
  return {
    code: error ? `MEDIA_ERROR_${error.code}` : 'MEDIA_ERROR_UNKNOWN',
    message: error?.message || 'The media element reported a playback error.',
    recoverable: Boolean(error && (error.code === MediaError.MEDIA_ERR_NETWORK || error.code === MediaError.MEDIA_ERR_DECODE)),
  };
}

function bufferedAhead(element: HTMLMediaElement): number {
  const time = element.currentTime;
  for (let i = 0; i < element.buffered.length; i += 1) {
    const start = element.buffered.start(i);
    const end = element.buffered.end(i);
    if (time >= start && time <= end) return Math.max(0, end - time);
  }
  return 0;
}

/** HTMLMediaElement adapter. It deliberately does not own HLS/MSE attachment. */
export class NativeMediaBackend implements PlaybackBackend {
  readonly kind = 'native-media' as const;
  private element: HTMLMediaElement | null = null;
  private identity: PlaybackSessionIdentity | null = null;
  private sequence = 0;
  private listeners = new Set<(event: PlaybackEventEnvelope<BackendEvent>) => void>();
  private cleanups: Array<() => void> = [];
  private disposed = false;

  attach(element: HTMLMediaElement): void {
    if (this.disposed) throw new Error('Cannot attach a disposed media backend.');
    this.detachListeners();
    this.element = element;
    const bind = (name: keyof HTMLMediaElementEventMap, event: BackendEvent | (() => BackendEvent)) => {
      const handler = () => this.emit(typeof event === 'function' ? event() : event);
      element.addEventListener(name, handler);
      this.cleanups.push(() => element.removeEventListener(name, handler));
    };
    bind('loadstart', { type: 'LOAD_START' });
    bind('loadedmetadata', () => ({ type: 'METADATA', duration: element.duration }));
    bind('canplay', { type: 'CAN_PLAY' });
    bind('playing', { type: 'PLAYING' });
    bind('pause', { type: 'PAUSE' });
    bind('waiting', { type: 'WAITING' });
    bind('timeupdate', () => ({ type: 'TIME_UPDATE', currentTime: element.currentTime, bufferedAhead: bufferedAhead(element) }));
    bind('seeking', { type: 'SEEK_START' });
    bind('seeked', { type: 'SEEKED' });
    bind('ended', { type: 'ENDED' });
    bind('error', () => ({ type: 'ERROR', error: toError(element.error) }));
  }

  setSessionIdentity(identity: PlaybackSessionIdentity): void {
    this.identity = identity;
    this.sequence = 0;
  }

  async load(source: PlaybackSource, identity: PlaybackSessionIdentity, signal?: AbortSignal): Promise<BackendCommandResult> {
    if (this.disposed || !this.element) return { ok: false, reason: 'not-ready' };
    if (signal?.aborted) return { ok: false, reason: 'failed', error: { code: 'LOAD_ABORTED', message: 'The load was cancelled.', recoverable: true } };
    const element = this.element;
    this.setSessionIdentity(identity);
    element.src = source.url;
    element.load();
    return { ok: true };
  }

  async play(): Promise<BackendCommandResult> {
    const element = this.requireElement();
    try {
      await element.play();
      return { ok: true };
    } catch (cause) {
      return { ok: false, reason: 'failed', error: { code: 'PLAY_REJECTED', message: cause instanceof Error ? cause.message : 'Playback was rejected.', recoverable: true, cause } };
    }
  }

  pause(): BackendCommandResult { this.requireElement().pause(); return { ok: true }; }

  seek(seconds: number): BackendCommandResult {
    const element = this.requireElement();
    if (!Number.isFinite(seconds) || seconds < 0) return { ok: false, reason: 'failed', error: { code: 'INVALID_SEEK', message: 'Seek target must be a finite non-negative number.', recoverable: false } };
    if (!Number.isFinite(element.duration) || element.duration <= 0) return { ok: false, reason: 'not-ready' };
    element.currentTime = Math.min(seconds, element.duration);
    return { ok: true };
  }

  setVolume(volume: number): BackendCommandResult {
    if (!Number.isFinite(volume)) return { ok: false, reason: 'failed' };
    this.requireElement().volume = Math.min(1, Math.max(0, volume));
    return { ok: true };
  }

  setMuted(muted: boolean): BackendCommandResult { this.requireElement().muted = muted; return { ok: true }; }

  setPlaybackRate(rate: number): BackendCommandResult {
    if (!Number.isFinite(rate) || rate <= 0) return { ok: false, reason: 'failed' };
    this.requireElement().playbackRate = rate;
    return { ok: true };
  }

  getCapabilities(): BackendCapabilities {
    const mse = typeof MediaSource !== 'undefined';
    return {
      kind: this.kind,
      nativeHls: Boolean(this.element?.canPlayType('application/vnd.apple.mpegurl') || this.element?.canPlayType('application/x-mpegURL')),
      mse,
      audioTrackSelection: Boolean(this.element && 'audioTracks' in this.element),
      textTrackSelection: Boolean(this.element && 'textTracks' in this.element),
      qualitySelection: false,
      reportsDecodedFrames: Boolean(this.element && 'getVideoPlaybackQuality' in this.element),
    };
  }

  getSnapshot(): PlaybackSnapshot {
    const e = this.element;
    if (!e) return createInitialPlaybackSnapshot();
    return {
      phase: e.error ? 'error' : e.ended ? 'ended' : e.paused ? (e.currentTime > 0 ? 'paused' : 'ready') : e.readyState < HTMLMediaElement.HAVE_FUTURE_DATA ? 'buffering' : 'playing',
      source: e.currentSrc ? { url: e.currentSrc, kind: 'unknown' } : null,
      currentTime: Number.isFinite(e.currentTime) ? e.currentTime : 0,
      duration: Number.isFinite(e.duration) ? e.duration : 0,
      bufferedAhead: bufferedAhead(e),
      volume: e.volume,
      muted: e.muted,
      playbackRate: e.playbackRate,
      seeking: e.seeking,
      error: e.error ? toError(e.error) : null,
      updatedAt: Date.now(),
    };
  }

  subscribe(listener: (event: PlaybackEventEnvelope<BackendEvent>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachListeners();
    this.listeners.clear();
    this.identity = null;
    this.element = null;
  }

  private emit(event: BackendEvent): void {
    if (!this.identity || this.disposed) return;
    this.sequence += 1;
    const envelope = { identity: this.identity, sequence: this.sequence, event };
    this.listeners.forEach(listener => listener(envelope));
  }

  private requireElement(): HTMLMediaElement {
    if (this.disposed) throw new Error('Media backend has been disposed.');
    if (!this.element) throw new Error('Media backend is not attached to a media element.');
    return this.element;
  }

  private detachListeners(): void {
    this.cleanups.splice(0).forEach(cleanup => cleanup());
  }
}
