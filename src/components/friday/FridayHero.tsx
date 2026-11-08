'use client';

import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import FridayOrb from '@/components/friday/FridayOrb';

type VoiceState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING';

/** 首页唯一 Friday 语音入口；状态变化只改变圆球，不创建面板或遮罩。 */
export function FridayHero({ voiceState = 'IDLE', audioLevel = 0 }: { voiceState?: VoiceState; audioLevel?: number }) {
  const [orbTheme, setOrbTheme] = useState<'light' | 'dark'>('light');
  const [conversation, setConversation] = useState<Array<{ id: number; role: 'user' | 'assistant'; text: string; interim?: boolean }>>([]);
  const [voiceError, setVoiceError] = useState('');

  // The app theme is controlled by the .dark class, not necessarily the OS color scheme.
  // Observe both document roots so FridayOrb always matches the actual UI theme.
  useEffect(() => {
    const syncTheme = () => {
      const dark = document.documentElement.classList.contains('dark')
        || document.body.classList.contains('dark');
      setOrbTheme(dark ? 'dark' : 'light');
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onReply = (event: Event) => {
      const value = (event as CustomEvent<{ text?: string }>).detail?.text?.trim();
      if (value) setConversation((items) => [...items, { id: Date.now() + Math.random(), role: 'assistant', text: value.slice(0, 1200) }].slice(-8));
    };
    const onTranscript = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; isFinal?: boolean }>).detail;
      const value = detail?.text?.trim();
      if (!value) return;
      setConversation((items) => {
        const next = [...items];
        const last = next[next.length - 1];
        if (last?.role === 'user' && last.interim) next[next.length - 1] = { ...last, text: value.slice(0, 500), interim: !detail.isFinal };
        else next.push({ id: Date.now() + Math.random(), role: 'user', text: value.slice(0, 500), interim: !detail.isFinal });
        return next.slice(-8);
      });
    };
    const onError = (event: Event) => {
      const value = (event as CustomEvent<{ message?: string }>).detail?.message;
      setVoiceError(typeof value === 'string' ? value : '');
    };
    window.addEventListener('friday-home-assistant-response', onReply);
    window.addEventListener('friday-home-transcript', onTranscript);
    window.addEventListener('friday-home-voice-error', onError);
    return () => {
      window.removeEventListener('friday-home-assistant-response', onReply);
      window.removeEventListener('friday-home-transcript', onTranscript);
      window.removeEventListener('friday-home-voice-error', onError);
    };
  }, []);

  const toggleVoice = (event: MouseEvent<HTMLButtonElement>) => {
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
      <button
        type="button"
        className={`friday-hero-orb-button friday-home-orb-${voiceState.toLowerCase()}`}
        onClick={toggleVoice}
        aria-label={labels[voiceState]}
        aria-pressed={voiceState === 'LISTENING'}
      >
        <span className="friday-hero-orb">
          <FridayOrb
            state={voiceState}
            audioLevel={audioLevel * 100}
            theme={orbTheme}
            showHud={false}
            interactive={false}
            quality={1}
            ariaLabel="Friday 金界全息能量核心"
          />
        </span>
        <span className="friday-hero-orb-label" role="status" aria-live="polite">{voiceError || labels[voiceState]}</span>
      </button>
      {conversation.length > 0 && (
        <div className="friday-home-conversation" role="log" aria-live="polite" aria-label="Friday 对话流">
          {conversation.map((message) => (
            <div key={message.id} className={`friday-home-message ${message.role === 'user' ? 'is-user' : 'is-assistant'}`}>
              <span className="friday-home-message-speaker">{message.role === 'user' ? '你' : 'Friday'}</span>
              <p>{message.text}{message.interim ? <span className="friday-home-message-pending"> …</span> : null}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
