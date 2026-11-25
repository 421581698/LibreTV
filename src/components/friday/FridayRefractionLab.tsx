'use client';

import { useEffect, useRef, useState } from 'react';
import { refractKnownBackground } from '@/lib/friday-glass/refraction';

export function FridayRefractionLab({ light }: { light: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [enabled, setEnabled] = useState(true);
  const [strength, setStrength] = useState(20);
  const [changed, setChanged] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.min(900, Math.max(1, Math.floor(rect.width)));
      const height = 230;
      if (width < 10) return;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      // The complete source is generated locally; no cross-origin pixels or
      // unrelated DOM backdrop are inspected.
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, light ? '#f3d6ae' : '#164378');
      gradient.addColorStop(.48, light ? '#89c9d9' : '#3082a0');
      gradient.addColorStop(1, light ? '#c4a7ec' : '#6c358b');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      const bands = ['#ffce66', '#e86d97', '#59c9dd', '#8276e3', '#d5fa95'];
      for (let i = 0; i < 10; i += 1) {
        const x = i * 111 - 18;
        ctx.save();
        ctx.translate(x, -40);
        ctx.rotate(.22);
        ctx.fillStyle = bands[i % bands.length];
        ctx.globalAlpha = light ? .64 : .48;
        ctx.fillRect(0, 0, 27, height + 100);
        ctx.restore();
      }
      ctx.globalAlpha = .24;
      ctx.strokeStyle = light ? '#203040' : '#ffffff';
      for (let x = 0; x < width; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = light ? '#253544' : '#f5fcff';
      ctx.font = '700 21px system-ui, sans-serif';
      ctx.fillText('FRIDAY  ·  SOURCE-AWARE OPTICS', 22, 40);
      ctx.font = '500 12px system-ui, sans-serif';
      ctx.fillText('Same owned background, measured refraction inside the glass lens', 22, 61);
      const original = ctx.getImageData(0, 0, width, height);

      const centerX = width * .52;
      const centerY = height * .60;
      const radiusX = Math.min(230, width * .42);
      const radiusY = 67;
      const result = refractKnownBackground(original.data, width, height, {
        centerX, centerY, radiusX, radiusY,
        displacement: enabled ? strength : 0,
        chromatic: enabled ? 2 : 0,
      });
      const refracted = ctx.createImageData(width, height);
      refracted.data.set(result.pixels);
      ctx.putImageData(refracted, 0, 0);

      // A decorative edge highlight is independent of the measurable pixel warp.
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
      ctx.clip();
      const tint = ctx.createLinearGradient(0, centerY - radiusY, 0, centerY + radiusY);
      tint.addColorStop(0, 'rgba(255,255,255,.21)');
      tint.addColorStop(.55, 'rgba(255,255,255,.015)');
      tint.addColorStop(1, 'rgba(255,255,255,.055)');
      ctx.fillStyle = tint;
      ctx.fillRect(centerX - radiusX, centerY - radiusY, radiusX * 2, radiusY * 2);
      ctx.restore();
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,.65)';
      ctx.lineWidth = 2;
      ctx.stroke();
      setChanged(result.changedPixels);
    };
    draw();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(draw);
    observer?.observe(canvas);
    return () => observer?.disconnect();
  }, [enabled, strength, light]);

  return (
    <section aria-labelledby="friday-refraction-title" style={{ marginTop: 28 }}>
      <h2 id="friday-refraction-title" style={{ fontSize: 18, margin: '0 0 10px' }}>
        00 · Friday 自主折射引擎（Safari 可运行的受控背景）
      </h2>
      <p style={{ opacity: .75, fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
        采用与实际画面相同的原始像素作为输入，对镜片内进行空间位移与色散计算。
        数值为发生变化的像素数量，不代表可以读取任意网页元素背后的背景。
      </p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <button type="button" aria-pressed={enabled} onClick={() => setEnabled(value => !value)}
          style={{ padding: '9px 18px', border: '1px solid currentColor', borderRadius: 999 }}>
          {enabled ? '关闭折射（对照原图）' : '开启折射'}
        </button>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          折射强度 {strength}
          <input type="range" min="0" max="30" step="1" value={strength}
            onChange={event => setStrength(event.target.valueAsNumber)} />
        </label>
        <output aria-live="polite" data-refraction-pixel-difference={changed}>
          改变像素：{changed.toLocaleString()}
        </output>
      </div>
      <canvas ref={canvasRef} role="img" aria-label="受控彩色背景上的 Friday 玻璃折射光学对照"
        style={{ display: 'block', width: '100%', height: 230, borderRadius: 24, border: '1px solid rgba(255,255,255,.25)' }} />
      <p style={{ opacity: .68, marginTop: 10, fontSize: 12 }}>
        可重复核验：关闭时差异为 0；开启并提高强度时应出现非零差异。
        实际导航仅使用经浏览器验证的安全透明背景采样，不能将此实验的受控像素折射误认为任意 DOM 背景折射。
      </p>
    </section>
  );
}
