'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * The route declares which UI owns playback controls. The ordinary /watch
 * page defaults to Classic; only the iPad Edition route opts into Cinema V4.
 * The media engine stays shared without letting it choose the visible UI.
 */
export type PlaybackEdition = 'classic' | 'cinema-v4';
const PlaybackEditionContext = createContext<PlaybackEdition>('classic');

export function PlaybackEditionProvider({
  edition, children,
}: { edition: PlaybackEdition; children: ReactNode }) {
  return <PlaybackEditionContext.Provider value={edition}>{children}</PlaybackEditionContext.Provider>;
}

export function usePlaybackEdition() {
  return useContext(PlaybackEditionContext);
}
