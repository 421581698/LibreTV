'use client';

import type { ReactNode } from 'react';

type HomeIntentCanvasProps = { variant: 'legacy' | 'v2'; children: ReactNode; voiceState?: 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING'; audioLevel?: number };

/** Spatial navigation is mounted at the application boundary; keep this slot presentational. */
export function HomeIntentCanvas({ variant, children, voiceState, audioLevel }: HomeIntentCanvasProps) {
  return <>{variant === 'v2' ? <span hidden data-friday-voice-state={voiceState} data-friday-audio-level={audioLevel} /> : children}</>;
}
