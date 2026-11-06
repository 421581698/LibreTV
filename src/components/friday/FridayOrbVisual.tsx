"use client";

import React from "react";

type FridayOrbVisualProps = {
  state?: "standby" | "listening" | "thinking" | "speaking" | "completed";
};

/**
 * Friday JARVIS-inspired holographic core.
 * Pure presentation only: runtime state is supplied by the existing orchestrator.
 */
export function FridayOrbVisual({ state = "standby" }: FridayOrbVisualProps) {
  return (
    <div className="friday-orb-visual" data-state={state} aria-hidden="true">
      <div className="friday-jarvis-aura" />
      <div className="friday-jarvis-ring friday-jarvis-ring-outer" />
      <div className="friday-jarvis-ticks" />
      <div className="friday-jarvis-ring friday-jarvis-ring-arcs" />
      <div className="friday-jarvis-ring friday-jarvis-ring-data" />
      <div className="friday-jarvis-ring friday-jarvis-ring-inner" />
      <div className="friday-jarvis-core">
        <div className="friday-jarvis-core-light" />
        <div className="friday-jarvis-core-glint" />
        <div className="friday-jarvis-equalizer" aria-hidden="true">
          <i /><i /><i /><i /><i />
        </div>
      </div>
      <div className="friday-jarvis-scan" />
      <div className="friday-jarvis-label">F</div>
    </div>
  );
}
