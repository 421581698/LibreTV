'use client';

import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import FridayOrb from '@/components/friday/FridayOrb';
import { upsertFridaySubtitleLine } from '@/lib/friday/subtitles';

type VoiceState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING';

/** 首页唯一 Friday 语音入口；字幕始终位于圆球下方，不创建聊天面板或气泡。 */
export function FridayHero({ voiceState = 'IDLE', audioLevel = 0 }: { voiceState?: VoiceState; audioLevel?: number }) {
  const [orbTheme, setOrbTheme] = useState<'light' | 'dark'>('light');
  const [subtitleLines, setSubtitleLines] = useState<string[]>([]);
  const [voiceError, setVoiceError] = useState('');

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
      const value = (event as CustomEvent<{ text?: string }>).detail?.text;
      if (typeof value === 'string' && value.trim()) {
        setSubtitleLines((lines) => upsertFridaySubtitleLine(lines, 'assistant', value));
      }
    };
    const onTranscript = (event: Event) => {
      const value = (event as CustomEvent<{ text?: string }>).detail?.text;
      if (typeof value === 'string' && value.trim()) {
        setSubtitleLines((lines) => upsertFridaySubtitleLine(lines, 'user', value));
      }
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
      {subtitleLines.length > 0 && (
        <div
          className="friday-orb-response friday-orb-subtitles"
          role="log"
          aria-live="polite"
          aria-label="Friday 连续语音字幕"
        >
          {subtitleLines.join('\n')}
        </div>
      )}
    </section>
  );
}
