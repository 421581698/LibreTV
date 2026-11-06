"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject, PointerEvent } from "react";

type DragState = {
  pointerId: number;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  moved: boolean;
};

type Options = {
  openRef: MutableRefObject<boolean>;
  closingRef: MutableRefObject<boolean>;
  onOpen: () => void;
  onClose: () => void;
};

const FAB_SIZE = 68;
const DRAG_THRESHOLD = 8;

function clampPosition(position: { left: number; top: number }) {
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - FAB_SIZE - margin);
  const maxTop = Math.max(margin, window.innerHeight - FAB_SIZE - margin);
  return {
    left: Math.min(maxLeft, Math.max(margin, position.left)),
    top: Math.min(maxTop, Math.max(margin, position.top)),
  };
}

/**
 * Floating assistant interaction:
 * - A tap opens the assistant from the click event (including iOS Safari).
 * - Pointer events are used only for dragging.
 * - A drag suppresses its follow-up click so it cannot accidentally open.
 */
export function useFridayFabController({
  openRef,
  closingRef,
  onOpen,
  onClose,
}: Options) {
  const [fabHidden, setFabHidden] = useState(false);
  const [fabPosition, setFabPosition] = useState<{ left: number; top: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    const handleResize = () => {
      setFabPosition((current) => (current ? clampPosition(current) : current));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleFabPointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (openRef.current || closingRef.current) return;
    // Clear a stale drag-click suppression if the browser omitted click after
    // a previous pointer sequence (seen on some mobile Safari versions).
    suppressClickRef.current = false;
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    // Deliberately avoid pointer capture: iOS Safari can retarget/suppress
    // the synthesized click after capture. A normal tap is handled by onClick.
  }, [openRef, closingRef]);

  const handleFabPointerMove = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return;

    drag.moved = true;
    suppressClickRef.current = true;
    setFabPosition(clampPosition({
      left: event.clientX - drag.offsetX,
      top: event.clientY - drag.offsetY,
    }));
  }, []);

  const handleFabPointerUp = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const wasDrag = drag.moved;
    dragRef.current = null;

    if (wasDrag) {
      // Suppress the click synthesized after a completed drag.
      suppressClickRef.current = true;
      return;
    }

    // Do not rely exclusively on a synthesized click: some mobile Safari
    // pointer sequences can omit it. A stationary pointer release is a tap.
    suppressClickRef.current = true;
    if (!openRef.current && !closingRef.current) {
      onOpen();
    }
  }, [onOpen, openRef, closingRef]);

  const handleFabPointerCancel = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    suppressClickRef.current = false;
  }, []);

  const handleFabTouchEnd = useCallback(() => {
    // iOS Safari may deliver touch events differently from synthesized clicks.
    // Keep touch as a direct activation path; a completed drag must not open.
    const drag = dragRef.current;
    if (drag?.moved) return;
    if (openRef.current || closingRef.current) return;
    suppressClickRef.current = true;
    onOpen();
  }, [onOpen, openRef, closingRef]);

  const handleFabClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (openRef.current || closingRef.current) return;
    onOpen();
  }, [onOpen, openRef, closingRef]);

  const hideAssistant = useCallback(() => {
    onClose();
    setFabHidden(true);
  }, [onClose]);

  const restoreAssistant = useCallback(() => {
    setFabHidden(false);
    setFabPosition(null);
  }, []);

  return {
    fabHidden,
    fabPosition,
    handleFabPointerDown,
    handleFabPointerMove,
    handleFabPointerUp,
    handleFabPointerCancel,
    handleFabClick,
    handleFabTouchEnd,
    hideAssistant,
    restoreAssistant,
  };
}
