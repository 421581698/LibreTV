'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';

const LiquidGlass = dynamic(() => import('liquid-glass-react'), { ssr: false });

type RefractionMode = 'standard' | 'polar' | 'prominent' | 'shader';

export default function IpadGlassLabPage() {
  const environmentRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<RefractionMode>('standard');
  const [light, setLight] = useState(false);
  const [globalMousePos, setGlobalMousePos] = useState({ x: 0, y: 0 });
  const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const container = environmentRef.current;
    if (!container) return;

    const handlePointerMove = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      setGlobalMousePos({ x: event.clientX, y: event.clientY });
      setMouseOffset({
        x: rect.width ? ((event.clientX - (rect.left + rect.width / 2)) / rect.width) * 100 : 0,
        y: rect.height ? ((event.clientY - (rect.top + rect.height / 2)) / rect.height) * 100 : 0,
      });
    };

    container.addEventListener('pointermove', handlePointerMove, { passive: true });
    return () => container.removeEventListener('pointermove', handlePointerMove);
  }, []);

  const pageStyle = {
    minHeight: '100dvh',
    padding: '32px clamp(18px, 4vw, 56px) 64px',
    color: light ? '#17181b' : '#f5f6f8',
    background: light
      ? 'radial-gradient(circle at 18% 12%, #ffffff 0, #e9edf3 42%, #d9e0e9 100%)'
      : 'radial-gradient(circle at 18% 12%, #343b49 0, #171b24 44%, #080a0e 100%)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
    transition: 'background 180ms ease, color 180ms ease',
  } as const;

  const stageStyle = {
    position: 'relative' as const,
    minHeight: 220,
    overflow: 'hidden' as const,
    borderRadius: 28,
    border: light ? '1px solid rgba(20,30,45,.12)' : '1px solid rgba(255,255,255,.12)',
    background: light
      ? 'linear-gradient(135deg, rgba(255,255,255,.72), rgba(208,219,232,.42))'
      : 'linear-gradient(135deg, rgba(255,255,255,.12), rgba(255,255,255,.035))',
  };

  const buttonStyle = {
    minHeight: 40,
    padding: '0 14px',
    borderRadius: 999,
    border: light ? '1px solid rgba(20,30,45,.16)' : '1px solid rgba(255,255,255,.16)',
    background: light ? 'rgba(255,255,255,.66)' : 'rgba(255,255,255,.08)',
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
  } as const;

  return (
    <main style={pageStyle}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <p style={{ margin: 0, opacity: 0.62, fontSize: 12, letterSpacing: '.16em', textTransform: 'uppercase' }}>LibreTV · iPad Edition</p>
            <h1 style={{ margin: '8px 0 0', fontSize: 'clamp(28px, 4vw, 42px)', letterSpacing: '-.045em' }}>Liquid Glass Lab</h1>
            <p style={{ margin: '8px 0 0', opacity: 0.7 }}>原版 liquid-glass-react 独立验证页，不影响正式导航与页面。</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={buttonStyle} onClick={() => setLight(value => !value)}>{light ? '切换深色环境' : '切换浅色环境'}</button>
            <select aria-label="折射模式" value={mode} onChange={event => setMode(event.target.value as RefractionMode)} style={{ ...buttonStyle, appearance: 'none' }}>
              <option value="standard">Standard</option>
              <option value="polar">Polar</option>
              <option value="prominent">Prominent</option>
              <option value="shader">Shader</option>
            </select>
          </div>
        </div>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 18, margin: '0 0 10px' }}>01 · 外部容器鼠标追踪</h2>
          <p style={{ opacity: 0.68, margin: '0 0 14px', fontSize: 13 }}>移动指针时，玻璃从父级环境容器读取坐标，而不是只监听玻璃自身。</p>
          <div ref={environmentRef} style={stageStyle}>
            <LiquidGlass
              mouseContainer={environmentRef}
              displacementScale={34}
              blurAmount={0.12}
              saturation={155}
              aberrationIntensity={1.1}
              elasticity={0.22}
              cornerRadius={28}
              padding="20px 28px"
              mode={mode}
              overLight={light}
              style={{ position: 'absolute', top: '50%', left: '50%', width: 300, minHeight: 96, boxSizing: 'border-box' }}
            >
              <div style={{ display: 'grid', gap: 7, color: light ? '#17202b' : '#fff' }}>
                <strong style={{ fontSize: 18 }}>共享环境容器</strong>
                <span style={{ fontSize: 13, opacity: 0.76 }}>任意 React children · 自定义圆角 · padding · 尺寸</span>
              </div>
            </LiquidGlass>
          </div>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 18, margin: '0 0 10px' }}>02 · 外部全局坐标注入</h2>
          <p style={{ opacity: 0.68, margin: '0 0 14px', fontSize: 13 }}>父级统一采集 Pointer 坐标，并同时注入 globalMousePos 与 mouseOffset。</p>
          <div style={stageStyle}>
            <LiquidGlass
              globalMousePos={globalMousePos}
              mouseOffset={mouseOffset}
              displacementScale={28}
              blurAmount={0.1}
              saturation={150}
              aberrationIntensity={0.9}
              elasticity={0.18}
              cornerRadius={999}
              padding="16px 26px"
              mode={mode}
              overLight={light}
              style={{ position: 'absolute', top: '50%', left: '50%', width: 280, minHeight: 68, boxSizing: 'border-box' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, color: light ? '#17202b' : '#fff' }}>
                <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 99, background: '#48a7ff', boxShadow: '0 0 14px rgba(72,167,255,.8)' }} />
                <strong>全局坐标驱动</strong>
                <span style={{ fontSize: 12, opacity: 0.65 }}>{Math.round(globalMousePos.x)}, {Math.round(globalMousePos.y)}</span>
              </div>
            </LiquidGlass>
          </div>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 18, margin: '0 0 10px' }}>03 · 多容器与内容组合</h2>
          <p style={{ opacity: 0.68, margin: '0 0 14px', fontSize: 13 }}>多个独立玻璃实例分别承载图标、文本、按钮等 React 内容。</p>
          <div style={{ ...stageStyle, minHeight: 190, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, flexWrap: 'wrap', padding: 24, boxSizing: 'border-box' }}>
            <LiquidGlass cornerRadius={999} padding="14px 20px" mode={mode} overLight={light} style={{ position: 'relative', top: 0, left: 0, transform: 'none' }}>
              <span style={{ color: light ? '#17202b' : '#fff', fontSize: 14 }}>⌂ 首页</span>
            </LiquidGlass>
            <LiquidGlass cornerRadius={18} padding="18px 20px" mode={mode} overLight={light} style={{ position: 'relative', top: 0, left: 0, transform: 'none' }}>
              <div style={{ color: light ? '#17202b' : '#fff', display: 'grid', gap: 5 }}>
                <strong>媒体卡片</strong>
                <span style={{ fontSize: 12, opacity: .7 }}>图片 / 标题 / 操作</span>
              </div>
            </LiquidGlass>
            <LiquidGlass cornerRadius={999} padding="14px 18px" mode={mode} overLight={light} style={{ position: 'relative', top: 0, left: 0, transform: 'none' }}>
              <span style={{ color: light ? '#17202b' : '#fff', fontSize: 14 }}>▶ 播放</span>
            </LiquidGlass>
          </div>
        </section>

        <p style={{ marginTop: 24, opacity: 0.55, fontSize: 12 }}>验证范围：原版四种折射模式、任意 children、尺寸与圆角、padding、外部鼠标容器、全局坐标、多容器、浅深色。Safari 的位移折射表现必须在真实 iPad 上单独验收。</p>
      </div>
    </main>
  );
}
