import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
  ready: Promise.resolve(),
  destroy: vi.fn(),
}));

vi.mock('jassub', () => ({
  default: class MockJassub {
    ready = state.ready;
    destroy = state.destroy;
    constructor(options: Record<string, unknown>) {
      state.options = options;
    }
  },
}));

import { createAssSubtitleRenderer } from './jassub-renderer';

describe('createAssSubtitleRenderer', () => {
  beforeEach(() => {
    state.options = null;
    state.ready = Promise.resolve();
    state.destroy.mockReset();
    vi.stubGlobal('Worker', class Worker {});
    vi.stubGlobal('OffscreenCanvas', class OffscreenCanvas {});
    class CanvasWithTransfer {}
    Object.defineProperty(CanvasWithTransfer.prototype, 'transferControlToOffscreen', { value: vi.fn() });
    vi.stubGlobal('HTMLCanvasElement', CanvasWithTransfer);
  });

  it('uses self-hosted WASM/worker assets and disables remote font lookup', async () => {
    const video = {} as HTMLVideoElement;
    const renderer = await createAssSubtitleRenderer(video, '[Script Info]\nTitle: fixture');

    expect(renderer).toBeDefined();
    expect(state.options).toMatchObject({
      video,
      subContent: '[Script Info]\nTitle: fixture',
      workerUrl: '/jassub/worker/worker.js',
      wasmUrl: '/jassub/wasm/jassub-worker.wasm',
      modernWasmUrl: '/jassub/wasm/jassub-worker-modern.wasm',
      wasmWorkerUrl: '/jassub/wasm/jassub-worker.js',
      modernWasmWorkerUrl: '/jassub/wasm/jassub-worker-modern.js',
      queryFonts: false,
      defaultFont: 'liberation sans',
    });
  });

  it('rejects empty subtitle content', async () => {
    await expect(createAssSubtitleRenderer({} as HTMLVideoElement, '  ')).rejects.toThrow(/字幕文件为空/i);
  });

  it('destroys the worker renderer when initialization fails', async () => {
    state.ready = Promise.reject(new Error('WASM init failed'));
    await expect(createAssSubtitleRenderer({} as HTMLVideoElement, '[Events]')).rejects.toThrow(/WASM init failed/);
    expect(state.destroy).toHaveBeenCalledOnce();
  });
});
