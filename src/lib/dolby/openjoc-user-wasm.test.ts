import { describe, expect, it, vi } from 'vitest';
import { loadUserOpenJocWasm } from './openjoc-user-wasm';

describe('explicit local WASM loader', () => {
  it('rejects non-WASM input before instantiating it', async () => {
    const instantiate = vi.spyOn(WebAssembly, 'instantiate');
    const file = new File([new Uint8Array(16)], 'decoder.wasm');
    await expect(loadUserOpenJocWasm(file)).rejects.toThrow();
    expect(instantiate).not.toHaveBeenCalled();
    instantiate.mockRestore();
  });
  it('rejects non-WASM file extensions', async () => {
    await expect(loadUserOpenJocWasm(new File([new Uint8Array(16)], 'decoder.js'))).rejects.toThrow();
  });
});
