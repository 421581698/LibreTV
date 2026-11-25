export interface JocDecoderPacket {
  readonly bytes: Uint8Array;
  readonly presentationTime: number;
  readonly timescale: number;
  readonly discontinuity?: boolean;
  readonly preroll?: boolean;
}

export interface JocDecoderPcmFrame {
  readonly samples: Float32Array;
  readonly sampleFrames: number;
  readonly ptsSamples: number | null;
}

export interface JocDecoderStatus {
  readonly ready: boolean;
  readonly generation: number;
  readonly queuedFrames: number;
  readonly sampleRate: 48000;
  readonly channels: 2;
  readonly renderer: 'Stereo';
  readonly nativeDolbyDecoderUsed: false;
  readonly decodedProfile: string | null;
  readonly reconstructedObjectCount: number | null;
  readonly complexityIndex: number | null;
  readonly decodedAccessUnits: number;
}

type WorkerReply =
  | { type: 'ready'; generation: number; decoder: 'OpenJOC'; renderer: 'Stereo'; sampleRate: 48000; channels: 2; nativeDolbyDecoderUsed: false }
  | { type: 'pcm'; generation: number; samples: ArrayBuffer; sampleFrames: number; ptsSamples: number | null; sampleRate: 48000; channels: 2 }
  | { type: 'decoded'; generation: number; profile: string | null; objectCount: number | null; complexityIndex: number | null; decodedAccessUnits: number }
  | { type: 'need-input' | 'flushed' | 'reset' | 'disposed'; generation: number }
  | { type: 'error'; generation: number; message: string };

const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_QUEUED_FRAMES = 48000;

export class JocSoftwareDecoderClient {
  private readonly worker: Worker;
  private readonly context: AudioContext;
  private node: AudioWorkletNode | null = null;
  private generation = 1;
  private ready = false;
  private queuedFrames = 0;
  private decodedProfile: string | null = null;
  private reconstructedObjectCount: number | null = null;
  private complexityIndex: number | null = null;
  private decodedAccessUnits = 0;
  private inFlight = false;
  private disposed = false;
  private activeVideo: HTMLVideoElement | null = null;
  private previousMuted = false;
  private ownsMediaMute = false;
  private clockRaf = 0;
  private readonly outputEnabled: boolean;
  private readonly listeners = new Set<(status: JocDecoderStatus) => void>();
  private readonly pcmListeners = new Set<(frame: JocDecoderPcmFrame) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly pending = new Map<string, Array<{ resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>>();

  private constructor(context: AudioContext, worker: Worker, outputEnabled: boolean) {
    this.context = context;
    this.outputEnabled = outputEnabled;
    this.worker = worker;
    this.worker.addEventListener('message', this.onWorkerMessage);
    this.worker.addEventListener('error', this.onWorkerError);
  }

  static async create(options: { wasmUrl?: string; audioContext?: AudioContext; outputEnabled?: boolean } = {}): Promise<JocSoftwareDecoderClient> {
    const context = options.audioContext ?? new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
    if (context.sampleRate !== 48000) {
      if (!options.audioContext) await context.close();
      throw new Error(`OpenJOC requires a 48 kHz AudioContext; browser selected ${context.sampleRate} Hz.`);
    }
    const worker = new Worker(new URL('./joc-decoder.worker.ts', import.meta.url), { type: 'module', name: 'libretv-openjoc' });
    const outputEnabled = options.outputEnabled ?? true;
    const client = new JocSoftwareDecoderClient(context, worker, outputEnabled);
    try {
      if (outputEnabled) {
        await context.audioWorklet.addModule('/audio/openjoc-pcm.worklet.js');
        client.node = new AudioWorkletNode(context, 'openjoc-pcm', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
      });
      client.node.port.addEventListener('message', client.onWorkletMessage);
        client.node.port.start();
        client.node.connect(context.destination);
      }
      await client.waitFor('ready', () => {
        worker.postMessage({ type: 'init', generation: client.generation, wasmUrl: options.wasmUrl });
      });
      return client;
    } catch (error) {
      client.dispose();
      throw error;
    }
  }

  get isOutputActive(): boolean {
    return this.ownsMediaMute && this.activeVideo !== null;
  }

  getStatus(): JocDecoderStatus {
    return {
      ready: this.ready,
      generation: this.generation,
      queuedFrames: this.queuedFrames,
      sampleRate: 48000,
      channels: 2,
      renderer: 'Stereo',
      nativeDolbyDecoderUsed: false,
      decodedProfile: this.decodedProfile,
      reconstructedObjectCount: this.reconstructedObjectCount,
      complexityIndex: this.complexityIndex,
      decodedAccessUnits: this.decodedAccessUnits,
    };
  }

  onStatus(listener: (status: JocDecoderStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  onPcm(listener: (frame: JocDecoderPcmFrame) => void): () => void {
    this.pcmListeners.add(listener);
    return () => this.pcmListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /** Must be called from a user gesture. This never mutes or replaces the media element audio. */
  async resumeFromUserGesture(): Promise<void> {
    this.assertActive();
    await this.context.resume();
    if (this.context.state !== 'running') throw new Error('AudioContext did not enter the running state.');
  }

  /**
   * Feeds one complete E-AC-3 CMAF sample. The caller must preserve sample order,
   * reset on discontinuities and keep PTS in the CMAF track timescale.
   * Returns false when bounded PCM backpressure requires the caller to wait.
   */
  async pushPacket(packet: JocDecoderPacket): Promise<boolean> {
    this.assertActive();
    if (!this.ready) throw new Error('OpenJOC decoder is not ready.');
    if (this.inFlight) return false;
    if (this.queuedFrames >= MAX_QUEUED_FRAMES / 2) {
      await this.waitFor('capacity', () => {});
      if (this.queuedFrames >= MAX_QUEUED_FRAMES / 2) return false;
    }
    if (packet.bytes.byteLength === 0 || packet.bytes.byteLength > MAX_INPUT_BYTES) {
      throw new Error('E-AC-3 sample is empty or exceeds the 1 MiB input bound.');
    }
    if (!Number.isFinite(packet.presentationTime) || !Number.isFinite(packet.timescale) || packet.timescale <= 0) {
      throw new Error('E-AC-3 sample timestamp is invalid.');
    }
    this.inFlight = true;
    try {
      await this.waitFor('need-input', () => {
        const bytes = packet.bytes.slice();
        this.worker.postMessage({
          type: 'packet',
          generation: this.generation,
          bytes: bytes.buffer,
          pts: packet.presentationTime,
          timescale: packet.timescale,
          discontinuity: packet.discontinuity,
          preroll: packet.preroll,
        }, [bytes.buffer]);
      });
      return true;
    } finally {
      this.inFlight = false;
    }
  }

  async flush(): Promise<void> {
    this.assertActive();
    await this.waitFor('flushed', () => this.worker.postMessage({ type: 'flush', generation: this.generation }));
  }

  async reset(): Promise<void> {
    this.assertActive();
    this.generation += 1;
    this.ready = false;
    this.queuedFrames = 0;
    this.node?.port.postMessage({ type: 'clear' });
    this.decodedProfile = null;
    this.reconstructedObjectCount = null;
    this.complexityIndex = null;
    this.decodedAccessUnits = 0;
    await this.waitFor('reset', () => this.worker.postMessage({ type: 'reset', generation: this.generation }));
    this.ready = true;
    this.emitStatus();
  }

  /**
   * Supplies the media presentation clock in the same 48 kHz timeline as the
   * CMAF sample PTS. The caller owns timeline mapping; wall-clock currentTime
   * must not be mixed with raw media PTS without an explicit offset mapping.
   */
  setMediaClock(ptsSamples: number): void {
    this.assertActive();
    if (!Number.isFinite(ptsSamples)) throw new Error('Media clock must be a finite 48 kHz sample timestamp.');
    this.node?.port.postMessage({ type: 'clock', ptsSamples });
  }

  /**
   * Atomically switches from native media audio only after decoded PCM has
   * reached the worklet and the first timestamp-aligned output quantum played.
   * Call only from a user gesture while the video is already playing.
   */
  async activateOutput(video: HTMLVideoElement, minimumPrerollMs = 128): Promise<boolean> {
    this.assertActive();
    if (!this.outputEnabled || !this.node || !this.ready || !this.decodedProfile || this.decodedAccessUnits <= 0 || video.paused || video.ended) return false;
    const requiredFrames = Math.ceil(48000 * Math.max(128, minimumPrerollMs) / 1000);
    if (this.queuedFrames < requiredFrames) return false;
    await this.resumeFromUserGesture();
    if (this.queuedFrames < requiredFrames || video.paused || video.ended) return false;

    this.activeVideo = video;
    this.previousMuted = video.muted;
    const updateClock = () => {
      if (this.disposed || this.activeVideo !== video) return;
      this.setMediaClock(video.currentTime * 48000);
      this.clockRaf = requestAnimationFrame(updateClock);
    };
    updateClock();
    this.ownsMediaMute = false;
    try {
      await this.waitFor('output-started', () => this.node?.port.postMessage({ type: 'start' }));
      if (this.disposed || video.paused || video.ended || this.context.state !== 'running') {
        this.fallbackToMediaAudio();
        return false;
      }
      // The software route has rendered timestamp-aligned audio; only now mute
      // the original media element. Any subsequent worklet fault restores it.
      video.muted = true;
      this.ownsMediaMute = true;
      return true;
    } catch {
      this.fallbackToMediaAudio();
      return false;
    }
  }

  pauseOutput(): void {
    this.node?.port.postMessage({ type: 'stop' });
  }

  resumeOutput(): void {
    if (this.activeVideo && !this.activeVideo.paused && !this.activeVideo.ended) {
      this.node?.port.postMessage({ type: 'start' });
    }
  }

  disconnectOutput(): void {
    this.fallbackToMediaAudio();
  }

  fallbackToMediaAudio(): void {
    this.node?.port.postMessage({ type: 'stop' });
    if (this.clockRaf) cancelAnimationFrame(this.clockRaf);
    this.clockRaf = 0;
    if (this.activeVideo && this.ownsMediaMute) this.activeVideo.muted = this.previousMuted;
    this.activeVideo = null;
    this.ownsMediaMute = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.fallbackToMediaAudio();
    this.disposed = true;
    const oldGeneration = this.generation;
    this.generation += 1;
    for (const entries of this.pending.values()) entries.forEach(entry => entry.reject(new Error('OpenJOC decoder client was disposed.')));
    this.pending.clear();
    this.worker.postMessage({ type: 'dispose', generation: oldGeneration });
    this.worker.removeEventListener('message', this.onWorkerMessage);
    this.worker.removeEventListener('error', this.onWorkerError);
    this.worker.terminate();
    if (this.node) {
      this.node.port.removeEventListener('message', this.onWorkletMessage);
      this.node.port.close();
      this.node.disconnect();
      this.node = null;
    }
    this.listeners.clear();
    this.pcmListeners.clear();
    this.errorListeners.clear();
    this.pending.clear();
    void this.context.close();
  }

  private waitFor(type: string, send: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const entry = {
        resolve: () => { clearTimeout(entry.timer); resolve(); },
        reject: (error: Error) => { clearTimeout(entry.timer); reject(error); },
        timer: setTimeout(() => {
          const entries = this.pending.get(type) ?? [];
          this.pending.set(type, entries.filter(candidate => candidate !== entry));
          reject(new Error(`Timed out waiting for OpenJOC ${type}.`));
        }, 10000),
      };
      const entries = this.pending.get(type) ?? [];
      entries.push(entry);
      this.pending.set(type, entries);
      send();
    });
  }

  private settle(type: string): void {
    const entries = this.pending.get(type);
    if (!entries) return;
    this.pending.delete(type);
    entries.forEach(entry => entry.resolve());
  }

  private onWorkerMessage = (event: MessageEvent<WorkerReply>): void => {
    const message = event.data;
    if (!message || message.generation !== this.generation || this.disposed) return;
    if (message.type === 'ready') {
      this.ready = true;
      this.emitStatus();
      this.settle('ready');
    } else if (message.type === 'decoded') {
      this.decodedProfile = message.profile;
      this.reconstructedObjectCount = message.objectCount;
      this.complexityIndex = message.complexityIndex;
      this.decodedAccessUnits = message.decodedAccessUnits;
      this.emitStatus();
    } else if (message.type === 'pcm') {
      if (!this.outputEnabled) {
        for (const listener of this.pcmListeners) listener({ samples, sampleFrames: message.sampleFrames, ptsSamples: message.ptsSamples });
        return;
      }
      if (!this.node || message.sampleRate !== 48000 || message.channels !== 2) {
        this.fail(new Error('OpenJOC PCM format is unsupported.'));
        return;
      }
      const samples = new Float32Array(message.samples);
      if (samples.length !== message.sampleFrames * 2 || samples.length === 0 ||
          samples.some(sample => !Number.isFinite(sample))) {
        this.fail(new Error('OpenJOC PCM frame length is invalid.'));
        return;
      }
      this.queuedFrames = Math.min(MAX_QUEUED_FRAMES, this.queuedFrames + message.sampleFrames);
      const observerSamples = samples.slice();
      this.node.port.postMessage({ type: 'pcm', samples, sampleRate: 48000, channels: 2, ptsSamples: message.ptsSamples }, [samples.buffer]);
      for (const listener of this.pcmListeners) listener({ samples: observerSamples, sampleFrames: message.sampleFrames, ptsSamples: message.ptsSamples });
      this.emitStatus();
    } else if (message.type === 'need-input') {
      this.settle('need-input');
    } else if (message.type === 'flushed') {
      this.settle('flushed');
    } else if (message.type === 'reset') {
      this.settle('reset');
    } else if (message.type === 'error') {
      this.fail(new Error(message.message));
    }
  };

  private onWorkletMessage = (event: MessageEvent<{ type?: string; frames?: number }>): void => {
    if (event.data?.type === 'started') {
      this.settle('output-started');
      return;
    }
    if (event.data?.type === 'underrun' || event.data?.type === 'overflow') {
      this.fail(new Error(event.data.type === 'overflow' ? 'OpenJOC PCM queue overflowed; software output was stopped.' : 'OpenJOC PCM underrun; native media audio was restored.'));
      this.disconnectOutput();
      return;
    }
    if (event.data?.type !== 'queued' || typeof event.data.frames !== 'number') return;
    this.queuedFrames = Math.max(0, Math.min(MAX_QUEUED_FRAMES, event.data.frames));
    this.emitStatus();
    if (this.queuedFrames < MAX_QUEUED_FRAMES / 2) this.settle('capacity');
  };

  private onWorkerError = (event: ErrorEvent): void => this.fail(new Error(event.message || 'OpenJOC Worker failed.'));

  private fail(error: Error): void {
    this.ready = false;
    this.fallbackToMediaAudio();
    for (const listener of this.errorListeners) listener(error);
    this.emitStatus();
    for (const entries of this.pending.values()) entries.forEach(entry => entry.reject(error));
    this.pending.clear();
  }

  private emitStatus(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) listener(status);
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('OpenJOC decoder client has been disposed.');
  }
}
