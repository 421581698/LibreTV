import type { OpenJocAbi } from './openjoc-experimental-decoder';

const MAX_WASM_BYTES = 8 * 1024 * 1024;
const REQUIRED = [
  'openjoc_wasm_decoder_create', 'openjoc_wasm_decoder_destroy',
  'openjoc_wasm_alloc', 'openjoc_wasm_dealloc',
  'openjoc_wasm_decoder_push_bytes', 'openjoc_wasm_decoder_push_packet',
  'openjoc_wasm_decoder_receive_pcm', 'openjoc_wasm_decoder_consume_pcm',
  'openjoc_wasm_decoder_pcm_ptr', 'openjoc_wasm_decoder_pcm_len',
  'openjoc_wasm_decoder_pcm_samples', 'openjoc_wasm_decoder_pcm_pts_samples',
  'openjoc_wasm_decoder_sample_rate', 'openjoc_wasm_decoder_channel_count',
  'openjoc_wasm_decoder_reset', 'openjoc_wasm_decoder_flush',
] as const;

/** Accept only a user-selected, local, import-free OpenJOC WASM module.
 * No model download, remote URL, persistent storage, or implicit enablement.
 * A syntactically matching ABI is not a provenance or codec certification.
 */
export async function loadUserOpenJocWasm(file: File): Promise<OpenJocAbi> {
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.wasm') ||
      file.size < 8 || file.size > MAX_WASM_BYTES) {
    throw new Error('Select a local OpenJOC .wasm file (8 bytes–8 MiB)');
  }
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== file.size || !WebAssembly.validate(bytes)) {
    throw new Error('Invalid OpenJOC WASM bytes');
  }
  // Do not grant filesystem, browser, or WASI imports to untrusted modules.
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports as Record<string, WebAssembly.ExportValue>;
  if (!(exports.memory instanceof WebAssembly.Memory) ||
      REQUIRED.some(name => typeof exports[name] !== 'function')) {
    throw new Error('OpenJOC ABI is incomplete');
  }
  return exports as unknown as OpenJocAbi;
}
