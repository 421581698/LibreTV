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
