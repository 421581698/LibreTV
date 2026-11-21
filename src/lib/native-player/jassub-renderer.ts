import type JASSUB from 'jassub';

export type AssSubtitleRenderer = InstanceType<typeof JASSUB>;

export async function createAssSubtitleRenderer(
  video: HTMLVideoElement,
  subtitleContent: string,
): Promise<AssSubtitleRenderer> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof WebAssembly === 'undefined' ||
      typeof HTMLCanvasElement === 'undefined' || typeof HTMLCanvasElement.prototype.transferControlToOffscreen !== 'function') {
    throw new Error('当前浏览器缺少 JASSUB 所需的 Worker、OffscreenCanvas 或 WebAssembly 能力。');
  }
  if (!subtitleContent.trim()) throw new Error('ASS/SSA 字幕文件为空。');

  const { default: Jassub } = await import('jassub');
  const renderer = new Jassub({
    video,
    subContent: subtitleContent,
    workerUrl: '/jassub/worker/worker.js',
    wasmUrl: '/jassub/wasm/jassub-worker.wasm',
    modernWasmUrl: '/jassub/wasm/jassub-worker-modern.wasm',
    wasmWorkerUrl: '/jassub/wasm/jassub-worker.js',
    modernWasmWorkerUrl: '/jassub/wasm/jassub-worker-modern.js',
    availableFonts: {
      'liberation sans': '/jassub/default.woff2',
    },
    defaultFont: 'liberation sans',
    queryFonts: false,
  });

  try {
    await renderer.ready;
    return renderer;
  } catch (error) {
    try { await renderer.destroy(); } catch { /* preserve the initialization error */ }
    throw error;
  }
}
