'use client';

import type { ReactNode } from 'react';
import { FridayHero } from '@/components/friday/FridayHero';

type VoiceState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING';

type HomeIntentCanvasProps = {
  variant: 'legacy' | 'v2';
  children: ReactNode;
  voiceState?: VoiceState;
  audioLevel?: number;
};

/** 首页意图画布：Friday 圆球和搜索入口始终留在首页原位。 */
export function HomeIntentCanvas({ variant, children, voiceState = 'IDLE', audioLevel = 0 }: HomeIntentCanvasProps) {
  return (
    <>
      {variant === 'v2' ? <FridayHero voiceState={voiceState} audioLevel={audioLevel} /> : null}
      {children}
    </>
  );
}
