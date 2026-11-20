'use client';

import './pilot.css';

/**
 * Phase 2 isolated A/B pilot — Liquid Glass engine comparison.
 *
 * This route is intentionally self-contained. It does NOT import or modify any
 * existing page, component or CSS. It renders ONE LiquidGlassSurface panel and
 * toggles between:
 *   - ORIGINAL  : the project's current LiquidGlassSurface (backed by
 *                 liquid-glass-react@1.1.1 npm package, dynamically imported).
 *   - OPTIMIZED : the INIRU performance fork, vendored locally under
 *                 src/components/ui/liquid-glass-pilot/ so production is
 *                 untouched.
 *
 * Both sides are fed the exact same `panel` preset values as the project uses,
 * so the visual/perf comparison is fair. The default is ORIGINAL (safe
 * fallback); switch to OPTIMIZED via the button or ?engine=optimized.
 *
 * This file exists only on branch phase2/liquid-glass-ab-pilot.
 */

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LiquidGlassSurface } from '@/components/ui/liquid-glass';

// The optimized engine uses browser APIs (navigator, ResizeObserver, rAF) and
// must be client-only. SSR is disabled to avoid hydration mismatches.
const OptimizedGlass = dynamic(
  () => import('@/components/ui/liquid-glass-pilot').then((m) => m.default),
  { ssr: false, loading: () => <div className="pilot-loading">加载优化版引擎…</div> },
);

// Exact mirror of the project's `panel` preset for a fair A/B comparison.
const PANEL_PRESET = {
  displacementScale: 14,
  blurAmount: 0.08,
  saturation: 145,
  aberrationIntensity: 0.5,
  elasticity: 0,
  cornerRadius: 20,
  padding: '0',
  mode: 'standard',
} as const;

type Engine = 'original' | 'optimized';

type PerfSnapshot = {
  fps: number;
  memoryMB: number | null;
  jsHeapUsedMB: number | null;
  dpr: number;
  viewport: string;
  ua: string;
};

export default function Phase2GlassPilot() {
  const [engine, setEngine] = useState<Engine>('original');
  const [perf, setPerf] = useState<PerfSnapshot>({
    fps: 0, memoryMB: null, jsHeapUsedMB: null, dpr: 1, viewport: '', ua: '',
  });
  const [interactionMs, setInteractionMs] = useState<number | null>(null);
  const [mouseMoves, setMouseMoves] = useState(0);
  const [isSafari, setIsSafari] = useState<boolean | null>(null);
  const rafRef = useRef<number | null>(null);
  const framesRef = useRef(0);
  const lastRef = useRef(0);

  // Read engine from URL ?engine=optimized for easy真机 share/compare.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search).get('engine');
    if (q === 'optimized' || q === 'original') setEngine(q);
    setIsSafari(/^((?!chrome|android).)*safari/i.test(navigator.userAgent));
  }, []);

  // FPS counter.
  useEffect(() => {
    lastRef.current = performance.now();
    framesRef.current = 0;
    const tick = (t: number) => {
      framesRef.current += 1;
      if (t - lastRef.current >= 1000) {
        const fps = Math.round((framesRef.current * 1000) / (t - lastRef.current));
        const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
        setPerf({
          fps,
          memoryMB: mem ? +(mem.totalJSHeapSize / 1048576).toFixed(1) : null,
          jsHeapUsedMB: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : null,
          dpr: window.devicePixelRatio || 1,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          ua: navigator.userAgent,
        });
        framesRef.current = 0;
        lastRef.current = t;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  const switchEngine = useCallback((next: Engine) => {
    const t0 = performance.now();
    setEngine(next);
    // Measure time until React commits the switch (next paint).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setInteractionMs(+(performance.now() - t0).toFixed(1)));
    });
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('engine', next);
      window.history.replaceState(null, '', url.toString());
    }
  }, []);

  const onPointerMove = useCallback(() => setMouseMoves((n) => n + 1), []);

  return (
    <main className="pilot-root" onPointerMove={onPointerMove}>
      <div className="pilot-hero-bg" aria-hidden="true">
        <span className="pilot-blob pilot-blob-a" />
        <span className="pilot-blob pilot-blob-b" />
        <span className="pilot-blob pilot-blob-c" />
      </div>

      <header className="pilot-header">
        <div className="pilot-kicker">PHASE 2 · ISOLATED A/B PILOT</div>
        <h1>液态玻璃引擎对比试点</h1>
        <p className="pilot-sub">
          单个 panel 实例，逐项对比原版与 INIRU 优化版。默认原版（可随时回退）。
          <strong> 本页仅存在于独立分支，不影响生产环境。</strong>
        </p>
      </header>

      <section className="pilot-controls" aria-label="引擎切换">
        <div className="pilot-switch" role="group" aria-label="选择引擎">
          <button
            type="button"
            className={engine === 'original' ? 'is-active' : ''}
            onClick={() => switchEngine('original')}
            aria-pressed={engine === 'original'}
          >
            原版 <small>1.1.1 npm</small>
          </button>
          <button
            type="button"
            className={engine === 'optimized' ? 'is-active' : ''}
            onClick={() => switchEngine('optimized')}
            aria-pressed={engine === 'optimized'}
          >
            优化版 <small>INIRU fork</small>
          </button>
        </div>
        <div className="pilot-engine-badge">
          当前：<b>{engine === 'original' ? '原版 (原样回退点)' : 'INIRU 优化版'}</b>
        </div>
      </section>

      <section className="pilot-stage" aria-label="玻璃面板试样">
        {engine === 'original' ? (
          <LiquidGlassSurface as="div" variant="panel" className="pilot-panel" {...PANEL_PRESET}>
            <div className="pilot-panel-content">
              <div className="pilot-panel-icon">◍</div>
              <div>
                <div className="pilot-panel-title">原版引擎</div>
                <div className="pilot-panel-desc">liquid-glass-react@1.1.1 · standard 模式</div>
              </div>
            </div>
          </LiquidGlassSurface>
        ) : (
          <div className="pilot-panel liquid-glass" data-liquid-glass-engine="ready">
            <div className="liquid-glass-engine-slot" aria-hidden="true">
              <OptimizedGlass className="liquid-glass-engine-root" {...PANEL_PRESET}>
                <span aria-hidden="true" />
              </OptimizedGlass>
            </div>
            <div className="pilot-panel-content">
              <div className="pilot-panel-icon">◍</div>
              <div>
                <div className="pilot-panel-title">优化版引擎</div>
                <div className="pilot-panel-desc">INIRU fork · RAF + ResizeObserver</div>
              </div>
            </div>
          </div>
        )}
        <p className="pilot-hint">用手指在面板上滑动、点击，观察折射/高光跟随与跟手程度（在 Safari 里折射可能不可见，重点看交互响应与流畅度）。</p>
      </section>

      <section className="pilot-metrics" aria-label="实时性能读数">
        <div className="pilot-metric"><span>FPS</span><b>{perf.fps || '—'}</b></div>
        <div className="pilot-metric"><span>交互切换耗时</span><b>{interactionMs !== null ? `${interactionMs} ms` : '—'}</b></div>
        <div className="pilot-metric"><span>指针事件</span><b>{mouseMoves}</b></div>
        <div className="pilot-metric"><span>JS 堆(已用)</span><b>{perf.jsHeapUsedMB !== null ? `${perf.jsHeapUsedMB} MB` : '不支持'}</b></div>
        <div className="pilot-metric"><span>视口 / DPR</span><b>{perf.viewport} · {perf.dpr}</b></div>
        <div className="pilot-metric"><span>Safari 内核</span><b>{isSafari === null ? '检测中' : isSafari ? '是' : '否'}</b></div>
      </section>
      {perf.memoryMB === null && (
        <p className="pilot-note">注：Safari 不提供 <code>performance.memory</code>，内存项无法显示。请用 Safari 开发者工具 → 性能/内存 时间轴观察。</p>
      )}

      <section className="pilot-checklist" aria-label="真机自测清单">
        <h2>真机自测清单（请在 iPhone / iPad Safari 逐项完成）</h2>
        <ol>
          <li><b>视觉一致性</b>：交替切换 A/B，标题/文字/圆角/边框是否一致、有无白圆或黑块闪现。</li>
          <li><b>折射可见性</b>：在 Safari 下记录两版是否都看不到折射（预期一致）；切到桌面 Chrome 看折射是否出现。</li>
          <li><b>滚动流畅度</b>：快速上下滚动页面 10 秒，FPS 是否稳定、有无掉帧卡顿。</li>
          <li><b>点击响应</b>：连续点击切换按钮 20 次，是否跟手、有无延迟或错乱。</li>
          <li><b>布局稳定</b>：旋转横竖屏、缩放，面板是否错位或溢出。</li>
          <li><b>内存</b>：用 Safari 远程调试观察切换 50 次后内存是否持续上涨（检查缓存泄漏）。</li>
        </ol>
        <div className="pilot-verdict-box">
          <b>判定口径</b>：优化版需在「视觉一致 or 更好」「滚动/点击更流畅 or 持平」「内存无异常增长」前提下，才构成 GO；任一核心项退化则 NO-GO。
        </div>
      </section>

      <footer className="pilot-footer">
        独立分支 phase2/liquid-glass-ab-pilot · 不修改 main / 生产 Worker / 其他页面 · 原版为默认回退
      </footer>
    </main>
  );
}
