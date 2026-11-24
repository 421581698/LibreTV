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
}

export interface SpatialMediaSessionOptions {
  nativeVideo: HTMLVideoElement;
  host: HTMLElement;
  sourceUrl: string;
  sourceKind: SpatialMediaSourceKind;
  verifyCors?: (url: string) => Promise<boolean>;
  createMediaElement?: () => HTMLVideoElement;
  createEngine?: (media: HTMLVideoElement) => SpatialEngineHandle;
  onStateChange?: (snapshot: SpatialMediaSessionSnapshot) => void;
}

export interface SpatialMediaSessionSnapshot {
  state: SpatialMediaSessionState;
  route: string | null;
  reason: string | null;
}

export async function verifySpatialMediaCors(sourceUrl: string): Promise<boolean> {
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
    controller.abort();
  }
}

/**
 * A spatial session owns a second media element. The ArtPlayer element is never
 * passed to createMediaElementSource and remains the native fallback surface.
 *
 * The first P3 milestone intentionally supports direct MP4/WebM only. HLS,
 * including Safari native HLS, stays on the existing native/hls.js route until
 * an independently-owned HLS pipeline and its complete CORS lifecycle exist.
 */
export class SpatialMediaSession {
  private state: SpatialMediaSessionState = 'prepared';
  private engine: SpatialEngineHandle | null = null;
  private route: string | null = null;
  private reason: string | null = null;
  private syncing = false;
  private readonly originalMuted: boolean;
  private readonly listeners: Array<() => void> = [];
  private fallbackPromise: Promise<void> | null = null;

  private constructor(
    readonly nativeVideo: HTMLVideoElement,
    readonly media: HTMLVideoElement,
    private readonly createEngine: (media: HTMLVideoElement) => SpatialEngineHandle,
    private readonly onStateChange?: (snapshot: SpatialMediaSessionSnapshot) => void,
  ) {
    this.originalMuted = nativeVideo.muted;
    this.bindNativeSynchronization();
    this.media.addEventListener('error', this.handleSpatialError);
    this.listeners.push(() => this.media.removeEventListener('error', this.handleSpatialError));
  }

  static async prepare(options: SpatialMediaSessionOptions): Promise<SpatialMediaSession> {
    const { nativeVideo, host, sourceUrl, sourceKind } = options;
    if (sourceKind !== 'mp4' && sourceKind !== 'webm') {
      throw new Error(sourceKind === 'hls'
        ? 'HLS 暂不开放独立空间会话；Safari 原生 HLS 保持原样'
        : '当前媒体格式不支持独立空间会话');
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
    media.src = sourceUrl;
    host.appendChild(media);
    media.load();

    const createEngine = options.createEngine ?? ((element: HTMLVideoElement) =>
      SpatialAudioEngine.attach(element, { inputChannels: 0 }));
    return new SpatialMediaSession(nativeVideo, media, createEngine, options.onStateChange);
  }

  get snapshot(): SpatialMediaSessionSnapshot {
    return { state: this.state, route: this.route, reason: this.reason };
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
      this.engine = this.createEngine(this.media);
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
    if (Number.isFinite(this.media.currentTime) && this.media.currentTime >= 0) {
      try { this.nativeVideo.currentTime = this.media.currentTime; } catch { /* keep last native position */ }
    }
    this.nativeVideo.muted = this.originalMuted;
    this.media.pause();
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
