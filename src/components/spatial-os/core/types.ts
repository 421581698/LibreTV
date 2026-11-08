export const SPATIAL_SPACES = ['cinematic','intelligence','resources','identity'] as const;
export type SpatialSpace = (typeof SPATIAL_SPACES)[number];
export type SpatialPanel = 'search'|'sources'|'quality'|'tasks'|'history'|'settings';
export type FridayVisualState = 'idle'|'listening'|'thinking'|'executing'|'speaking'|'error';
export interface SpatialSnapshot { version:1; activeSpace:SpatialSpace; expandedPanel:SpatialPanel|null; history:SpatialSpace[]; updatedAt:number; }
export const DEFAULT_SPATIAL_STATE:SpatialSnapshot={version:1,activeSpace:'cinematic',expandedPanel:null,history:['cinematic'],updatedAt:0};
