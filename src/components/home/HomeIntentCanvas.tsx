'use client';

import type { ReactNode } from 'react';
import { FridayHero } from '@/components/friday/FridayHero';
import { FridaySpatialOS } from '@/components/spatial-os/FridaySpatialOS';

type VoiceState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING';

type HomeIntentCanvasProps = {
  variant: 'legacy' | 'v2';
  children: ReactNode;
  voiceState?: VoiceState;
  audioLevel?: number;
};

/** Spatial OS shell wraps the existing homepage and keeps the Friday core mounted. */
export function HomeIntentCanvas({ variant, children, voiceState, audioLevel }: HomeIntentCanvasProps) {
  const friday = variant === 'v2' ? <FridayHero voiceState={voiceState} audioLevel={audioLevel} /> : null;
  return <FridaySpatialOS friday={friday}>{children}</FridaySpatialOS>;
}
