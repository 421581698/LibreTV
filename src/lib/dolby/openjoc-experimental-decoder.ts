/** Experimental pinned OpenJOC ABI. Not a playback or Dolby certification claim. */
type Unary = (handle: number) => number;
export interface OpenJocAbi {
  memory: WebAssembly.Memory;
  openjoc_wasm_decoder_create(): number;
  openjoc_wasm_decoder_destroy(handle: number): void;
  openjoc_wasm_alloc(length: number): number;
  openjoc_wasm_dealloc(pointer: number, length: number): void;
  openjoc_wasm_decoder_push_bytes(handle: number, pointer: number, length: number): number;
  openjoc_wasm_decoder_push_packet(handle: number, pointer: number, length: number, pts: bigint, flags: number): number;
  openjoc_wasm_decoder_receive_pcm: Unary;
  openjoc_wasm_decoder_consume_pcm: Unary;
  openjoc_wasm_decoder_pcm_ptr: Unary;
  openjoc_wasm_decoder_pcm_len: Unary;
  openjoc_wasm_decoder_pcm_samples: Unary;
  openjoc_wasm_decoder_pcm_pts_samples(handle: number): bigint;
  openjoc_wasm_decoder_sample_rate: Unary;
  openjoc_wasm_decoder_channel_count: Unary;
  openjoc_wasm_decoder_reset: Unary;
  openjoc_wasm_decoder_flush: Unary;
}
export interface ExperimentalPcm {
  pcm: Float32Array;
  samples: number;
  channels: number;
  sampleRate: number;
  ptsSamples: bigint | null;
}
const NO_PTS = -(1n << 63n);
const MAX_INPUT = 256 * 1024;
const MAX_PCM = 262144;
export class OpenJocExperimentalDecoder {
  private handle: number;
  private readonly abi: OpenJocAbi;
  constructor(abi: OpenJocAbi) {
    this.abi = abi;
    this.handle = abi.openjoc_wasm_decoder_create();
    if (!this.handle) throw new Error('OpenJOC decoder creation failed');
  }
  private active(): number {
    if (!this.handle) throw new Error('OpenJOC decoder closed');
    return this.handle;
  }
  private status(value: number): number {
    if (!Number.isInteger(value) || value < 0 || value > 3) throw new Error('OpenJOC decoder status error');
    return value;
  }
  push(data: Uint8Array, packet?: { ptsSamples: bigint | null; discontinuity?: boolean; preroll?: boolean }): number {
    const h = this.active();
    if (!data.length || data.length > MAX_INPUT) throw new RangeError('OpenJOC input size');
    if (packet?.ptsSamples != null && (typeof packet.ptsSamples !== 'bigint' || packet.ptsSamples <= NO_PTS || packet.ptsSamples >= (1n << 63n))) throw new RangeError('OpenJOC PTS');
    const p = this.abi.openjoc_wasm_alloc(data.length);
    if (!Number.isSafeInteger(p) || p <= 0) throw new Error('OpenJOC allocation failed');
    try {
      if (p > this.abi.memory.buffer.byteLength - data.length) {
        throw new Error('OpenJOC allocation exceeds WASM memory');
      }
      new Uint8Array(this.abi.memory.buffer, p, data.length).set(data);
      return this.status(packet
        ? this.abi.openjoc_wasm_decoder_push_packet(h, p, data.length, packet.ptsSamples ?? NO_PTS, Number(Boolean(packet.discontinuity)) | (Number(Boolean(packet.preroll)) << 1))
        : this.abi.openjoc_wasm_decoder_push_bytes(h, p, data.length));
    } finally { this.abi.openjoc_wasm_dealloc(p, data.length); }
  }
  receive(): ExperimentalPcm | null {
    const h = this.active(), a = this.abi;
    const ready = a.openjoc_wasm_decoder_receive_pcm(h);
    if (ready === 0) return null;
    if (ready !== 1) throw new Error('OpenJOC receive failed');
    const p = a.openjoc_wasm_decoder_pcm_ptr(h);
    const n = a.openjoc_wasm_decoder_pcm_len(h);
    const samples = a.openjoc_wasm_decoder_pcm_samples(h);
    const channels = a.openjoc_wasm_decoder_channel_count(h);
    const sampleRate = a.openjoc_wasm_decoder_sample_rate(h);
    const pts = a.openjoc_wasm_decoder_pcm_pts_samples(h);
    if (!Number.isSafeInteger(p) || p <= 0 || p % 4 ||
        !Number.isSafeInteger(n) || n <= 0 || n > MAX_PCM ||
        !Number.isSafeInteger(samples) || samples <= 0 ||
        !Number.isSafeInteger(channels) || channels < 1 || channels > 32 ||
        samples * channels !== n ||
        !Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 ||
        typeof pts !== 'bigint' || pts < NO_PTS || pts >= (1n << 63n) ||
        p > a.memory.buffer.byteLength - n * 4) throw new Error('OpenJOC invalid PCM metadata');
    const pcm = new Float32Array(a.memory.buffer, p, n).slice();
    if (a.openjoc_wasm_decoder_consume_pcm(h) !== 1) throw new Error('OpenJOC consume failed');
    if (!pcm.every(Number.isFinite)) throw new Error('OpenJOC non-finite PCM');
    return { pcm, samples, channels, sampleRate, ptsSamples: pts === NO_PTS ? null : pts };
  }
  flush(): number { return this.status(this.abi.openjoc_wasm_decoder_flush(this.active())); }
  reset(): void { if (this.abi.openjoc_wasm_decoder_reset(this.active()) !== 0) throw new Error('OpenJOC reset failed'); }
  close(): void {
    const h = this.handle;
    this.handle = 0;
    if (h) this.abi.openjoc_wasm_decoder_destroy(h);
  }
}
