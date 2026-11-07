'use client';

import { useEffect, useState } from 'react';
import { FridayOrbVisual } from '@/components/friday/FridayOrbVisual';

type VoiceState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING';

/** 首页唯一 Friday 语音入口；状态变化只改变圆球，不创建面板或遮罩。 */
export function FridayHero({ voiceState = 'IDLE' }: { voiceState?: VoiceState }) {
  const toggleVoice = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    window.dispatchEvent(new CustomEvent('friday-home-orb-toggle'));
  };

  const labels: Record<VoiceState, string> = {
    IDLE: '点击圆球开始说话',
    LISTENING: '正在聆听，请说出你想看的影片',
    THINKING: '正在为你寻找…',
    SPEAKING: 'Friday 正在回答',
  };

  return (
    <section className="friday-hero-v2" aria-label="Friday AI 影视助手" data-state={voiceState.toLowerCase()}>
      <p className="friday-hero-eyebrow">FRIDAY · AI ASSISTANT</p>
      <h1 className="friday-hero-title">今天想看什么？</h1>
      <button
        type="button"
        className={`friday-hero-orb-button friday-home-orb-${voiceState.toLowerCase()}`}
        onClick={toggleVoice}
        aria-label={labels[voiceState]}
        aria-pressed={voiceState === 'LISTENING'}
      >
        <span className="friday-hero-orb">
          <FridayOrbVisual state={voiceState.toLowerCase() as 'standby' | 'listening' | 'thinking' | 'speaking'} />
        </span>
        <span className="friday-hero-orb-label" role="status" aria-live="polite">{labels[voiceState]}</span>
      </button>
    </section>
  );
}
