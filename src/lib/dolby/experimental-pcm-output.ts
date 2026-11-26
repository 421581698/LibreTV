import type { ExperimentalPcm } from './openjoc-experimental-decoder';
import { planExperimentalPcm } from './experimental-av-clock';

/** Isolated Web Audio prototype. Caller owns gesture, native mute/fallback and lifecycle.
 * Not connected to the player; not an Atmos-certified output path.
 */
export class ExperimentalPcmOutput {
  private sources = new Set<AudioBufferSourceNode>();
  private queuedUntil = 0;
  constructor(private readonly context: AudioContext, private readonly destination: AudioNode) {}
  enqueue(frame: ExperimentalPcm, mediaTime: number, playbackRate: number) {
    if (this.context.state !== 'running' || frame.ptsSamples === null) { this.reset(); return 'reset'; }
    // Validate untrusted decoder output before allocating Web Audio buffers.
    if (!(frame.pcm instanceof Float32Array) ||
        !Number.isSafeInteger(frame.samples) || frame.samples < 1 || frame.samples > 262144 ||
        !Number.isSafeInteger(frame.channels) || frame.channels < 1 || frame.channels > 32 ||
        !Number.isSafeInteger(frame.sampleRate) || frame.sampleRate < 8000 || frame.sampleRate > 192000 ||
        frame.samples * frame.channels !== frame.pcm.length ||
        !frame.pcm.every(Number.isFinite)) { this.reset(); return 'reset'; }
    if (this.sources.size >= 32) return 'wait';
    const decision = planExperimentalPcm({
      ptsSamples: frame.ptsSamples, sampleRate: frame.sampleRate, mediaTime,
      audioTime: this.context.currentTime, playbackRate, queuedUntil: this.queuedUntil,
    });
    if (decision.action === 'reset') this.reset();
    if (decision.action !== 'schedule') return decision.action;
    let source: AudioBufferSourceNode | undefined;
    try {
      const buffer = this.context.createBuffer(frame.channels, frame.samples, frame.sampleRate);
    for (let channel = 0; channel < frame.channels; channel++) {
      const output = buffer.getChannelData(channel);
      for (let i = 0; i < frame.samples; i++) output[i] = frame.pcm[i * frame.channels + channel];
    }
    source = this.context.createBufferSource();
    const node = source;
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
      node.connect(this.destination);
      node.onended = () => { this.sources.delete(node); try { node.disconnect(); } catch { /* already disconnected */ } };
      node.start(decision.at);
      this.sources.add(node);
      this.queuedUntil = decision.at + buffer.duration / playbackRate;
      return 'schedule';
    } catch {
      if (source) {
        source.onended = null;
        try { source.disconnect(); } catch { /* failed connection */ }
      }
      this.reset();
      return 'reset';
    }
  }
  reset(): void {
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* already ended */ }
      try { source.disconnect(); } catch { /* already disconnected */ }
    }
    this.sources.clear();
    this.queuedUntil = 0;
  }
}
