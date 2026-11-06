'use client';

import { FridayOrbVisual } from '@/components/friday/FridayOrbVisual';

/**
 * Friday 首页主入口。
 * 通过统一的 toggle-friday-panel 事件连接唯一挂载的 AIFloatingBall，
 * 不在此组件重复创建语音控制器。
 */
export function FridayHero() {
  const openFridayVoice = () => {
    window.dispatchEvent(
      new CustomEvent('toggle-friday-panel', {
        detail: { reset: false, listen: true, immersive: true },
      }),
    );
  };

  return (
    <section className="friday-hero-v2" aria-label="Friday AI 影视助手">
      <p className="friday-hero-eyebrow">FRIDAY · AI ASSISTANT</p>
      <h1 className="friday-hero-title">今天想看什么？</h1>
      <button
        type="button"
        className="friday-hero-orb-button"
        onClick={openFridayVoice}
        aria-label="点击打开 Friday 沉浸式语音助手"
      >
        <span className="friday-hero-orb">
          <FridayOrbVisual />
        </span>
        <span className="friday-hero-orb-label">点击圆球，开启 Friday</span>
      </button>
    </section>
  );
}
