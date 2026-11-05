'use client';

import { useEffect, useState } from 'react';
import { FridayOrbVisual } from '@/components/friday/FridayOrbVisual';

type OrbState = 'standby' | 'listening' | 'thinking' | 'speaking' | 'completed';

/**
 * Friday 首页主视觉。
 * 语音入口统一收敛到下方 AI 搜索框的麦克风按钮，球体只负责状态氛围展示。
 */
export function FridayHero() {
  const [orbState, setOrbState] = useState<OrbState>('standby');

  useEffect(() => {
    const handleOrbState = (event: Event) => {
      const next = (event as CustomEvent<{ state?: OrbState }>).detail?.state;
      if (next && ['standby', 'listening', 'thinking', 'speaking', 'completed'].includes(next)) {
        setOrbState(next);
      }
    };
    window.addEventListener('friday-orb-state', handleOrbState);
    return () => window.removeEventListener('friday-orb-state', handleOrbState);
  }, []);

  return (
    <section className="friday-hero-v2" aria-label="Friday AI 影视助手">
      <p className="friday-hero-eyebrow">FRIDAY · AI ASSISTANT</p>
      <h1 className="friday-hero-title">今天想看什么？</h1>
      <div className="friday-hero-orb" aria-hidden="true">
        <FridayOrbVisual state={orbState} />
        {orbState === 'listening' && <span className="friday-orb-status">Listening...</span>}
      </div>
    </section>
  );
}
