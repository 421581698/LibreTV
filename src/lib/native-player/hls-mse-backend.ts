import Hls from 'hls.js';
import { NativeMediaBackend } from './native-media-backend';
import type { PlaybackBackend, BackendCapabilities, BackendCommandResult, BackendEvent } from './backend-contract';
import type { PlaybackEventEnvelope, PlaybackSessionIdentity } from './session-identity';
import type { PlaybackSnapshot, PlaybackSource } from './types';

/**
 * MSE/HLS adapter. hls.js owns manifest/fragment loading; the native adapter
 * owns normalized HTMLMediaElement events and controls.
 */
export class HlsMseBackend implements PlaybackBackend {
  readonly kind = 'hls-mse' as const;
  private readonly media = new NativeMediaBackend();
  private hls: Hls | null = null;
  private element: HTMLMediaElement | null = null;
  private identity: PlaybackSessionIdentity | null = null;
  private listeners = new Set<(event: PlaybackEventEnvelope<BackendEvent>) => void>();
  private unsubscribeMedia: (() => void) | null = null;
  private sequence = 0;
  private disposed = false;

  static isSupported(): boolean {
    return typeof window !== 'undefined' && Hls.isSupported();
  }

  attach(element: HTMLMediaElement): void {
    this.assertActive();
    this.element = element;
    this.media.attach(element);
    this.unsubscribeMedia?.();
    this.unsubscribeMedia = this.media.subscribe(event => {
      // Preserve the media backend's source identity. Re-tagging an old queued
      // DOM event with the latest identity would defeat generation isolation.
      if (!this.identity || event.identity !== this.identity) return;
      this.sequence += 1;
      this.listeners.forEach(listener => listener({
        identity: event.identity,
        sequence: this.sequence,
        event: event.event,
      }));
    });
  }

  async load(source: PlaybackSource, identity: PlaybackSessionIdentity, signal?: AbortSignal): Promise<BackendCommandResult> {
    this.assertActive();
    if (!this.element) return { ok: false, reason: 'not-ready' };
    if (signal?.aborted) return { ok: false, reason: 'failed', error: { code: 'LOAD_ABORTED', message: 'The load was cancelled.', recoverable: true } };
    if (!Hls.isSupported()) return { ok: false, reason: 'unsupported' };
    if (source.kind !== 'hls') return { ok: false, reason: 'unsupported' };

    this.destroyHls();
    this.identity = identity;
    this.sequence = 0;
    this.media.setSessionIdentity(identity);
    const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
    this.hls = hls;
    hls.on(Hls.Events.ERROR, (_event, data) => {
      // A destroyed HLS instance may still have a queued callback. Bind the
      // callback to the identity and instance that created it; never label it
      // with a later source generation.
      if (!data.fatal || this.disposed || this.hls !== hls || this.identity !== identity) return;
      this.sequence += 1;
      this.listeners.forEach(listener => listener({
        identity,
        sequence: this.sequence,
        event: {
          type: 'ERROR',
          error: {
            code: `HLS_FATAL_${data.type}`,
            message: data.details,
            recoverable: data.type !== Hls.ErrorTypes.MEDIA_ERROR,
          },
        },
      }));
    });
    hls.attachMedia(this.element);
    hls.loadSource(source.url);
    return { ok: true };
  }

  play(): Promise<BackendCommandResult> { return this.media.play(); }
  pause(): BackendCommandResult { return this.media.pause(); }
  seek(seconds: number): BackendCommandResult { return this.media.seek(seconds); }
  setVolume(volume: number): BackendCommandResult { return this.media.setVolume(volume); }
  setMuted(muted: boolean): BackendCommandResult { return this.media.setMuted(muted); }
  setPlaybackRate(rate: number): BackendCommandResult { return this.media.setPlaybackRate(rate); }

  selectAudioTrack(index: number): BackendCommandResult {
    if (!this.hls) return { ok: false, reason: 'not-ready' };
    if (!Number.isInteger(index) || index < 0 || index >= this.hls.audioTracks.length) return { ok: false, reason: 'failed' };
    this.hls.audioTrack = index;
    return { ok: true };
  }

  selectTextTrack(index: number | null): BackendCommandResult {
    if (!this.hls) return { ok: false, reason: 'not-ready' };
    if (index !== null && (!Number.isInteger(index) || index < 0 || index >= this.hls.subtitleTracks.length)) return { ok: false, reason: 'failed' };
    this.hls.subtitleTrack = index ?? -1;
    return { ok: true };
  }

  selectQuality(index: number | null): BackendCommandResult {
    if (!this.hls) return { ok: false, reason: 'not-ready' };
    if (index !== null && (!Number.isInteger(index) || index < 0 || index >= this.hls.levels.length)) return { ok: false, reason: 'failed' };
    this.hls.currentLevel = index ?? -1;
    return { ok: true };
  }

  getCapabilities(): BackendCapabilities {
    const hls = this.hls;
    return {
      ...this.media.getCapabilities(),
      kind: this.kind,
      nativeHls: false,
      mse: Hls.isSupported(),
      audioTrackSelection: Boolean(hls && hls.audioTracks.length > 0),
      textTrackSelection: Boolean(hls && hls.subtitleTracks.length > 0),
      qualitySelection: Boolean(hls && hls.levels.length > 0),
    };
  }

  getSnapshot(): PlaybackSnapshot { return this.media.getSnapshot(); }

  subscribe(listener: (event: PlaybackEventEnvelope<BackendEvent>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeMedia?.();
    this.unsubscribeMedia = null;
    this.destroyHls();
    this.media.dispose();
    this.listeners.clear();
    this.identity = null;
    this.element = null;
  }

  private destroyHls(): void {
    if (!this.hls) return;
    this.hls.destroy();
    this.hls = null;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('HLS backend has been disposed.');
  }
}
