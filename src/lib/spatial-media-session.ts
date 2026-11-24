import { SpatialAudioEngine } from './spatial-audio';

export type SpatialMediaSessionState =
  | 'prepared'
  | 'activating'
  | 'active'
  | 'fallback'
  | 'disposed';

export type SpatialMediaSourceKind = 'mp4' | 'webm' | 'hls' | 'unsupported';

export interface SpatialEngineHandle {
  resumeFromUserGesture(): Promise<void>;
  setMode(mode: 'headphone-stereo'): { route: string; label: string; reason: string };
  destroyAfterMediaElementRemoval(): Promise<void>;
  subscribeStateChange?(listener: (state: string) => void): () => void;
  updateInputChannels?(inputChannels: number, inputLayout?: '5.1' | 'unknown'): unknown;
}

export interface SpatialHlsController {
  start(): Promise<void>;
  destroy(): void;
  readonly audioTracks: readonly unknown[];
  audioTrack: number;
}

export interface SpatialMediaSessionOptions {
  nativeVideo: HTMLVideoElement;
  host: HTMLElement;
  sourceUrl: string;
  sourceKind: SpatialMediaSourceKind;
  verifyCors?: (url: string) => Promise<boolean>;
  createMediaElement?: () => HTMLVideoElement;
  createEngine?: (media: HTMLVideoElement, declaredInputChannels: number) => SpatialEngineHandle;
  createHlsController?: (media: HTMLVideoElement, sourceUrl: string, onFatalError: (reason: string) => void) => SpatialHlsController;
  onRestoreAudioTrack?: (trackIndex: number) => void;
  onStateChange?: (snapshot: SpatialMediaSessionSnapshot) => void;
}

export interface SpatialMediaSessionSnapshot {
  state: SpatialMediaSessionState;
  route: string | null;
  reason: string | null;
}

export async function verifySpatialMediaCors(sourceUrl: string, timeoutMs = 8_000): Promise<boolean> {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return false;
  let url: URL;
  try {
    url = new URL(sourceUrl, window.location.href);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.origin === window.location.origin) return true;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const response = await fetch(url.href, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
      signal: controller.signal,
    });
    const readable = response.type !== 'opaque' && response.ok;
    await response.body?.cancel().catch(() => undefined);
    return readable;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

/**
 * A spatial session owns a second media element. The ArtPlayer element is never
 * passed to createMediaElementSource and remains the native fallback surface.
 *
 * Direct media and HLS use a separately-owned media element. HLS is delegated
 * to an injected independent controller so the ArtPlayer/HLS instance and
 * Safari's existing native-HLS element are never captured or repurposed.
 */
export class SpatialMediaSession {
  private state: SpatialMediaSessionState = 'prepared';
  private engine: SpatialEngineHandle | null = null;
  private route: string | null = null;
  private reason: string | null = null;
  private syncing = false;
  private restoreMuted: boolean;
  private readonly listeners: Array<() => void> = [];
  private fallbackPromise: Promise<void> | null = null;
  private removeEngineStateListener: (() => void) | null = null;
  private hlsController: SpatialHlsController | null = null;

  private constructor(
    readonly nativeVideo: HTMLVideoElement,
    readonly media: HTMLVideoElement,
    private readonly createEngine: (media: HTMLVideoElement, declaredInputChannels: number) => SpatialEngineHandle,
    private readonly onStateChange?: (snapshot: SpatialMediaSessionSnapshot) => void,
    private readonly onRestoreAudioTrack?: (trackIndex: number) => void,
    hlsController: SpatialHlsController | null = null,
  ) {
    this.restoreMuted = nativeVideo.muted;
    this.hlsController = hlsController;
    this.bindNativeSynchronization();
    this.media.addEventListener('error', this.handleSpatialError);
    this.listeners.push(() => this.media.removeEventListener('error', this.handleSpatialError));
  }

  static async prepare(options: SpatialMediaSessionOptions): Promise<SpatialMediaSession> {
    const { nativeVideo, host, sourceUrl, sourceKind } = options;
    if (sourceKind !== 'mp4' && sourceKind !== 'webm' && sourceKind !== 'hls') {
      throw new Error('当前媒体格式不支持独立空间会话');
    }
    if (sourceKind === 'hls' && !options.createHlsController) {
      throw new Error('当前环境没有独立 HLS 会话适配器；原生 HLS 保持原样');
    }
    if (!sourceUrl || !host || !nativeVideo) throw new Error('缺少媒体会话所需的播放器元素或媒体地址');
    if (nativeVideo.error) throw new Error('原生播放器当前处于媒体错误状态');
    const corsVerified = await (options.verifyCors ?? verifySpatialMediaCors)(sourceUrl);
    if (!corsVerified) throw new Error('媒体源未通过 CORS 可读性验证，已保留原生播放');

    const media = options.createMediaElement?.() ?? document.createElement('video');
    // CORS mode must be set before src. This element is never reused for another URL.
    media.crossOrigin = 'anonymous';
    media.preload = 'auto';
    media.playsInline = true;
    media.controls = false;
    media.muted = false;
    media.volume = nativeVideo.volume;
    media.playbackRate = nativeVideo.playbackRate;
    media.setAttribute('aria-hidden', 'true');
    Object.assign(media.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
      left: '-10000px',
      top: '0',
    });
    host.appendChild(media);
    const createEngine = options.createEngine ?? ((element: HTMLVideoElement, declaredInputChannels: number) =>
      SpatialAudioEngine.attach(element, { inputChannels: declaredInputChannels }));
    let hlsController: SpatialHlsController | null = null;
    let session: SpatialMediaSession | null = null;
    try {
      if (sourceKind === 'hls') {
        hlsController = options.createHlsController!(media, sourceUrl, (reason) => {
          if (session) void session.fallback(reason);
        });
        await hlsController.start();
      } else {
        media.src = sourceUrl;
        media.load();
      }
      session = new SpatialMediaSession(nativeVideo, media, createEngine, options.onStateChange, options.onRestoreAudioTrack, hlsController);
      return session;
    } catch (error) {
      hlsController?.destroy();
      media.removeAttribute('src');
      media.load();
      media.remove();
      throw error;
    }
  }

  get snapshot(): SpatialMediaSessionSnapshot {
    return { state: this.state, route: this.route, reason: this.reason };
  }

  get audioTracks(): readonly unknown[] {
    return this.hlsController?.audioTracks ?? [];
  }

  private getDeclaredInputChannels(): number {
    const tracks = this.hlsController?.audioTracks;
    const selected = this.hlsController?.audioTrack ?? -1;
    if (!tracks || selected < 0 || selected >= tracks.length) return 0;
    const channels = (tracks[selected] as { channels?: string } | undefined)?.channels;
    const match = channels ? /^(\d+)/.exec(channels.trim()) : null;
    const count = match ? Number(match[1]) : 0;
    // Only declared stereo is eligible for stereo HRTF virtualization.
    // Six channels remain bypassed unless a verified 5.1 speaker layout exists.
    return count === 2 ? 2 : count === 6 ? 6 : 0;
  }

  selectAudioTrack(trackIndex: number): boolean {
    const controller = this.hlsController;
    if (!controller || !Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= controller.audioTracks.length) {
      return false;
    }
    controller.audioTrack = trackIndex;
    if (this.state === 'active') {
      this.engine?.updateInputChannels?.(this.getDeclaredInputChannels(), 'unknown');
    }
    return true;
  }

  /**
   * Must be invoked directly by a user click/tap. Both AudioContext.resume()
   * and media.play() are initiated before the first await to preserve activation.
   */
  async activateFromUserGesture(): Promise<SpatialMediaSessionSnapshot> {
    if (this.state !== 'prepared') throw new Error('空间媒体会话当前不可启动');
    this.state = 'activating';
    this.notifyState();
    try {
      this.engine = this.createEngine(this.media, this.getDeclaredInputChannels());
      this.removeEngineStateListener = this.engine.subscribeStateChange?.((state) => {
        if (this.state === 'active' && state !== 'running') {
          void this.fallback('AudioContext 被系统中断或关闭，已恢复原生播放');
        }
      }) ?? null;
      const resume = this.engine.resumeFromUserGesture();
      try { this.media.currentTime = this.nativeVideo.currentTime; } catch { /* metadata may not be ready yet */ }
      this.media.playbackRate = this.nativeVideo.playbackRate;
      this.media.volume = this.nativeVideo.volume;
      this.media.muted = this.nativeVideo.muted;
      const play = this.nativeVideo.paused ? Promise.resolve() : this.media.play();

      // Keep the native element alive and synchronized, but route audible output
      // through the independently-owned element while the session is active.
      this.nativeVideo.muted = true;
      await Promise.all([resume, play]);
      if (this.state !== 'activating') throw new Error('空间会话已在启动期间回退');
      const plan = this.engine.setMode('headphone-stereo');
      this.route = plan.route;
      this.reason = plan.reason;
      this.state = 'active';
      this.notifyState();
      return this.snapshot;
    } catch (error) {
      await this.fallback(error instanceof Error ? error.message : '空间会话启动失败');
      throw error;
    }
  }

  async fallback(reason: string): Promise<void> {
    if (this.fallbackPromise) return this.fallbackPromise;
    this.fallbackPromise = this.teardown(reason, true);
    return this.fallbackPromise;
  }

  async dispose(): Promise<void> {
    if (this.state === 'disposed') return;
    await this.teardown('用户关闭空间会话', false);
  }

  private notifyState(): void {
    this.onStateChange?.(this.snapshot);
  }

  private readonly handleSpatialError = () => {
    void this.fallback('独立媒体元素发生播放错误，已回退原生播放');
  };

  private bindNativeSynchronization(): void {
    const bind = (target: EventTarget, event: string, listener: EventListener) => {
      target.addEventListener(event, listener);
      this.listeners.push(() => target.removeEventListener(event, listener));
    };
    bind(this.nativeVideo, 'play', () => {
      if (this.state === 'active' && this.media.paused) {
        void this.media.play().catch(() => this.fallback('空间媒体恢复播放失败'));
      }
    });
    bind(this.nativeVideo, 'pause', () => {
      if (this.state === 'active' && !this.media.paused) this.media.pause();
    });
    bind(this.nativeVideo, 'ended', () => {
      if (this.state === 'active') this.media.pause();
    });
    const syncNativeToSpatial = () => {
      if (this.state !== 'active' || this.syncing) return;
      this.syncing = true;
      try {
        if (Math.abs(this.media.currentTime - this.nativeVideo.currentTime) > 0.35) {
          this.media.currentTime = this.nativeVideo.currentTime;
        }
        this.media.playbackRate = this.nativeVideo.playbackRate;
        this.media.volume = this.nativeVideo.volume;
      } catch {
        void this.fallback('播放器状态无法同步');
      } finally {
        this.syncing = false;
      }
    };
    bind(this.nativeVideo, 'timeupdate', syncNativeToSpatial);
    bind(this.nativeVideo, 'seeked', syncNativeToSpatial);
    bind(this.nativeVideo, 'ratechange', syncNativeToSpatial);
    bind(this.nativeVideo, 'volumechange', () => {
      if (this.state !== 'active' || this.syncing) return;
      this.media.volume = this.nativeVideo.volume;
      // ArtPlayer's native mute toggle cannot control the duplicate element
      // without unmuting the visual element. Exit the session on that action so
      // the original player regains its normal mute semantics.
      if (!this.nativeVideo.muted) {
        this.restoreMuted = false;
        void this.fallback('静音状态发生变化，已退出独立会话以恢复原生音量控制');
      }
    });
    bind(this.media, 'timeupdate', () => {
      if (this.state !== 'active' || this.syncing) return;
      this.syncing = true;
      try {
        if (Math.abs(this.nativeVideo.currentTime - this.media.currentTime) > 0.35) {
          this.nativeVideo.currentTime = this.media.currentTime;
        }
      } catch {
        void this.fallback('播放位置无法同步');
      } finally {
        this.syncing = false;
      }
    });
  }

  private async teardown(reason: string, isFallback: boolean): Promise<void> {
    if (this.state === 'disposed' || this.state === 'fallback') return;
    this.reason = reason;
    this.state = isFallback ? 'fallback' : 'disposed';
    this.notifyState();
    // The native video remains the canonical visual clock and is continuously
    // synchronized from the spatial element while active. Never copy a failed
    // or not-yet-ready spatial element's zero/stale time over the native clock.
    this.nativeVideo.muted = this.restoreMuted;
    const selectedAudioTrack = this.hlsController?.audioTrack ?? -1;
    if (selectedAudioTrack >= 0) this.onRestoreAudioTrack?.(selectedAudioTrack);
    this.removeEngineStateListener?.();
    this.removeEngineStateListener = null;
    this.media.pause();
    this.hlsController?.destroy();
    this.hlsController = null;
    this.listeners.splice(0).forEach((remove) => remove());
    this.media.removeAttribute('src');
    this.media.load();
    this.media.remove();
    const engine = this.engine;
    this.engine = null;
    if (engine) {
      try { await engine.destroyAfterMediaElementRemoval(); } catch { /* native playback is already restored */ }
    }
    this.route = null;
  }
}
