import { describe, expect, it, vi } from 'vitest';
import type { PlaybackBackend, BackendCapabilities, BackendEvent, BackendCommandResult } from './backend-contract';
import type { PlaybackEventEnvelope, PlaybackSessionIdentity } from './session-identity';
import type { PlaybackSnapshot, PlaybackSource } from './types';
import { createInitialPlaybackSnapshot } from './playback-state';
import { PlaybackController } from './playback-controller';

class FakeBackend implements PlaybackBackend {
  readonly kind = 'experimental' as const;
  private listeners = new Set<(event: PlaybackEventEnvelope<BackendEvent>) => void>();
  private identity: PlaybackSessionIdentity | null = null;
  private sequence = 0;
  attach(): void {}
  async load(_source: PlaybackSource, identity: PlaybackSessionIdentity): Promise<BackendCommandResult> { this.identity = identity; this.sequence = 0; return { ok: true }; }
  async play(): Promise<BackendCommandResult> { return { ok: true }; }
  pause(): BackendCommandResult { return { ok: true }; }
  seek(): BackendCommandResult { return { ok: true }; }
  setVolume(): BackendCommandResult { return { ok: true }; }
  setMuted(): BackendCommandResult { return { ok: true }; }
  setPlaybackRate(): BackendCommandResult { return { ok: true }; }
  selectAudioTrack(): BackendCommandResult { return { ok: true }; }
  selectTextTrack(): BackendCommandResult { return { ok: true }; }
  selectQuality(): BackendCommandResult { return { ok: true }; }
  getCapabilities(): BackendCapabilities { return { kind: this.kind, nativeHls: false, mse: false, audioTrackSelection: false, textTrackSelection: false, qualitySelection: false, reportsDecodedFrames: false }; }
  getSnapshot(): PlaybackSnapshot { return createInitialPlaybackSnapshot(); }
  subscribe(listener: (event: PlaybackEventEnvelope<BackendEvent>) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  dispose(): void { this.listeners.clear(); }
  emit(event: BackendEvent, identity = this.identity, sequence = ++this.sequence): void {
    if (!identity) throw new Error('No active identity');
    this.listeners.forEach(listener => listener({ identity, sequence, event }));
  }
}

describe('PlaybackController', () => {
  it('loads and consumes backend events for the active session', async () => {
    const backend = new FakeBackend();
    const controller = new PlaybackController(backend);
    await controller.load({ url: 'https://example.test/a.mp4', kind: 'mp4' });
    backend.emit({ type: 'METADATA', duration: 60 });
    backend.emit({ type: 'PLAYING' });
    expect(controller.getSnapshot().phase).toBe('playing');
    expect(controller.getSnapshot().duration).toBe(60);
    controller.dispose();
  });

  it('ignores events from a previous generation after source switch', async () => {
    const backend = new FakeBackend();
    const controller = new PlaybackController(backend);
    await controller.load({ url: 'https://example.test/a.mp4', kind: 'mp4' });
    const old = controller.getIdentity()!;
    await controller.load({ url: 'https://example.test/b.mp4', kind: 'mp4' });
    backend.emit({ type: 'PLAYING' }, old, 100);
    expect(controller.getSnapshot().phase).toBe('loading');
    controller.dispose();
  });

  it('disposes idempotently and rejects further commands', async () => {
    const backend = new FakeBackend();
    const dispose = vi.spyOn(backend, 'dispose');
    const controller = new PlaybackController(backend);
    controller.dispose();
    controller.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(() => controller.pause()).toThrow();
  });
});
