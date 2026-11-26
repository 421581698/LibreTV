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
    if (this.context.state !== 'running' || frame.ptsSamples === null) return 'reset';
    // Validate untrusted decoder output before allocating Web Audio buffers.
    if (!(frame.pcm instanceof Float32Array) ||
        !Number.isSafeInteger(frame.samples) || frame.samples < 1 || frame.samples > 262144 ||
        !Number.isSafeInteger(frame.channels) || frame.channels < 1 || frame.channels > 32 ||
        !Number.isSafeInteger(frame.sampleRate) || frame.sampleRate < 8000 || frame.sampleRate > 192000 ||
        frame.samples * frame.channels !== frame.pcm.length ||
        !frame.pcm.every(Number.isFinite)) return 'reset';
    if (this.sources.size >= 32) return 'wait';
    const decision = planExperimentalPcm({
      ptsSamples: frame.ptsSamples, sampleRate: frame.sampleRate, mediaTime,
      audioTime: this.context.currentTime, playbackRate, queuedUntil: this.queuedUntil,
    });
    if (decision.action === 'reset') this.reset();
    if (decision.action !== 'schedule') return decision.action;
    const buffer = this.context.createBuffer(frame.channels, frame.samples, frame.sampleRate);
    for (let channel = 0; channel < frame.channels; channel++) {
      const output = buffer.getChannelData(channel);
      for (let i = 0; i < frame.samples; i++) output[i] = frame.pcm[i * frame.channels + channel];
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    try {
      source.connect(this.destination);
      source.onended = () => { this.sources.delete(source); source.disconnect(); };
      source.start(decision.at);
    } catch {
      source.onended = null;
      try { source.disconnect(); } catch { /* failed connection */ }
      this.reset();
      return 'reset';
    }
    this.sources.add(source);
    this.queuedUntil = decision.at + buffer.duration / playbackRate;
    return 'schedule';
  }
  reset(): void {
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* already ended */ }
      source.disconnect();
    }
    this.sources.clear();
    this.queuedUntil = 0;
  }
}
