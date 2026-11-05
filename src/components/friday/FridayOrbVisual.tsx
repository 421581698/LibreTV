"use client";

import React from "react";

type FridayOrbVisualProps = {
  state?: "standby" | "listening" | "thinking" | "speaking" | "completed";
};

/** PNG placeholder until the verified transparent motion asset is supplied. */
export function FridayOrbVisual({ state = "standby" }: FridayOrbVisualProps) {
  return (
    <div
      className="friday-orb-visual"
      data-state={state}
      role="img"
      aria-label={state === "listening" ? "Friday 正在聆听" : "Friday"}
    >
      <img
        className="friday-orb-media"
        src="/media/friday-orb-fallback.png"
        alt=""
        aria-hidden="true"
      />
    </div>
  );
}
