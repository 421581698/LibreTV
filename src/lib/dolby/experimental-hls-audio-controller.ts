import type Hls from 'hls.js';
import { bindExperimentalHlsAudio } from './bind-experimental-hls-audio';
import { loadUserOpenJocWasm } from './openjoc-user-wasm';

/** Explicit, per-source opt-in. No decoder is ever enabled by default. */
export class ExperimentalHlsAudioController {
  private hls: Hls | null = null;
  private video: HTMLVideoElement | null = null;
  private current: (() => boolean) | null = null;
  private file: File | null = null;
  private origin90k = 0;
  private authorized = false;
  private loading = false;
  private disposed = false;
  private attempt = 0;
  private cleanup: (() => void) | null = null;
  private context: AudioContext | null = null;
  constructor(private readonly status: (message: string, authorized: boolean) => void) {}

  get enabled(): boolean { return this.authorized; }

  setSource(hls: Hls, video: HTMLVideoElement, isCurrent: () => boolean): void {
    this.onSourceChange();
    if (this.disposed) return;
    this.hls = hls;
    this.video = video;
    this.current = isCurrent;
  }

  enable(file: File, origin90k: number): void {
    if (this.disposed) return;
    if (!Number.isSafeInteger(origin90k) || origin90k < 0 ||
        origin90k >= 2 ** 33 || !this.hls || !this.current?.() ||
        !file.name.toLowerCase().endsWith('.wasm')) {
      this.status('无法启用：需 HLS.js 播放、有效 WASM 和已核对的 90kHz 时间基准', false);
      return;
    }
    this.stop(false);
    this.file = file;
    this.origin90k = origin90k;
    this.authorized = true;
    this.status('实验音频已授权，等待播放与 WASM 校验', true);
    void this.start();
  }

  disable(): void {
    this.stop(false);
    if (!this.disposed) this.status('原生音频（实验通道关闭）', false);
  }

  onInterruption(): void {
    if (!this.authorized) return;
    this.stop(true);
    this.status('实验音频暂停，原生音频已恢复', true);
  }

  onResume(): void {
    if (this.authorized) void this.start();
  }

  onSourceChange(): void {
    this.stop(false);
    this.hls = null;
    this.video = null;
    this.current = null;
    if (!this.disposed) this.status('原生音频（切源后需重新授权）', false);
  }

  dispose(): void {
    this.disposed = true;
    this.onSourceChange();
  }

  private stop(keepAuthorization: boolean): void {
    this.attempt++;
    this.loading = false;
    const cleanup = this.cleanup;
    this.cleanup = null;
    // Stop scheduled PCM and unmute native audio before closing the context.
    try { cleanup?.(); } catch { /* native fallback is best effort */ }
    const context = this.context;
    this.context = null;
    if (context) void context.close().catch(() => {});
    if (!keepAuthorization) this.authorized = false;
  }

  private async start(): Promise<void> {
    const hls = this.hls;
    const video = this.video;
    const file = this.file;
    const current = this.current;
    if (!this.authorized || !hls || !video || !file || !current?.() ||
        video.paused || video.muted || this.loading || this.cleanup || this.disposed) return;
    const attempt = ++this.attempt;
    this.loading = true;
    let context: AudioContext | null = null;
    try {
      if (typeof AudioContext === 'undefined') throw new Error('Web Audio unavailable');
      context = new AudioContext();
      this.context = context;
      // Called synchronously from the opt-in click where possible. Browser
      // autoplay rules may still reject resumes from a later media event.
      await context.resume();
      const abi = await loadUserOpenJocWasm(file);
      if (attempt !== this.attempt || this.disposed || !this.authorized ||
          this.hls !== hls || this.video !== video || !current() ||
          video.paused || video.muted || context.state !== 'running') {
        // Cancellation may happen between resume and WASM instantiation.
        // Never keep an orphaned Web Audio context after a rejected start.
        if (attempt === this.attempt) this.stop(true);
        return;
      }
      this.cleanup = bindExperimentalHlsAudio({
        hls, video, abi, context, origin90k: this.origin90k,
        isCurrent: () => this.authorized && this.hls === hls && current(),
        onFailure: () => {
          this.stop(false);
          if (!this.disposed) this.status('实验音频失败，已恢复原生播放', false);
        },
      });
      this.status('实验性 PCM 通道已连接（不代表 Atmos 设备输出）', true);
    } catch {
      if (attempt === this.attempt && !this.disposed) {
        this.stop(false);
        this.status('WASM 加载或音频初始化失败，已恢复原生播放', false);
      }
    } finally {
      if (attempt === this.attempt) this.loading = false;
      // A cancelled async load must never revive a previous playback session.
      if (context && this.context !== context) void context.close().catch(() => {});
    }
  }
}
