'use client';

import { useEffect, useState } from 'react';
import { FridayAssistantButton, type FridayAssistantVisualState } from './FridayAssistantButton';

/** Adapts existing Friday runtime events to the compact V4 entry; it owns no voice lifecycle. */
export function SpatialFridayEntry() {
  const [state, setState] = useState<FridayAssistantVisualState>('IDLE');
  const [audioLevel, setAudioLevel] = useState(0);

  useEffect(() => {
    const onVoiceState = (event: Event) => {
      const value = (event as CustomEvent<{ state?: string }>).detail?.state;
      if (value === 'LISTENING' || value === 'THINKING' || value === 'SPEAKING' || value === 'IDLE') {
        setState(value);
      }
    };
    const onVoiceError = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      setState(message ? 'ERROR' : 'IDLE');
    };
    const onAudioLevel = (event: Event) => {
      const value = (event as CustomEvent<{ level?: number }>).detail?.level;
      if (typeof value === 'number' && Number.isFinite(value)) {
        setAudioLevel(Math.max(0, Math.min(100, value)));
      }
    };
    window.addEventListener('friday-home-voice-state', onVoiceState);
    window.addEventListener('friday-home-voice-error', onVoiceError);
    window.addEventListener('friday-audio-level', onAudioLevel);
    return () => {
      window.removeEventListener('friday-home-voice-state', onVoiceState);
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
