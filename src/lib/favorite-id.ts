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
      typeof (item as T).sourceKey === 'string' && (item as T).sourceKey.trim().length > 0 &&
      typeof (item as T).vodId === 'string' && (item as T).vodId.trim().length > 0 &&
      typeof (item as T).title === 'string' && (item as T).title.trim().length > 0 &&
      typeof (item as T).sourceName === 'string' && (item as T).sourceName.trim().length > 0
    )
    .map((item) => ({
      ...item,
      id: favoriteIdFor(item.sourceKey, item.vodId),
    }));
}
