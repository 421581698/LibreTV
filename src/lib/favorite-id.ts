/** Stable, collision-safe identity for a resource within a specific source. */
export function favoriteIdFor(sourceKey: string, vodId: string): string {
  return JSON.stringify([sourceKey, vodId]);
}

/**
 * Validate imported favorite records and rebuild their primary keys from the
 * source/video identity. Never trust an imported id: older exports may contain
 * delimiter-based keys that collide across providers.
 */
export function normalizeImportedFavorites<T extends {
  id: string;
  sourceKey: string;
  vodId: string;
  title: string;
  sourceName: string;
}>(input: unknown): T[] {
  if (!Array.isArray(input)) return [];

  return input
    .filter((item): item is T =>
      Boolean(item) &&
      typeof item === 'object' &&
      typeof (item as T).id === 'string' &&
      typeof (item as T).sourceKey === 'string' &&
      typeof (item as T).vodId === 'string' &&
      typeof (item as T).title === 'string' &&
      typeof (item as T).sourceName === 'string'
    )
    .map((item) => ({
      ...item,
      id: favoriteIdFor(item.sourceKey, item.vodId),
    }));
}
