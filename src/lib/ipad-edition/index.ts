export { CINEMA_COMPACT_MIN, CINEMA_STAGE_MIN, resolveCinemaActivation } from './container';
export type { CinemaActivation } from './container';
export { isIpadEditionDevice } from './device';
export type { DeviceSignals } from './device';
export { chromeForPage, PLAYER_FULLSCREEN_CHROME } from './chrome';
export type { DetailCapsulePolicy, NavChrome } from './chrome';
export {
  activePointerSignals,
  minimumScrollDelta,
  moveIndex,
  nearestByPosition,
  preserveIndex,
  resolvedFocusAxis,
} from './focus-engine';
export type { FocusAxis, PointerSignal } from './focus-engine';
export { IPAD_EDITION_TOKENS, IPAD_EDITION_TOKEN_LIMITS, tokensWithinLimits } from './tokens';

export { resolveEnvironmentProfile } from './environment-engine';
export type { AppearancePreference, ContrastPreference, EnvironmentSignals, EnvironmentProfile } from './environment-engine';
export { GestureEngine } from './gesture-engine';
export type { GesturePoint, GestureEngineOptions } from './gesture-engine';
export { selectRenderPolicy } from './render-engine';
export type { RenderCapabilities, RenderBackend, RenderPolicy } from './render-engine';
