import { describe, expect, it, vi } from 'vitest';
import { OpenJocExperimentalDecoder, type OpenJocAbi } from './openjoc-experimental-decoder';

function fixture() {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const abi: OpenJocAbi = {
    memory,
    openjoc_wasm_decoder_create: () => 1,
    openjoc_wasm_decoder_destroy: vi.fn(),
    openjoc_wasm_alloc: () => 64,
    openjoc_wasm_dealloc: vi.fn(),
    openjoc_wasm_decoder_push_bytes: vi.fn(() => 1),
    openjoc_wasm_decoder_push_packet: vi.fn(() => 1),
    openjoc_wasm_decoder_receive_pcm: vi.fn(() => 1),
    openjoc_wasm_decoder_consume_pcm: vi.fn(() => 1),
    openjoc_wasm_decoder_pcm_ptr: () => 128,
    openjoc_wasm_decoder_pcm_len: () => 4,
    openjoc_wasm_decoder_pcm_samples: () => 2,
    openjoc_wasm_decoder_pcm_pts_samples: () => 48000n,
    openjoc_wasm_decoder_sample_rate: () => 48000,
    openjoc_wasm_decoder_channel_count: () => 2,
    openjoc_wasm_decoder_reset: vi.fn(() => 0),
    openjoc_wasm_decoder_flush: () => 3,
  };
  return { abi, decoder: new OpenJocExperimentalDecoder(abi) };
}
describe('experimental OpenJOC ABI adapter', () => {
  it('copies input and forwards timestamps and flags', () => {
    const { abi, decoder } = fixture();
    expect(decoder.push(Uint8Array.of(11, 119), { ptsSamples: 48000n, discontinuity: true, preroll: true })).toBe(1);
    expect(Array.from(new Uint8Array(abi.memory.buffer, 64, 2))).toEqual([11, 119]);
    expect(abi.openjoc_wasm_decoder_push_packet).toHaveBeenCalledWith(1, 64, 2, 48000n, 3);
    expect(abi.openjoc_wasm_dealloc).toHaveBeenCalledWith(64, 2);
  });
  it('copies PCM before the wasm memory changes', () => {
    const { abi, decoder } = fixture();
    new Float32Array(abi.memory.buffer, 128, 4).set([0.5, -0.5, 0.25, -0.25]);
    const frame = decoder.receive();
    abi.memory.grow(1);
    new Float32Array(abi.memory.buffer, 128, 4).fill(0);
    expect(Array.from(frame!.pcm)).toEqual([0.5, -0.5, 0.25, -0.25]);
    expect(frame?.ptsSamples).toBe(48000n);
    expect(abi.openjoc_wasm_decoder_consume_pcm).toHaveBeenCalledWith(1);
  });
  it('rejects oversized input and invalid PCM metadata', () => {
    const { abi, decoder } = fixture();
    expect(() => decoder.push(new Uint8Array(262145))).toThrow();
    abi.openjoc_wasm_decoder_pcm_len = () => 5;
    expect(() => decoder.receive()).toThrow();
  });
  it('rejects out-of-range WASM allocation pointers and still deallocates', () => {
    const { abi, decoder } = fixture();
    abi.openjoc_wasm_alloc = () => abi.memory.buffer.byteLength - 1;
    expect(() => decoder.push(Uint8Array.of(1, 2))).toThrow('OpenJOC allocation exceeds WASM memory');
    expect(abi.openjoc_wasm_dealloc).toHaveBeenCalledWith(abi.memory.buffer.byteLength - 1, 2);
    expect(abi.openjoc_wasm_decoder_push_bytes).not.toHaveBeenCalled();
  });
  it('rejects malformed PCM pointers, channel counts and timestamps', () => {
    const { abi, decoder } = fixture();
    abi.openjoc_wasm_decoder_pcm_ptr = () => 1.5;
    expect(() => decoder.receive()).toThrow('OpenJOC invalid PCM metadata');
    abi.openjoc_wasm_decoder_pcm_ptr = () => 128;
    abi.openjoc_wasm_decoder_channel_count = () => 1.5;
    expect(() => decoder.receive()).toThrow('OpenJOC invalid PCM metadata');
    abi.openjoc_wasm_decoder_channel_count = () => 2;
    abi.openjoc_wasm_decoder_pcm_pts_samples = () => 1n << 63n;
    expect(() => decoder.receive()).toThrow('OpenJOC invalid PCM metadata');
  });
  it('frees input on decoder error and closes only once', () => {
    const { abi, decoder } = fixture();
    abi.openjoc_wasm_decoder_push_bytes = () => -1;
    expect(() => decoder.push(Uint8Array.of(1))).toThrow();
    expect(abi.openjoc_wasm_dealloc).toHaveBeenCalledWith(64, 1);
    decoder.reset();
    expect(decoder.flush()).toBe(3);
    decoder.close();
    decoder.close();
    expect(abi.openjoc_wasm_decoder_destroy).toHaveBeenCalledTimes(1);
    expect(() => decoder.receive()).toThrow();
  });
});
