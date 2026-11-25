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
  heroArtwork: Record<string, unknown>;
  siblingLayoutChain: Record<string, unknown>;
  searchFlow: Record<string, unknown>;
  overlapCandidates: Record<string, unknown>[];
  heroToNavGap: number | null;
};

function nodePath(element: Element | null): string | null {
  if (!element) return null;
  const id = element.id ? `#${element.id}` : '';
  const classes = typeof element.className === 'string'
    ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 5).map((name) => `.${name}`).join('')
    : '';
  return `${element.tagName.toLowerCase()}${id}${classes}`;
}

function measureNode(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const offsetParent = element.offsetParent instanceof HTMLElement ? element.offsetParent : null;
  return {
    path: nodePath(element),
    top: Number(rect.top.toFixed(1)),
    bottom: Number(rect.bottom.toFixed(1)),
    left: Number(rect.left.toFixed(1)),
    right: Number(rect.right.toFixed(1)),
    rectHeight: Number(rect.height.toFixed(1)),
    rectWidth: Number(rect.width.toFixed(1)),
    offsetTop: element.offsetTop,
    offsetHeight: element.offsetHeight,
    scrollHeight: element.scrollHeight,
    offsetParent: nodePath(offsetParent),
    position: style.position,
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
    height: style.height,
    minHeight: style.minHeight,
    maxHeight: style.maxHeight,
    margin: style.margin,
    padding: style.padding,
    transform: style.transform,
    translate: style.translate,
    flexDirection: style.flexDirection,
    flex: style.flex,
    alignItems: style.alignItems,
    justifyContent: style.justifyContent,
    rowGap: style.rowGap,
    gridTemplateRows: style.gridTemplateRows,
    contain: style.contain,
    contentVisibility: style.contentVisibility,
  };
}

function measureElement(selector: string) {
  const element = document.querySelector<HTMLElement>(selector);
  return element ? measureNode(element) : { missing: true, selector };
}

function collectSubtree(element: Element, depth = 0): Record<string, unknown> {
  const htmlElement = element as HTMLElement;
  const children = Array.from(element.children).filter((child) => child instanceof HTMLElement) as HTMLElement[];
  return {
    ...measureNode(htmlElement),
    childCount: children.length,
    children: depth < 3 ? children.map((child) => collectSubtree(child, depth + 1)) : undefined,
  };
}

function collectSiblingLayoutChain(root: HTMLElement, main: HTMLElement | null) {
  const rootChildren = Array.from(root.children).filter((child) => child instanceof HTMLElement) as HTMLElement[];
  const mainPreviousSiblings: HTMLElement[] = [];
  const mainNextSiblings: HTMLElement[] = [];
  if (main) {
    let previous = main.previousElementSibling;
    while (previous) {
      if (previous instanceof HTMLElement) mainPreviousSiblings.unshift(previous);
      previous = previous.previousElementSibling;
    }
    let next = main.nextElementSibling;
    while (next) {
      if (next instanceof HTMLElement) mainNextSiblings.push(next);
      next = next.nextElementSibling;
    }
  }

  return {
    root: {
      ...measureNode(root),
      display: getComputedStyle(root).display,
      childOrder: rootChildren.map((child, index) => ({
        index,
        ...measureNode(child),
      })),
      childSubtrees: rootChildren.map((child) => collectSubtree(child)),
    },
    main: main ? {
      node: measureNode(main),
      previousSiblings: mainPreviousSiblings.map(measureNode),
      nextSiblings: mainNextSiblings.map(measureNode),
      ancestors: (() => {
        const ancestors: Record<string, unknown>[] = [];
        let parent = main.parentElement;
        while (parent && ancestors.length < 8) {
          ancestors.push(measureNode(parent));
          parent = parent.parentElement;
        }
        return ancestors;
      })(),
    } : { missing: true },
    documentFlow: {
      body: measureElement('body'),
      html: measureElement('html'),
      bodyChildren: Array.from(document.body.children)
        .filter((child) => child instanceof HTMLElement)
        .map((child, index) => ({ index, ...measureNode(child as HTMLElement) })),
    },
  };
}

function collectSearchFlow() {
  const heading = document.querySelector<HTMLElement>('.ipad-edition__page-heading');
  const form = document.querySelector<HTMLElement>('.ipad-edition__search-form');
  const page = document.querySelector<HTMLElement>('.ipad-edition__search-page');
  const headingRect = heading?.getBoundingClientRect() ?? null;
  const formRect = form?.getBoundingClientRect() ?? null;
  const gap = headingRect && formRect ? {
    top: headingRect.bottom,
    bottom: formRect.top,
    left: Math.max(0, page?.getBoundingClientRect().left ?? 0),
    right: Math.min(window.innerWidth, page?.getBoundingClientRect().right ?? window.innerWidth),
  } : null;
  return {
    page: page ? measureNode(page) : { missing: true },
    heading: heading ? measureNode(heading) : { missing: true },
    form: form ? measureNode(form) : { missing: true },
    gap: gap ? {
      top: Number(gap.top.toFixed(1)),
      bottom: Number(gap.bottom.toFixed(1)),
      height: Number((gap.bottom - gap.top).toFixed(1)),
      left: Number(gap.left.toFixed(1)),
      right: Number(gap.right.toFixed(1)),
    } : null,
  };
}

function collectOverlayCandidates() {
  const heading = document.querySelector<HTMLElement>('.ipad-edition__page-heading');
  const form = document.querySelector<HTMLElement>('.ipad-edition__search-form');
  const page = document.querySelector<HTMLElement>('.ipad-edition__search-page');
  const headingRect = heading?.getBoundingClientRect();
  const formRect = form?.getBoundingClientRect();
  const pageRect = page?.getBoundingClientRect();
  if (!headingRect || !formRect || !pageRect) return [];

  const gapTop = headingRect.bottom;
  const gapBottom = formRect.top;
  const candidates: Record<string, unknown>[] = [];
  const elements = Array.from(document.querySelectorAll<HTMLElement>('body *'));
  for (const element of elements) {
    if (element.closest('[aria-label="iPad 页面布局诊断"]')) continue;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width < 12 || rect.height < 12) continue;
    const overlapsGap = rect.bottom > gapTop && rect.top < gapBottom &&
      rect.right > pageRect.left && rect.left < pageRect.right;
    const isPositioned = style.position === 'fixed' || style.position === 'absolute' || style.position === 'sticky';
    const hasStacking = style.zIndex !== 'auto';
    const hasShape = style.borderRadius !== '0px' && style.borderRadius !== '0';
    const background = style.backgroundColor;
    const hasPaint = background !== 'rgba(0, 0, 0, 0)' || style.backgroundImage !== 'none' ||
      style.boxShadow !== 'none' || style.border !== '0px none rgb(0, 0, 0)';
    const before = getComputedStyle(element, '::before');
    const after = getComputedStyle(element, '::after');
    const pseudoPaint = [before, after].some((pseudo) =>
      pseudo.content !== 'none' && pseudo.content !== 'normal' &&
      (pseudo.backgroundColor !== 'rgba(0, 0, 0, 0)' || pseudo.backgroundImage !== 'none' || pseudo.border !== '0px none rgb(0, 0, 0)')
    );
    if (!overlapsGap && !(isPositioned && hasStacking && hasShape && hasPaint) && !pseudoPaint) continue;
    candidates.push({
      ...measureNode(element),
      zIndex: style.zIndex,
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      pointerEvents: style.pointerEvents,
      overlapsHeadingToSearchGap: overlapsGap,
      before: {
        content: before.content,
        display: before.display,
        position: before.position,
        width: before.width,
        height: before.height,
        backgroundColor: before.backgroundColor,
        backgroundImage: before.backgroundImage,
        borderRadius: before.borderRadius,
      },
      after: {
        content: after.content,
        display: after.display,
        position: after.position,
        width: after.width,
        height: after.height,
        backgroundColor: after.backgroundColor,
        backgroundImage: after.backgroundImage,
        borderRadius: after.borderRadius,
      },
    });
    if (candidates.length >= 100) break;
  }
  return candidates;
}

function collectSnapshot(): LayoutSnapshot {
  const nav = document.querySelector<HTMLElement>('.ipad-nav__topbar');
  const hero = document.querySelector<HTMLElement>('.ipad-edition__cinema-hero');
  const root = document.querySelector<HTMLElement>('.ipad-edition');
  const main = document.querySelector<HTMLElement>('.ipad-edition__main');
  const viewport = window.visualViewport;
  const artwork = hero?.querySelector<HTMLElement>('.ipad-edition__cinema-hero-media');
  const posterImage = hero?.querySelector<HTMLImageElement>('.ipad-edition__cinema-hero-poster img');
  const heroArtwork = {
    mode: artwork?.dataset.artworkMode ?? null,
    targetWidthPx: Number(artwork?.dataset.posterResolutionTarget ?? 1200),
    poster: posterImage ? {
      complete: posterImage.complete,
      naturalWidth: posterImage.naturalWidth,
      naturalHeight: posterImage.naturalHeight,
      resolutionTier: posterImage.dataset.resolutionTier ?? 'unavailable',
      meets1200px: posterImage.naturalWidth >= 1200,
      currentSrc: (posterImage.currentSrc || posterImage.src || '').slice(0, 180),
    } : { missing: true },
  };
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
      sidebar: measureElement('.ipad-nav__sidebar'),
      edgeSwipeZone: measureElement('.ipad-nav__edge-swipe-zone'),
      scrim: measureElement('.ipad-nav__scrim'),
      root: measureElement('.ipad-edition'),
      main: measureElement('.ipad-edition__main'),
      home: measureElement('.ipad-edition__home'),
      hero: measureElement('.ipad-edition__cinema-hero'),
    },
    heroArtwork,
    siblingLayoutChain: root ? collectSiblingLayoutChain(root, main) : { missingRoot: true },
    searchFlow: collectSearchFlow(),
    overlapCandidates: collectOverlayCandidates(),
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
        <strong style={{ fontSize: 12 }}>iPad Layout Debug · 兄弟节点与布局链</strong>
        <button type="button" onClick={copySnapshot} style={{ border: '1px solid #8793a5', borderRadius: 7, padding: '5px 9px', background: '#263448', color: 'white' }}>
          {copied ? '已复制' : '复制 JSON'}
        </button>
      </div>
      <div style={{ marginBottom: 6, color: snapshot.heroToNavGap === null || snapshot.heroToNavGap > 60 ? '#ffc66d' : '#9de4b2' }}>
        导航底部 → Hero 顶部间距：{snapshot.heroToNavGap === null ? '无法计算（元素缺失）' : `${snapshot.heroToNavGap}px`}
      </div>
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#e6edf7' }}>{json}</pre>
      <div style={{ marginTop: 6, color: '#aab6c7' }}>仅用于独立 Preview 诊断；刷新页面可关闭（移除 URL 参数即可）。</div>
    </section>
  );
}
