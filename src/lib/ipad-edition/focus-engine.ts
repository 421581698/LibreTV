import type { CinemaActivation } from './container';

export type FocusAxis = 'horizontal' | 'vertical';
export type PointerSignal = 'touch' | 'hover' | 'focus' | 'pressed';

export function resolvedFocusAxis(activation: CinemaActivation, preferredAxis: FocusAxis): FocusAxis {
  if (activation === 'compact' && preferredAxis === 'horizontal') return 'vertical';
  return preferredAxis;
}

export function preserveIndex(currentIndex: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  const index = Number.isFinite(currentIndex) ? Math.max(0, Math.floor(currentIndex)) : 0;
  return index < itemCount ? index : itemCount - 1;
}

export function nearestByPosition(currentPosition: number, positions: readonly number[]): number {
  if (positions.length === 0 || !Number.isFinite(currentPosition)) return 0;
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < positions.length; index += 1) {
    const distance = Math.abs(positions[index] - currentPosition);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

export function moveIndex(currentIndex: number, delta: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  const index = preserveIndex(currentIndex, itemCount);
  const step = Number.isFinite(delta) ? delta : 0;
  return Math.min(itemCount - 1, Math.max(0, index + step));
}

export function minimumScrollDelta(args: {
  viewportStart: number;
  viewportSize: number;
  itemStart: number;
  itemSize: number;
}): number {
  if (args.viewportSize <= 0 || args.itemSize < 0) return 0;
  const viewportEnd = args.viewportStart + args.viewportSize;
  const itemEnd = args.itemStart + args.itemSize;
  if (args.itemStart < args.viewportStart) return args.itemStart - args.viewportStart;
  if (itemEnd > viewportEnd) return itemEnd - viewportEnd;
  return 0;
}

export function activePointerSignals(input: {
  touch: boolean;
  hover: boolean;
  focus: boolean;
  pressed: boolean;
}): PointerSignal[] {
  const signals: PointerSignal[] = [];
  if (input.touch) signals.push('touch');
  if (input.hover) signals.push('hover');
  if (input.focus) signals.push('focus');
  if (input.pressed) signals.push('pressed');
  return signals;
}
