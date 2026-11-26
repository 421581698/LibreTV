import type { ExperimentalPcm } from './openjoc-experimental-decoder';

export interface ExperimentalAudioDecoder {
  push(data: Uint8Array, packet?: { ptsSamples: bigint | null; discontinuity?: boolean; preroll?: boolean }): number;
  receive(): ExperimentalPcm | null;
  reset(): void;
  close(): void;
}
export interface ExperimentalAudioOutput {
  enqueue(frame: ExperimentalPcm, mediaTime: number, playbackRate: number): 'schedule' | 'wait' | 'drop' | 'reset';
  reset(): void;
}
export interface ExperimentalAudioMedia {
  currentTime: number;
  playbackRate: number;
  paused: boolean;
  muted: boolean;
}

/**
 * Explicitly-armed experimental PCM lifecycle. No decoder or output is created
 * unless an authorized caller supplies both. Native audio is never muted until
 * a first valid PCM frame is scheduled. Not a Dolby Atmos-certified renderer.
 */
export class ExperimentalAudioSession {
  private decoder: ExperimentalAudioDecoder | null = null;
  private output: ExperimentalAudioOutput | null = null;
  private ownsMute = false;
  private nativeMutedBeforeStart = false;
  private armed = false;
  private failed = false;
  private disposed = false;

  constructor(private readonly media: ExperimentalAudioMedia) {}

  arm(decoder: ExperimentalAudioDecoder, output: ExperimentalAudioOutput): boolean {
    if (this.disposed || this.armed || this.decoder || this.output) return false;
    // An already-muted media element may be user-muted; never take ownership of
    // that mute or start an independent output behind a user mute.
    if (this.media.muted || this.media.paused) return false;
    this.decoder = decoder;
    this.output = output;
    this.failed = false;
    this.armed = true;
    return true;
  }

  get state(): 'idle' | 'armed' | 'active' | 'failed' | 'closed' {
    if (this.disposed) return 'closed';
    if (this.failed) return 'failed';
    if (!this.armed) return 'idle';
    return this.ownsMute ? 'active' : 'armed';
  }

  push(data: Uint8Array, ptsSamples: bigint | null): boolean {
    if (!this.armed || this.failed || this.media.paused || this.disposed ||
        !this.decoder || !this.output) return false;
    try {
      const status = this.decoder.push(data, { ptsSamples });
      if (status !== 0 && status !== 1 && status !== 2 && status !== 3) {
        this.fail();
        return false;
      }
      // One input can produce multiple PCM frames; bound work per push.
      for (let i = 0; i < 32; i++) {
        const frame = this.decoder.receive();
        if (!frame) return true;
        const decision = this.output.enqueue(frame, this.media.currentTime, this.media.playbackRate);
        if (decision === 'reset') { this.fail(); return false; }
        // Queue exhaustion cannot silently drop an already-decoded frame:
        // doing so would desynchronize sound from the video timeline.
        if (decision === 'wait') { this.fail(); return false; }
        if (decision === 'schedule' && !this.ownsMute) {
          if (this.media.paused || this.media.muted) {
            this.fail();
            return false;
          }
          this.nativeMutedBeforeStart = this.media.muted;
          this.media.muted = true;
          this.ownsMute = true;
        }
      }
      this.fail(); // Unbounded decoder output must not hang the UI thread.
      return false;
    } catch {
      this.fail();
      return false;
    }
  }

  onPlay(): void {
    // The caller must re-arm after pause. Never automatically resume an old
    // decoder clock or accidentally mute normal playback.
    if (this.disposed) return;
    if (this.media.paused) return;
  }

  onPause(): void { this.deactivate(); }
  onSeek(): void { this.deactivate(); }
  onRateChange(): void { this.deactivate(); }
  onTrackChange(): void { this.deactivate(); }

  onSourceChange(): void {
    this.deactivate();
    try { this.decoder?.close(); } catch { /* best-effort cleanup */ }
    this.decoder = null;
    this.output = null;
    this.armed = false;
    this.failed = false;
  }

  fail(): void {
    if (this.disposed) return;
    this.deactivate();
    this.failed = true;
    this.armed = false;
    try { this.decoder?.close(); } catch { /* preserve native fallback */ }
    this.decoder = null;
    this.output = null;
  }

  close(): void {
    if (this.disposed) return;
    this.onSourceChange();
    this.disposed = true;
  }

  private deactivate(): void {
    // Stop PCM before unmuting the native track to avoid dual audio.
    try { this.output?.reset(); } catch { /* keep restoring native audio */ }
    try { this.decoder?.reset(); } catch { this.failed = true; this.armed = false; }
    if (this.ownsMute) {
      // Do not override a later user change to the volume mute state.
      if (this.media.muted) this.media.muted = this.nativeMutedBeforeStart;
      this.ownsMute = false;
    }
  }
}
