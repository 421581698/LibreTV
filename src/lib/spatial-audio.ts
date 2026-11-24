/**
 * LibreTV Cinema Engine — browser spatial-audio foundation.
 *
 * This module deliberately distinguishes real decoded 5.1 channel input from
 * ordinary stereo. Stereo virtualization is a headphone presentation effect,
 * not Dolby Atmos decoding or a reconstruction of missing surround channels.
 *
 * Create/enable the engine only from an explicit user gesture. Safari may keep
 * AudioContext suspended until that gesture calls resume().
 */

export type SpatialAudioMode = 'off' | 'headphone-stereo' | 'headphone-surround';
export type SpatialAudioRoute = 'bypass' | 'stereo-virtualization' | 'surround-5.1-binaural';

export interface SpatialAudioCapabilities {
  webAudio: boolean;
  mediaElementSource: boolean;
  hrtfPanner: boolean;
  outputMaxChannels: number | null;
  outputLatencyMs: number | null;
}

export interface SpatialAudioPlan {
  route: SpatialAudioRoute;
  inputChannels: number;
  label: string;
  reason: string;
}

export interface SpatialAudioAttachOptions {
  /** Verified audio-track channel count from manifest/media inspection. */
  inputChannels: number;
  /** Explicitly verified speaker layout; six channels alone is not sufficient. */
  inputLayout?: '5.1' | 'unknown';
}

const speakerPositions = {
  left: [-0.5, 0, -0.866],
  right: [0.5, 0, -0.866],
  center: [0, 0, -1],
  surroundLeft: [-0.94, 0, 0.342],
  surroundRight: [0.94, 0, 0.342],
} as const;

export function inspectSpatialAudioCapabilities(context?: AudioContext | null): SpatialAudioCapabilities {
  if (!context) {
    return {
      webAudio: false,
      mediaElementSource: false,
      hrtfPanner: false,
      outputMaxChannels: null,
      outputLatencyMs: null,
    };
  }

  let hrtfPanner = false;
  try {
    const panner = context.createPanner();
    hrtfPanner = 'panningModel' in panner && typeof panner.setPosition === 'function';
    panner.disconnect();
  } catch {
    hrtfPanner = false;
  }

  return {
    webAudio: context.state !== 'closed',
    mediaElementSource: typeof context.createMediaElementSource === 'function',
    hrtfPanner,
    outputMaxChannels: Number.isFinite(context.destination.maxChannelCount)
      ? context.destination.maxChannelCount
      : null,
    outputLatencyMs: Number.isFinite(context.outputLatency)
      ? Math.round(context.outputLatency * 1000)
      : null,
  };
}

/**
 * Plan only from verified audio-track metadata supplied by the media inspector.
 * Unknown/unsupported layouts are never advertised as surround.
 */
export function planSpatialAudio(
  mode: SpatialAudioMode,
  inputChannels: number,
  hrtfAvailable: boolean,
  inputLayout: '5.1' | 'unknown' = 'unknown',
): SpatialAudioPlan {
  if (mode === 'off') {
    return { route: 'bypass', inputChannels, label: '原始音轨', reason: '空间处理已关闭' };
  }
  if (!hrtfAvailable) {
    return { route: 'bypass', inputChannels, label: '原始音轨', reason: '当前浏览器没有可用的 HRTF 空间声像器' };
  }
  if (inputChannels === 6 && mode === 'headphone-surround' && inputLayout === '5.1') {
    return {
      route: 'surround-5.1-binaural',
      inputChannels,
      label: '5.1 耳机双耳渲染',
      reason: '检测到六声道输入，将五个全频扬声器位置映射到 HRTF；LFE 保留为居中低频',
    };
  }
  if (inputChannels === 2) {
    return {
      route: 'stereo-virtualization',
      inputChannels,
      label: '立体声耳机空间化',
      reason: mode === 'headphone-surround'
        ? '输入只有双声道，使用左右虚拟扬声器；不会伪称为真实 5.1 或 Atmos'
        : '将左右声道作为虚拟扬声器进行 HRTF 耳机呈现',
    };
  }
  return {
    route: 'bypass',
    inputChannels,
    label: '原始音轨',
    reason: inputChannels === 6 && mode === 'headphone-surround'
      ? '已检测到六声道，但未验证扬声器顺序；为避免声道错位，保持原始音轨'
      : inputChannels > 0
        ? `当前输入为 ${inputChannels} 声道，暂不支持此布局的空间映射`
      : '尚未获得可靠的输入声道数，保持原始播放',
  };
}

function setPannerPosition(panner: PannerNode, position: readonly [number, number, number]): void {
  const [x, y, z] = position;
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 1;
  panner.maxDistance = 1;
  panner.rolloffFactor = 0;

  if (panner.positionX && panner.positionY && panner.positionZ) {
    panner.positionX.setValueAtTime(x, panner.context.currentTime);
    panner.positionY.setValueAtTime(y, panner.context.currentTime);
    panner.positionZ.setValueAtTime(z, panner.context.currentTime);
  } else {
    panner.setPosition(x, y, z);
  }
}

const attachedEngines = new WeakMap<HTMLMediaElement, SpatialAudioEngine>();
// createMediaElementSource is a one-shot binding for the lifetime of the element,
// even after the node is disconnected and its AudioContext is closed.
const attachedMediaElements = new WeakSet<HTMLMediaElement>();

/**
 * Web Audio will output silence for a non-CORS cross-origin media element.
 * LibreTV intentionally leaves some direct MP4/native-HLS URLs without a
 * crossorigin attribute so they remain playable; do not attach Web Audio to
 * those URLs and accidentally mute a working stream.
 */
export function isAudioSourceUrlOriginSafe(
  sourceUrl: string,
  pageOrigin: string,
  crossOrigin: string | null = null,
): boolean {
  if (!sourceUrl || !pageOrigin) return false;
  try {
    const url = new URL(sourceUrl, pageOrigin);
    if (url.protocol === 'data:') return true;
    if (url.protocol === 'blob:') return url.origin === pageOrigin;
    if (url.origin === pageOrigin) return true;
    return crossOrigin === 'anonymous' || crossOrigin === 'use-credentials';
  } catch {
    return false;
  }
}

export function isMediaElementAudioOriginSafe(media: HTMLMediaElement, pageOrigin: string): boolean {
  return isAudioSourceUrlOriginSafe(media.currentSrc || media.src, pageOrigin, media.crossOrigin);
}

/**
 * One engine per media element: createMediaElementSource() must not be called
 * repeatedly for the same element. attach() should be called from a click/tap.
 *
 * Important lifecycle constraint: after attach(), every future src assigned to
 * this same media element must also be CORS-safe. Before switching to a
 * non-CORS direct URL, PlayerShell must replace the media element; disconnecting
 * this graph cannot restore the browser's native audio path for the old element.
 */
export class SpatialAudioEngine {
  private readonly context: AudioContext;
  private readonly source: MediaElementAudioSourceNode;
  private readonly output: GainNode;
  private readonly capabilities: SpatialAudioCapabilities;
  private readonly splitters: ChannelSplitterNode[] = [];
  private readonly panners: PannerNode[] = [];
  private lfeGain?: GainNode;
  private mode: SpatialAudioMode = 'off';
  private route: SpatialAudioRoute = 'bypass';
  private inputChannels: number;
  private inputLayout: '5.1' | 'unknown';
  private destroyed = false;

  private constructor(
    readonly media: HTMLMediaElement,
    context: AudioContext,
    inputChannels: number,
    inputLayout: '5.1' | 'unknown',
  ) {
    this.context = context;
    this.capabilities = inspectSpatialAudioCapabilities(context);
    this.inputChannels = inputChannels;
    this.inputLayout = inputLayout;
    this.source = context.createMediaElementSource(media);
    attachedMediaElements.add(media);
    this.output = context.createGain();
    this.output.gain.value = 1;
    this.source.connect(this.output);
    this.output.connect(context.destination);
  }

  static attach(
    media: HTMLMediaElement,
    options: SpatialAudioAttachOptions,
    contextFactory: () => AudioContext = () => new AudioContext(),
  ): SpatialAudioEngine {
    const existing = attachedEngines.get(media);
    if (existing) {
      if (existing.isDestroyed) throw new Error('此视频元素的 Web Audio 生命周期已结束，请使用新的视频元素');
      return existing;
    }
    if (attachedMediaElements.has(media)) {
      throw new Error('此视频元素已绑定过 Web Audio，不能再次创建 MediaElementAudioSourceNode');
    }
    const pageOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    if (!pageOrigin || !isMediaElementAudioOriginSafe(media, pageOrigin)) {
      throw new Error('当前视频源未通过 CORS 安全检查，空间音频已保持关闭以避免静音');
    }
    if (options.inputChannels !== 2 && options.inputChannels !== 6) {
      throw new Error('当前音轨声道布局尚未得到支持，空间音频保持关闭');
    }
    const context = contextFactory();
    try {
      const engine = new SpatialAudioEngine(media, context, options.inputChannels, options.inputLayout ?? 'unknown');
      attachedEngines.set(media, engine);
      return engine;
    } catch (error) {
      if (context.state !== 'closed') void context.close().catch(() => undefined);
      throw error;
    }
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  get status(): { mode: SpatialAudioMode; route: SpatialAudioRoute; contextState: AudioContextState; inputChannels: number; inputLayout: '5.1' | 'unknown' } {
    return {
      mode: this.mode,
      route: this.route,
      contextState: this.context.state,
      inputChannels: this.inputChannels,
      inputLayout: this.inputLayout,
    };
  }

  async resumeFromUserGesture(): Promise<void> {
    if (this.destroyed) throw new Error('Spatial audio engine has been destroyed');
    if (this.context.state === 'suspended') await this.context.resume();
    if (this.context.state !== 'running') throw new Error('AudioContext is not running');
  }

  setMode(mode: SpatialAudioMode): SpatialAudioPlan {
    if (this.destroyed) throw new Error('Spatial audio engine has been destroyed');
    this.clearSpatialGraph();
    this.mode = mode;

    const plan = planSpatialAudio(mode, this.inputChannels, this.capabilities.hrtfPanner, this.inputLayout);
    this.route = plan.route;
    if (plan.route === 'bypass') {
      this.source.connect(this.output);
      return plan;
    }

    const channelCount = plan.route === 'surround-5.1-binaural' ? 6 : 2;
    const splitter = this.context.createChannelSplitter(channelCount);
    splitter.channelInterpretation = 'discrete';
    this.source.connect(splitter);
    this.splitters.push(splitter);

    const positions = plan.route === 'surround-5.1-binaural'
      ? [speakerPositions.left, speakerPositions.right, speakerPositions.center, null, speakerPositions.surroundLeft, speakerPositions.surroundRight] as const
      : [speakerPositions.left, speakerPositions.right] as const;

    positions.forEach((position, channel) => {
      if (!position) {
        const lfe = this.context.createGain();
        lfe.gain.value = 0.5;
        splitter.connect(lfe, channel);
        lfe.connect(this.output);
        this.lfeGain = lfe;
        return;
      }
      const panner = this.context.createPanner();
      setPannerPosition(panner, position);
      const channelGain = this.context.createGain();
      // Headroom for summing multiple HRTF-rendered speaker feeds.
      channelGain.gain.value = plan.route === 'surround-5.1-binaural' ? 0.45 : 0.7;
      splitter.connect(channelGain, channel);
      channelGain.connect(panner);
      panner.connect(this.output);
      this.panners.push(panner);
    });

    return plan;
  }

  /**
   * Update verified track metadata when PlayerShell switches media sources
   * while retaining the same HTMLVideoElement.
   */
  updateInputChannels(inputChannels: number, inputLayout: '5.1' | 'unknown' = 'unknown'): SpatialAudioPlan {
    if (this.destroyed) throw new Error('Spatial audio engine has been destroyed');
    if (!Number.isInteger(inputChannels) || inputChannels < 1 || inputChannels > 32) {
      this.inputChannels = 0;
    } else {
      this.inputChannels = inputChannels;
    }
    this.inputLayout = inputLayout;
    return this.setMode(this.mode);
  }

  /**
   * Final cleanup for a media element that has already been removed from the
   * player DOM. Do not call this when the same element may be reused: browsers
   * bind MediaElementAudioSourceNode to its original element for its lifetime.
   */
  async destroyAfterMediaElementRemoval(): Promise<void> {
    if (this.destroyed) return;
    this.disable();
    this.destroyed = true;
    try { this.source.disconnect(); } catch { /* already disconnected */ }
    try { this.output.disconnect(); } catch { /* already disconnected */ }
    if (this.context.state !== 'closed') await this.context.close();
  }

  setOutputGain(value: number): void {
    if (this.destroyed) return;
    if (!Number.isFinite(value)) return;
    this.output.gain.setTargetAtTime(
      Math.min(1, Math.max(0, value)),
      this.context.currentTime,
      0.015,
    );
  }

  /**
   * Disable spatial processing but keep the one-shot media source reusable.
   * Do not delete this engine from the WeakMap: createMediaElementSource() must
   * not be called a second time for the same media element.
   */
  disable(): void {
    if (this.destroyed) return;
    this.clearSpatialGraph();
    this.mode = 'off';
    this.route = 'bypass';
    this.source.connect(this.output);
  }

  private clearSpatialGraph(): void {
    for (const splitter of this.splitters) {
      try { splitter.disconnect(); } catch { /* already disconnected */ }
    }
    for (const panner of this.panners) {
      try { panner.disconnect(); } catch { /* already disconnected */ }
    }
    if (this.lfeGain) {
      try { this.lfeGain.disconnect(); } catch { /* already disconnected */ }
      this.lfeGain = undefined;
    }
    this.splitters.length = 0;
    this.panners.length = 0;
    try { this.source.disconnect(); } catch { /* already disconnected */ }
    try { this.output.disconnect(); } catch { /* already disconnected */ }
    this.output.connect(this.context.destination);
  }
}
