/// <reference lib="webworker" />

type WorkerRequest =
  | { type: 'init'; generation: number; wasmUrl?: string }
  | { type: 'packet'; generation: number; bytes: ArrayBuffer; pts: number; timescale: number; discontinuity?: boolean; preroll?: boolean }
  | { type: 'flush'; generation: number }
  | { type: 'reset'; generation: number }
  | { type: 'dispose'; generation: number };

type WorkerResponse =
  | { type: 'ready'; generation: number; decoder: 'OpenJOC'; renderer: 'Stereo'; sampleRate: 48000; channels: 2; nativeDolbyDecoderUsed: false }
  | { type: 'pcm'; generation: number; samples: ArrayBuffer; sampleFrames: number; ptsSamples: number | null; sampleRate: 48000; channels: 2 }
  | { type: 'need-input' | 'flushed' | 'reset' | 'disposed'; generation: number }
  | { type: 'error'; generation: number; message: string };

const scope = self as DedicatedWorkerGlobalScope;
const NO_PTS = -(1n << 63n);
const MAX_PACKET_BYTES = 1024 * 1024;
const MAX_PCM_FRAMES_PER_PACKET = 8;

let generation = -1;
let exportsRef: WebAssembly.Exports | null = null;
let decoderHandle = 0;
let disposed = true;

function send(message: WorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function current(id: number): boolean {
  return !disposed && id === generation;
}

function requiredFunction<T extends (...args: never[]) => unknown>(name: string): T {
  const value = exportsRef?.[name];
  if (typeof value !== 'function') throw new Error(`OpenJOC WASM export missing: ${name}`);
  return value as T;
}

function memory(): WebAssembly.Memory {
  const value = exportsRef?.memory;
  if (!(value instanceof WebAssembly.Memory)) throw new Error('OpenJOC WASM memory export is unavailable.');
  return value;
}

function drainPcm(id: number): void {
  const receive = requiredFunction<(handle: number) => number>('openjoc_wasm_decoder_receive_pcm');
  const ptr = requiredFunction<(handle: number) => number>('openjoc_wasm_decoder_pcm_ptr');
  const length = requiredFunction<(handle: number) => number>('openjoc_wasm_decoder_pcm_len');
  const pts = requiredFunction<(handle: number) => bigint>('openjoc_wasm_decoder_pcm_pts_samples');
  const consume = requiredFunction<(handle: number) => number>('openjoc_wasm_decoder_consume_pcm');

  for (let count = 0; count < MAX_PCM_FRAMES_PER_PACKET; count += 1) {
    if (!current(id)) return;
    const available = receive(decoderHandle);
    if (available === 0) return;
    if (available !== 1) throw new Error('OpenJOC PCM receive failed.');
    const pointer = ptr(decoderHandle);
    const floatCount = length(decoderHandle);
    if (!pointer || floatCount <= 0 || floatCount > 48000 * 2) throw new Error('OpenJOC PCM frame is outside the output bounds.');

    // Copy before consume: the decoder owns and may reuse its WASM memory immediately afterwards.
    const owned = new Float32Array(memory().buffer, pointer, floatCount).slice();
    const framePts = pts(decoderHandle);
    if (consume(decoderHandle) !== 1) throw new Error('OpenJOC PCM frame could not be released.');
    send({
      type: 'pcm',
      generation: id,
      samples: owned.buffer,
      sampleFrames: owned.length / 2,
      ptsSamples: framePts === NO_PTS ? null : Number(framePts),
      sampleRate: 48000,
      channels: 2,
    }, [owned.buffer]);
  }
  throw new Error('OpenJOC produced more PCM than the per-packet drain budget.');
}

async function initialize(request: Extract<WorkerRequest, { type: 'init' }>): Promise<void> {
  generation = request.generation;
  disposed = false;
  try {
    const response = await fetch(request.wasmUrl ?? '/wasm/openjoc_wasm.wasm', { credentials: 'same-origin', cache: 'force-cache' });
    if (!response.ok) throw new Error(`OpenJOC WASM request failed: HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (!current(request.generation)) return;
    const imports: WebAssembly.Imports = { env: { openjoc_wasm_clock_now_ms: () => performance.now() } };
    const instantiated = await WebAssembly.instantiate(bytes, imports);
    if (!current(request.generation)) return;
    exportsRef = instantiated.instance.exports;
    decoderHandle = requiredFunction<() => number>('openjoc_wasm_decoder_create')();
    if (!decoderHandle) throw new Error('OpenJOC decoder initialization failed.');
    send({ type: 'ready', generation: request.generation, decoder: 'OpenJOC', renderer: 'Stereo', sampleRate: 48000, channels: 2, nativeDolbyDecoderUsed: false });
  } catch (error) {
    if (current(request.generation)) send({ type: 'error', generation: request.generation, message: error instanceof Error ? error.message : 'OpenJOC initialization failed.' });
    destroy();
  }
}

function destroy(): void {
  if (decoderHandle && exportsRef) {
    try { requiredFunction<(handle: number) => void>('openjoc_wasm_decoder_destroy')(decoderHandle); } catch { /* teardown is best-effort */ }
  }
  decoderHandle = 0;
  exportsRef = null;
  disposed = true;
}

scope.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const request = event.data;
  if (!request || !Number.isInteger(request.generation)) return;
  if (request.type === 'init') {
    destroy();
    void initialize(request);
    return;
  }
  if (request.type === 'dispose') {
    if (request.generation === generation) {
      destroy();
      send({ type: 'disposed', generation: request.generation });
    }
    return;
  }
  if (request.type === 'reset') {
    if (disposed || !decoderHandle || !exportsRef || request.generation <= generation) return;
    generation = request.generation;
  } else if (!current(request.generation) || !decoderHandle || !exportsRef) {
    return;
  }

  try {
    if (request.type === 'reset') {
      const status = requiredFunction<(handle: number) => number>('openjoc_wasm_decoder_reset')(decoderHandle);
      if (status !== 0) throw new Error('OpenJOC decoder reset failed.');
      send({ type: 'reset', generation: request.generation });
      return;
    }
    if (request.type === 'packet') {
      if (!(request.bytes instanceof ArrayBuffer) || request.bytes.byteLength === 0 || request.bytes.byteLength > MAX_PACKET_BYTES) {
        throw new Error('E-AC-3 sample is empty or exceeds the 1 MiB input bound.');
      }
      if (!Number.isFinite(request.pts) || !Number.isFinite(request.timescale) || request.timescale <= 0) {
        throw new Error('E-AC-3 sample timestamp is invalid.');
      }
      const alloc = requiredFunction<(length: number) => number>('openjoc_wasm_alloc');
      const dealloc = requiredFunction<(pointer: number, length: number) => void>('openjoc_wasm_dealloc');
      const push = requiredFunction<(handle: number, pointer: number, length: number, pts: bigint, flags: number) => number>('openjoc_wasm_decoder_push_packet');
      const pointer = alloc(request.bytes.byteLength);
      if (!pointer) throw new Error('OpenJOC could not allocate bounded input memory.');
      try {
        new Uint8Array(memory().buffer, pointer, request.bytes.byteLength).set(new Uint8Array(request.bytes));
        const ptsSamples = BigInt(Math.round(request.pts * 48000 / request.timescale));
        const flags = (request.discontinuity ? 1 : 0) | (request.preroll ? 2 : 0);
        const status = push(decoderHandle, pointer, request.bytes.byteLength, ptsSamples, flags);
        if (status < 0) throw new Error('OpenJOC rejected the E-AC-3 access unit.');
      } finally {
        dealloc(pointer, request.bytes.byteLength);
      }
      drainPcm(request.generation);
      send({ type: 'need-input', generation: request.generation });
      return;
    }
    if (request.type === 'flush') {
      const flush = requiredFunction<(handle: number) => number>('openjoc_wasm_decoder_flush');
      for (let count = 0; count < 256; count += 1) {
        const status = flush(decoderHandle);
        if (status < 0) throw new Error('OpenJOC decoder flush failed.');
        drainPcm(request.generation);
        if (status === 3) {
          send({ type: 'flushed', generation: request.generation });
          return;
        }
      }
      throw new Error('OpenJOC decoder flush exceeded its bounded drain budget.');
    }
  } catch (error) {
    send({ type: 'error', generation: request.generation, message: error instanceof Error ? error.message : 'OpenJOC decode failed.' });
    destroy();
  }
};

export {};
