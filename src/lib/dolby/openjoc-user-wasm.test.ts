import { describe, expect, it, vi } from 'vitest';
import { allowedOpenJocImports, loadUserOpenJocWasm } from './openjoc-user-wasm';

describe('explicit local WASM loader', () => {
  it('permits only the pinned bridge clock import', () => {
    const clock = { module: 'env', name: 'openjoc_wasm_clock_now_ms', kind: 'function' as const };
    expect(allowedOpenJocImports([])).toBe(true);
    expect(allowedOpenJocImports([clock])).toBe(true);
    expect(allowedOpenJocImports([clock, clock])).toBe(false);
    expect(allowedOpenJocImports([{ ...clock, name: 'arbitrary' }])).toBe(false);
    expect(allowedOpenJocImports([{ module: 'wasi_snapshot_preview1', name: 'fd_write', kind: 'function' }])).toBe(false);
    expect(allowedOpenJocImports([{ module: 'env', name: 'memory', kind: 'memory' }])).toBe(false);
  });
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
