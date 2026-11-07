"use client";

import React, { useEffect, useRef } from "react";

type FridayOrbVisualProps = {
  state?: "standby" | "listening" | "thinking" | "speaking" | "completed";
  audioLevel?: number;
};

type SigilTheme = "light" | "dark";

const TAU = Math.PI * 2;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function seeded(index: number, salt: number) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function drawGoldenSigil(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  theme: SigilTheme,
  activity: number,
  shock: number,
) {
  const d = Math.min(width, height);
  const cx = width * 0.5;
  const cy = height * 0.49;
  const radius = Math.min(width * 0.39, height * 0.39);
  const phase = (time % 6) / 6 * TAU;
  const light = theme === "light";
  const gold = light ? "#b98735" : "#f5d99a";
  const blue = light ? "#69a9d5" : "#9ddcff";
  const white = light ? "#fffaf0" : "#fffdf6";
  const purple = light ? "#b6a0d5" : "#c6b5f4";
  const glow = light ? 0.48 : 0.82;

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.globalCompositeOperation = "source-over";

  // Layer 1 — transparent atmosphere and a restrained central haze.
  const atmosphere = ctx.createRadialGradient(cx, cy, radius * 0.04, cx, cy, radius * 1.28);
  atmosphere.addColorStop(0, light ? "rgba(246,220,166,.13)" : "rgba(75,105,145,.12)");
  atmosphere.addColorStop(0.52, light ? "rgba(126,177,218,.055)" : "rgba(89,142,203,.075)");
  atmosphere.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = atmosphere;
  ctx.fillRect(0, 0, width, height);

  // Layer 2 — seven deterministic spiral particle streams.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let stream = 0; stream < 7; stream++) {
    const streamPhase = phase * (stream % 2 ? -1 : 1) + stream * 0.83;
    for (let i = 0; i < 26; i++) {
      const s = i / 25;
      const a = streamPhase + s * 5.2;
      const r = radius * (0.2 + s * 0.84);
      const x = cx + Math.cos(a) * r * (0.78 + stream * 0.018);
      const y = cy + Math.sin(a) * r * 0.43 + Math.sin(a * 1.7 + stream) * radius * 0.045;
      const alpha = Math.sin(Math.PI * s) * (0.18 + seeded(stream * 31 + i, 4) * 0.28) * glow;
      ctx.fillStyle = stream % 3 === 0 ? gold : stream % 3 === 1 ? blue : white;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, 0.65 + seeded(i, stream) * 1.45, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();

  // Layer 3 — eight sculpted, three-colour ribbon orbits (no wireframe sphere).
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let ring = 0; ring < 8; ring++) {
    const direction = ring % 3 === 0 ? -1 : 1;
    const tilt = -0.66 + ring * 0.185;
    const spin = phase * direction * (0.72 + ring * 0.035) + ring * 0.71;
    const rx = radius * (0.73 + (ring % 4) * 0.105);
    const ry = radius * (0.24 + (ring % 3) * 0.105);
    const path = new Path2D();
    const points = 180;
    const ribbonWidth = 2.3 + (ring % 3) * 1.15;
    for (let i = 0; i <= points; i++) {
      const u = i / points * TAU;
      const wave = Math.sin(u * 2 + spin) * radius * 0.055;
      const x0 = Math.cos(u + spin) * rx;
      const y0 = Math.sin(u + spin) * ry + wave;
      const x = cx + x0 * Math.cos(tilt) - y0 * Math.sin(tilt) * 0.22;
      const y = cy + x0 * Math.sin(tilt) * 0.42 + y0 * Math.cos(tilt);
      if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    }
    const gradient = ctx.createLinearGradient(cx - rx, cy - ry, cx + rx, cy + ry);
    gradient.addColorStop(0, blue);
    gradient.addColorStop(0.34, white);
    gradient.addColorStop(0.67, gold);
    gradient.addColorStop(1, purple);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = (0.43 + (ring % 2) * 0.12) * glow;
    ctx.shadowColor = ring % 2 ? blue : gold;
    ctx.shadowBlur = 7 + activity * 7;
    ctx.strokeStyle = gradient;
    ctx.lineWidth = ribbonWidth + 3.2;
    ctx.stroke(path);
    ctx.globalAlpha = 0.92 * glow;
    ctx.shadowBlur = 2.5;
    ctx.lineWidth = ribbonWidth;
    ctx.strokeStyle = gradient;
    ctx.stroke(path);
    // Fine white specular edge gives the band a raised, metallic surface.
    ctx.globalAlpha = 0.38 * glow;
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(0.65, ribbonWidth * 0.19);
    ctx.strokeStyle = white;
    ctx.stroke(path);
  }
  ctx.restore();

  // Layer 4 — luminous depth accents and tiny orbital glints.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 54; i++) {
    const a = seeded(i, 8) * TAU + phase * (i % 2 ? 0.2 : -0.17);
    const r = radius * (0.58 + seeded(i, 2) * 0.54);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.55;
    ctx.globalAlpha = (0.15 + seeded(i, 5) * 0.45) * glow;
    ctx.fillStyle = i % 3 ? blue : gold;
    ctx.beginPath();
    ctx.arc(x, y, 0.5 + seeded(i, 9) * 1.15, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // Layer 5 — thirty fine rays and five principal light pillars.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 35; i++) {
    const a = i / 35 * TAU + phase * 0.08;
    const major = i % 7 === 0;
    const inner = radius * (major ? 0.12 : 0.42);
    const outer = radius * (major ? 1.02 : 0.78);
    const x1 = cx + Math.cos(a) * inner;
    const y1 = cy + Math.sin(a) * inner * 0.56;
    const x2 = cx + Math.cos(a) * outer;
    const y2 = cy + Math.sin(a) * outer * 0.56;
    const ray = ctx.createLinearGradient(x1, y1, x2, y2);
    ray.addColorStop(0, "rgba(255,255,255,0)");
    ray.addColorStop(0.55, i % 2 ? blue : gold);
    ray.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalAlpha = (major ? 0.31 : 0.105) * glow * (0.78 + 0.22 * Math.sin(phase + i));
    ctx.strokeStyle = ray;
    ctx.lineWidth = major ? 1.4 : 0.55;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.restore();

  // Layer 6 — central flash core, horizontal flare and layered radial light.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const coreRadius = radius * (0.18 + activity * 0.018);
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius * 2.2);
  core.addColorStop(0, light ? "rgba(255,255,255,.96)" : "rgba(255,255,244,1)");
  core.addColorStop(0.12, "rgba(255,239,196,.8)");
  core.addColorStop(0.36, light ? "rgba(222,187,126,.22)" : "rgba(255,220,157,.28)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.globalAlpha = glow;
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, coreRadius * 2.2, 0, TAU);
  ctx.fill();
  const flare = ctx.createLinearGradient(cx - radius * 0.58, cy, cx + radius * 0.58, cy);
  flare.addColorStop(0, "rgba(255,255,255,0)");
  flare.addColorStop(0.42, blue);
  flare.addColorStop(0.5, white);
  flare.addColorStop(0.58, gold);
  flare.addColorStop(1, "rgba(255,255,255,0)");
  ctx.globalAlpha = 0.55 * glow;
  ctx.fillStyle = flare;
  ctx.fillRect(cx - radius * 0.58, cy - 1.1, radius * 1.16, 2.2);
  ctx.restore();

  // Layer 7 — star dust, distant stars and soft bokeh.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const particleCount = width < 420 ? 430 : 820;
  for (let i = 0; i < particleCount; i++) {
    const a = seeded(i, 17) * TAU + phase * (0.025 + seeded(i, 6) * 0.07);
    const r = radius * (0.18 + seeded(i, 3) * 1.05);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.68;
    const twinkle = 0.22 + 0.78 * Math.abs(Math.sin(phase * (0.7 + seeded(i, 12)) + i));
    ctx.globalAlpha = (0.12 + seeded(i, 7) * 0.42) * twinkle * glow;
    ctx.fillStyle = i % 11 === 0 ? gold : i % 3 === 0 ? white : blue;
    ctx.beginPath();
    ctx.arc(x, y, 0.35 + seeded(i, 10) * 0.85, 0, TAU);
    ctx.fill();
  }
  for (let i = 0; i < 28; i++) {
    const a = seeded(i, 28) * TAU + phase * 0.035;
    const r = radius * (0.35 + seeded(i, 31) * 0.82);
    ctx.globalAlpha = 0.055 * glow;
    ctx.fillStyle = i % 2 ? blue : gold;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.65, 2 + seeded(i, 33) * 4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // Layer 8 — touch shockwave; radius and opacity are deterministic.
  if (shock > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const waveRadius = radius * (0.2 + (1 - shock) * 1.9);
    ctx.globalAlpha = clamp(shock, 0, 1) * 0.72;
    ctx.strokeStyle = white;
    ctx.shadowColor = blue;
    ctx.shadowBlur = 15;
    ctx.lineWidth = 1.5 + shock * 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, waveRadius, waveRadius * 0.58, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

export function FridayOrbVisual({ state = "standby", audioLevel = 0 }: FridayOrbVisualProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activityRef = useRef(0);
  const shockRef = useRef(0);
  const shockStartedRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !ctx) return;

    let frame = 0;
    let last = 0;
    let elapsed = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let visible = !document.hidden;
    let theme: SigilTheme = document.documentElement.classList.contains("dark") ||
      document.body.classList.contains("dark") ? "dark" : "light";

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const themeObserver = new MutationObserver(() => {
      theme = document.documentElement.classList.contains("dark") ||
        document.body.classList.contains("dark") ? "dark" : "light";
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "data-theme"] });

    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) shockStartedRef.current = performance.now();
    };
    canvas.addEventListener("pointerdown", onPointer);

    const onVisibility = () => {
      visible = !document.hidden;
      last = 0;
      if (visible && !frame) frame = requestAnimationFrame(draw);
      if (!visible && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };

    const draw = (now: number) => {
      frame = 0;
      if (!visible) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      elapsed = (elapsed + dt) % 6;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const target = Math.max(
        audioLevel,
        state === "listening" ? 0.38 : state === "thinking" ? 0.5 : state === "speaking" ? 0.72 : state === "completed" ? 0.3 : 0.12,
      );
      activityRef.current += (clamp(target, 0, 1) - activityRef.current) * Math.min(1, dt * 5);
      const age = shockStartedRef.current === null ? 2 : (now - shockStartedRef.current) / 1000;
      shockRef.current = age < 1.5 ? 1 - age / 1.5 : 0;
      if (age >= 1.5) shockStartedRef.current = null;
      drawGoldenSigil(ctx, width, height, elapsed * (reduced ? 0.45 : 1), theme, activityRef.current, shockRef.current);
      frame = requestAnimationFrame(draw);
    };

    document.addEventListener("visibilitychange", onVisibility);
    if (visible) frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      themeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [audioLevel, state]);

  return (
    <div className="friday-orb-visual" data-state={state} aria-hidden="true">
      <canvas ref={canvasRef} className="friday-sigil-canvas" />
    </div>
  );
}
