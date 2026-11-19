export type RenderCapabilities = {
  css: boolean; svg: boolean; canvas2d: boolean; webgl: boolean;
  reducedMotion: boolean; reducedTransparency: boolean; lowPower: boolean;
};
export type RenderBackend = 'webgl' | 'canvas2d' | 'svg' | 'css';
export type RenderPolicy = {
  backend: RenderBackend; allowContinuousAnimation: boolean; allowDisplacement: boolean; reason: string;
};
/** Selects the richest safe renderer supported by the device and accessibility preferences. */
export function selectRenderPolicy(capabilities: RenderCapabilities): RenderPolicy {
  const allowContinuousAnimation = !capabilities.reducedMotion && !capabilities.lowPower;
  if (capabilities.webgl && !capabilities.lowPower && !capabilities.reducedTransparency) {
    return { backend: 'webgl', allowContinuousAnimation, allowDisplacement: true, reason: 'webgl-capable' };
  }
  if (capabilities.canvas2d && !capabilities.lowPower && !capabilities.reducedTransparency) {
    return { backend: 'canvas2d', allowContinuousAnimation, allowDisplacement: false, reason: 'canvas-fallback' };
  }
  if (capabilities.svg) {
    return {
      backend: 'svg', allowContinuousAnimation: false, allowDisplacement: false,
      reason: capabilities.reducedTransparency ? 'reduced-transparency' : 'vector-fallback',
    };
  }
  return {
    backend: 'css', allowContinuousAnimation: false, allowDisplacement: false,
    reason: capabilities.css ? 'safe-css-fallback' : 'minimum-css-fallback',
  };
}

/** Reads browser capabilities at runtime; call only after mounting on the client. */
export function detectRenderCapabilities(preferences: {
  reducedMotion?: boolean;
  reducedTransparency?: boolean;
} = {}): RenderCapabilities {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {
      css: true, svg: false, canvas2d: false, webgl: false,
      reducedMotion: true, reducedTransparency: true, lowPower: true,
    };
  }
  const css = typeof CSS !== 'undefined' && (
    CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)')
  );
  const svg = typeof SVGSVGElement !== 'undefined' && !!document.createElementNS('http://www.w3.org/2000/svg', 'svg').createSVGRect;
  const canvas2d = (() => {
    try { return !!document.createElement('canvas').getContext('2d'); } catch { return false; }
  })();
  const webgl = (() => {
    try {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      const extension = context && context.getExtension('WEBGL_lose_context');
      extension?.loseContext();
      return !!context;
    } catch { return false; }
  })();
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const lowPower = nav.connection?.saveData === true
    || (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4)
    || (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4);
  return {
    css, svg, canvas2d, webgl,
    reducedMotion: preferences.reducedMotion ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    reducedTransparency: preferences.reducedTransparency ?? window.matchMedia('(prefers-reduced-transparency: reduce)').matches,
    lowPower,
  };
}
