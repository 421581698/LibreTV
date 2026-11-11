/** Stable, collision-safe identity for a resource within a specific source. */
export function favoriteIdFor(sourceKey: string, vodId: string): string {
  return JSON.stringify([sourceKey, vodId]);
}
