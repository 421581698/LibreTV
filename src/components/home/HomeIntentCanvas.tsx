'use client';

import type { ReactNode } from 'react';

type HomeIntentCanvasProps = { variant: 'legacy' | 'v2'; children: ReactNode; voiceState?: 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING'; audioLevel?: number };

/** Spatial navigation is mounted at the application boundary; keep this slot presentational. */
export function HomeIntentCanvas({ variant, children }: HomeIntentCanvasProps) {
  return <>{variant === 'v2' ? null : children}</>;
}
