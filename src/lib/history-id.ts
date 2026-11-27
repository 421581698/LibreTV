/** Unambiguous resource identity independent of separators inside a source or video ID. */
export function historyIdFor(sourceKey: string, vodId: string): string {
  return JSON.stringify([sourceKey, vodId]);
}

/** Include an integer episode index so distinct entries cannot collide. */
export function progressIdFor(sourceKey: string, vodId: string, episodeIndex: number): string {
  return JSON.stringify([sourceKey, vodId, episodeIndex]);
}
