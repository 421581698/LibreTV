import { createPlaybackEventCursor, createPlaybackSessionIdentity, isCurrentPlaybackEvent } from './session-identity';
import type { PlaybackBackend, BackendEvent, BackendCommandResult } from './backend-contract';
import type { PlaybackEventEnvelope, PlaybackSessionIdentity } from './session-identity';
import { createInitialPlaybackSnapshot, reducePlayback } from './playback-state';
import type { PlaybackSnapshot, PlaybackSource } from './types';

export class PlaybackController {
  private backend: PlaybackBackend;
  private snapshot: PlaybackSnapshot = createInitialPlaybackSnapshot();
  private identity: PlaybackSessionIdentity | null = null;
  private cursor = createPlaybackEventCursor(createPlaybackSessionIdentity('uninitialized', 0));
  private generation = 0;
  private unsubscribeBackend: (() => void) | null = null;
  private listeners = new Set<(snapshot: PlaybackSnapshot) => void>();
  private disposed = false;
  private loadAbort: AbortController | null = null;

  constructor(backend: PlaybackBackend) {
    this.backend = backend;
    this.unsubscribeBackend = backend.subscribe(event => this.onBackendEvent(event));
  }

  subscribe(listener: (snapshot: PlaybackSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): PlaybackSnapshot { return this.snapshot; }
  getIdentity(): PlaybackSessionIdentity | null { return this.identity; }

  attach(element: HTMLMediaElement): void {
    this.assertActive();
    this.backend.attach(element);
  }

  /**
   * Attach diagnostics to a source already managed by ArtPlayer/hls.js or the
   * browser. This path is intentionally observation-only: it never calls load()
   * and never asks the backend to mutate the element's source.
   */
  observeExistingSource(source: PlaybackSource, element: HTMLMediaElement): BackendCommandResult {
    this.assertActive();
    if (!this.backend.observeExistingSource) return { ok: false, reason: 'unsupported' };
    this.loadAbort?.abort();
    this.loadAbort = null;
    const generation = ++this.generation;
    const identity = createPlaybackSessionIdentity(`observed-${generation}-${Date.now()}`, generation);
    this.identity = identity;
    this.cursor = createPlaybackEventCursor(identity);
    this.dispatch({ type: 'LOAD', source });
    const result = this.backend.observeExistingSource(element, identity);
    if (!result.ok) {
      this.identity = null;
      return result;
    }
    return result;
  }

  async load(source: PlaybackSource, element?: HTMLMediaElement): Promise<BackendCommandResult> {
    this.assertActive();
    this.loadAbort?.abort();
    this.loadAbort = new AbortController();
    const generation = ++this.generation;
    const identity = createPlaybackSessionIdentity(`playback-${generation}-${Date.now()}`, generation);
    this.identity = identity;
    this.cursor = createPlaybackEventCursor(identity);
    if (element) this.backend.attach(element);
    this.dispatch({ type: 'LOAD', source });
    const signal = this.loadAbort.signal;
    const result = await this.backend.load(source, identity, signal);
    if (signal.aborted || this.identity !== identity) return { ok: false, reason: 'failed', error: { code: 'STALE_LOAD', message: 'The source load was superseded by a newer session.', recoverable: true } };
    return result;
  }

  async play(): Promise<BackendCommandResult> {
    this.assertActive();
    return this.backend.play();
  }
  pause(): BackendCommandResult { this.assertActive(); return this.backend.pause(); }
  seek(seconds: number): BackendCommandResult { this.assertActive(); return this.backend.seek(seconds); }
  setVolume(value: number): BackendCommandResult { this.assertActive(); return this.backend.setVolume(value); }
  setMuted(value: boolean): BackendCommandResult { this.assertActive(); return this.backend.setMuted(value); }
  setPlaybackRate(value: number): BackendCommandResult { this.assertActive(); return this.backend.setPlaybackRate(value); }
  selectAudioTrack(index: number): BackendCommandResult { this.assertActive(); return this.backend.selectAudioTrack(index); }
  selectTextTrack(index: number | null): BackendCommandResult { this.assertActive(); return this.backend.selectTextTrack(index); }
  selectQuality(index: number | null): BackendCommandResult { this.assertActive(); return this.backend.selectQuality(index); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loadAbort?.abort();
    this.loadAbort = null;
    this.unsubscribeBackend?.();
    this.unsubscribeBackend = null;
    this.backend.dispose();
    this.identity = null;
    this.snapshot = reducePlayback(this.snapshot, { type: 'DISPOSE' });
    this.listeners.forEach(listener => listener(this.snapshot));
    this.listeners.clear();
  }

  private onBackendEvent(envelope: PlaybackEventEnvelope<BackendEvent>): void {
    if (!this.identity || !isCurrentPlaybackEvent(this.cursor, envelope)) return;
    this.cursor = { ...this.cursor, lastAcceptedSequence: envelope.sequence };
    const event = envelope.event;
    switch (event.type) {
      case 'METADATA': this.dispatch({ type: 'METADATA', duration: event.duration }); break;
      case 'CAN_PLAY': this.dispatch({ type: 'CAN_PLAY' }); break;
      case 'PLAYING': this.dispatch({ type: 'PLAYING' }); break;
      case 'PAUSE': this.dispatch({ type: 'PAUSE' }); break;
      case 'WAITING': this.dispatch({ type: 'WAITING' }); break;
      case 'TIME_UPDATE': this.dispatch({ type: 'TIME_UPDATE', currentTime: event.currentTime, bufferedAhead: event.bufferedAhead }); break;
      case 'SEEK_START': this.dispatch({ type: 'SEEK_START' }); break;
      case 'SEEKED': this.dispatch({ type: 'SEEKED' }); break;
      case 'ENDED': this.dispatch({ type: 'ENDED' }); break;
      case 'ERROR': this.dispatch({ type: 'ERROR', error: event.error }); break;
      default: break;
    }
  }

  private dispatch(event: Parameters<typeof reducePlayback>[1]): void {
    this.snapshot = reducePlayback(this.snapshot, event);
    this.listeners.forEach(listener => listener(this.snapshot));
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Playback controller has been disposed.');
  }
}
