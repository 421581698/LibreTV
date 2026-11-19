'use client';

import { useEffect, useState } from 'react';

type LayoutSnapshot = {
  capturedAt: string;
  viewport: {
    innerWidth: number;
    innerHeight: number;
    visualWidth: number | null;
    visualHeight: number | null;
    visualOffsetTop: number | null;
    visualScale: number | null;
    scrollY: number;
    documentHeight: number;
    devicePixelRatio: number;
  };
  elements: Record<string, unknown>;
  heroToNavGap: number | null;
};

function measureElement(selector: string) {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) return { missing: true };
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return {
    top: Number(rect.top.toFixed(1)),
    bottom: Number(rect.bottom.toFixed(1)),
    height: Number(rect.height.toFixed(1)),
    width: Number(rect.width.toFixed(1)),
    position: style.position,
    heightStyle: style.height,
    minHeight: style.minHeight,
    paddingTop: style.paddingTop,
    paddingBottom: style.paddingBottom,
    marginTop: style.marginTop,
    overflow: style.overflow,
    overflowY: style.overflowY,
    transform: style.transform,
  };
}

function collectSnapshot(): LayoutSnapshot {
  const nav = document.querySelector<HTMLElement>('.ipad-nav__topbar');
  const hero = document.querySelector<HTMLElement>('.ipad-edition__hero');
  const viewport = window.visualViewport;
  return {
    capturedAt: new Date().toISOString(),
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      visualWidth: viewport ? Number(viewport.width.toFixed(1)) : null,
      visualHeight: viewport ? Number(viewport.height.toFixed(1)) : null,
      visualOffsetTop: viewport ? Number(viewport.offsetTop.toFixed(1)) : null,
      visualScale: viewport ? Number(viewport.scale.toFixed(2)) : null,
      scrollY: Number(window.scrollY.toFixed(1)),
      documentHeight: document.documentElement.scrollHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    elements: {
      nav: measureElement('.ipad-nav__topbar'),
      root: measureElement('.ipad-edition'),
      main: measureElement('.ipad-edition__main'),
      home: measureElement('.ipad-edition__home'),
      hero: measureElement('.ipad-edition__hero'),
    },
    heroToNavGap: nav && hero
      ? Number((hero.getBoundingClientRect().top - nav.getBoundingClientRect().bottom).toFixed(1))
      : null,
  };
}

export function IpadLayoutDiagnostics() {
  const [enabled, setEnabled] = useState(false);
  const [snapshot, setSnapshot] = useState<LayoutSnapshot | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setEnabled(params.get('__layout_debug') === '1');
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const update = () => setSnapshot(collectSnapshot());
    update();
    const interval = window.setInterval(update, 800);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [enabled]);

  if (!enabled || !snapshot) return null;

  const json = JSON.stringify(snapshot, null, 2);
  const copySnapshot = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section
      aria-label="iPad 页面布局诊断"
      style={{
        position: 'fixed',
        zIndex: 2147483000,
        left: 8,
        right: 8,
        bottom: 'max(8px, env(safe-area-inset-bottom))',
        maxHeight: '44vh',
        overflow: 'auto',
        padding: '10px 12px',
        border: '1px solid rgba(255,255,255,.28)',
        borderRadius: 12,
        background: 'rgba(8,12,20,.94)',
        color: '#f4f7fb',
        boxShadow: '0 8px 32px rgba(0,0,0,.38)',
        font: '11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, position: 'sticky', top: -10, padding: '2px 0 8px', background: 'rgba(8,12,20,.98)' }}>
        <strong style={{ fontSize: 12 }}>iPad Layout Debug · 实时数据</strong>
        <button type="button" onClick={copySnapshot} style={{ border: '1px solid #8793a5', borderRadius: 7, padding: '5px 9px', background: '#263448', color: 'white' }}>
          {copied ? '已复制' : '复制 JSON'}
        </button>
      </div>
      <div style={{ marginBottom: 6, color: snapshot.heroToNavGap !== null && snapshot.heroToNavGap > 60 ? '#ffc66d' : '#9de4b2' }}>
        导航底部 → Hero 顶部间距：{snapshot.heroToNavGap === null ? '无法计算（元素缺失）' : `${snapshot.heroToNavGap}px`}
      </div>
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#e6edf7' }}>{json}</pre>
      <div style={{ marginTop: 6, color: '#aab6c7' }}>仅用于独立 Preview 诊断；刷新页面可关闭（移除 URL 参数即可）。</div>
    </section>
  );
}
