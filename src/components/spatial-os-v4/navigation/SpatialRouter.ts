export const SPATIAL_SPACES = [
  "cinematic",
  "intelligence",
  "resources",
  "identity",
] as const;

export type SpatialSpace = (typeof SPATIAL_SPACES)[number];

export const SPATIAL_SPACE_META: Record<SpatialSpace, { label: string; shortLabel: string }> = {
  cinematic: { label: "影视", shortLabel: "影视" },
  intelligence: { label: "智能", shortLabel: "智能" },
  resources: { label: "资源宇宙", shortLabel: "资源" },
  identity: { label: "个人中心", shortLabel: "我的" },
};

export function isSpatialSpace(value: unknown): value is SpatialSpace {
  return typeof value === "string" && (SPATIAL_SPACES as readonly string[]).includes(value);
}

/** A view-level space change. It deliberately does not navigate or reload the page. */
export function resolveSpatialSpace(value: unknown, fallback: SpatialSpace = "cinematic"): SpatialSpace {
  return isSpatialSpace(value) ? value : fallback;
}
