export type GesturePoint = { x: number; y: number };
export type GestureEngineOptions = {
  longPressMs?: number;
  movementThreshold?: number;
  onTap?: (point: GesturePoint, event: PointerEvent) => void;
  onLongPress?: (point: GesturePoint, event: PointerEvent) => void;
  onDragStart?: (point: GesturePoint, event: PointerEvent) => void;
  onDrag?: (point: GesturePoint, delta: GesturePoint, event: PointerEvent) => void;
  onDragEnd?: (point: GesturePoint, event: PointerEvent) => void;
};
type ActivePointer = {
  id: number; start: GesturePoint; latest: GesturePoint; longPressed: boolean;
  dragging: boolean; sourceEvent: PointerEvent;
};
/** Opt-in recognizer for explicit handles/surfaces; no global listeners or scroll suppression. */
export class GestureEngine {
  private element: HTMLElement | null = null;
  private active: ActivePointer | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly longPressMs: number;
  private readonly movementThreshold: number;
  constructor(private readonly options: GestureEngineOptions = {}) {
    this.longPressMs = options.longPressMs ?? 520;
    this.movementThreshold = options.movementThreshold ?? 9;
  }
  attach(element: HTMLElement): () => void {
    this.detach();
    this.element = element;
    element.addEventListener('pointerdown', this.handlePointerDown);
    element.addEventListener('pointermove', this.handlePointerMove);
    element.addEventListener('pointerup', this.handlePointerUp);
    element.addEventListener('pointercancel', this.handlePointerCancel);
    return () => this.detach();
  }
  detach(): void {
    this.clearLongPress();
    if (this.element) {
      this.element.removeEventListener('pointerdown', this.handlePointerDown);
      this.element.removeEventListener('pointermove', this.handlePointerMove);
      this.element.removeEventListener('pointerup', this.handlePointerUp);
      this.element.removeEventListener('pointercancel', this.handlePointerCancel);
    }
    this.element = null;
    this.active = null;
  }
  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    this.clearLongPress();
    const point = { x: event.clientX, y: event.clientY };
    this.active = { id: event.pointerId, start: point, latest: point, longPressed: false, dragging: false, sourceEvent: event };
    this.longPressTimer = setTimeout(() => {
      const active = this.active;
      if (!active || active.dragging) return;
      active.longPressed = true;
      this.options.onLongPress?.(active.latest, active.sourceEvent);
    }, this.longPressMs);
  };
  private readonly handlePointerMove = (event: PointerEvent): void => {
    const active = this.active;
    if (!active || active.id !== event.pointerId) return;
    const point = { x: event.clientX, y: event.clientY };
    const delta = { x: point.x - active.start.x, y: point.y - active.start.y };
    active.latest = point;
    if (!active.dragging && Math.hypot(delta.x, delta.y) >= this.movementThreshold) {
      this.clearLongPress();
      active.dragging = true;
      this.options.onDragStart?.(point, event);
    }
    if (active.dragging) this.options.onDrag?.(point, delta, event);
  };
  private readonly handlePointerUp = (event: PointerEvent): void => {
    const active = this.active;
    if (!active || active.id !== event.pointerId) return;
    this.clearLongPress();
    const point = { x: event.clientX, y: event.clientY };
    if (active.dragging) this.options.onDragEnd?.(point, event);
    else if (!active.longPressed) this.options.onTap?.(point, event);
    this.active = null;
  };
  private readonly handlePointerCancel = (event: PointerEvent): void => {
    if (this.active?.id !== event.pointerId) return;
    this.clearLongPress();
    this.active = null;
  };
  private clearLongPress(): void {
    if (this.longPressTimer !== null) clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }
}
