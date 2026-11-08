'use client';

import { useEffect, useState } from 'react';
import type { AgentState, VoiceState } from '@/lib/friday/types';
import { getFridaySpatialVisualState } from '@/lib/friday/state';
import { FridayAssistantButton } from './FridayAssistantButton';

/** Adapts the existing reducer and movie-agent lifecycle to the V4 visual entry. */
export function SpatialFridayEntry() {
  const [voice, setVoice] = useState<VoiceState>('idle');
  const [agent, setAgent] = useState<AgentState>('idle');
  const [audioLevel, setAudioLevel] = useState(0);
  const state = getFridaySpatialVisualState({ voice, agent });

  useEffect(() => {
    const onRuntimeState = (event: Event) => {
      const detail = (event as CustomEvent<{ voice?: VoiceState; agent?: AgentState }>).detail;
      if (!detail) return;
      if (detail.voice) setVoice(detail.voice);
      if (detail.agent) setAgent(detail.agent);
    };
    const onVoiceError = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      if (message) setVoice('error');
      else setVoice((current) => current === 'error' ? 'idle' : current);
    };
    const onAudioLevel = (event: Event) => {
      const value = (event as CustomEvent<{ level?: number }>).detail?.level;
      if (typeof value === 'number' && Number.isFinite(value)) {
        const normalized = Math.max(0, Math.min(100, value));
        setAudioLevel((current) => Math.abs(current - normalized) >= 2 ? normalized : current);
      }
    };
    window.addEventListener('friday-home-runtime-state', onRuntimeState);
    window.addEventListener('friday-home-voice-error', onVoiceError);
    window.addEventListener('friday-audio-level', onAudioLevel);
    return () => {
      window.removeEventListener('friday-home-runtime-state', onRuntimeState);
      window.removeEventListener('friday-home-voice-error', onVoiceError);
      window.removeEventListener('friday-audio-level', onAudioLevel);
    };
  }, []);

  const activate = () => {
    window.dispatchEvent(new CustomEvent('friday-home-orb-toggle'));
  };

  return (
    <FridayAssistantButton
      state={state}
      audioLevel={audioLevel}
      onClick={activate}
      label={state === 'LISTENING' ? '停止 Friday 聆听' : '启动 Friday 语音助手'}
    />
  );
}
