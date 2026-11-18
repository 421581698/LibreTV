export type VoiceOverState = 'unknown' | 'running' | 'stopped';
export type FocusRequest = { readonly focusId: string; readonly reason: 'navigation' | 'recovery' | 'announcement' };
export type FocusDelivery = { readonly delivered: boolean; readonly via: 'bridge' | 'dom' | 'none'; readonly confirmed: boolean };
export interface VoiceOverBridge {
  isRunning?(): boolean | Promise<boolean>;
  moveFocus?(focusId: string): boolean | Promise<boolean>;
  subscribe?(listener: (event: { type: 'running'; running: boolean } | { type: 'focus'; focusId: string }) => void): (() => void) | void;
}
export function parseFocusId(value: string): { regionId: string; index: number } | null {
  const match = /^region:(.+):index:(\\d+)$/.exec(value);
  if (!match) return null;
  const index = Number(match[2]);
  return Number.isSafeInteger(index) && index >= 0 ? { regionId: match[1], index } : null;
}
/** Bridge confirmation and DOM focus invocation are deliberately distinct. */
export async function requestAccessibilityFocus(args: {
  focusId: string; bridge?: VoiceOverBridge | null;
  resolveElement?: (focusId: string) => { focus?: () => void } | null;
}): Promise<FocusDelivery> {
  if (args.bridge?.moveFocus) {
    try { if (await args.bridge.moveFocus(args.focusId)) return { delivered: true, via: 'bridge', confirmed: true }; }
    catch { /* fall through to a best-effort DOM focus request */ }
  }
  try {
    const element = args.resolveElement?.(args.focusId);
    if (element?.focus) { element.focus(); return { delivered: true, via: 'dom', confirmed: false }; }
  } catch { /* unavailable DOM target */ }
  return { delivered: false, via: 'none', confirmed: false };
}
