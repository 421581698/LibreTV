export const SPATIAL_SPACES = ['cinematic','intelligence','resources','identity'] as const;
export type SpatialSpace = (typeof SPATIAL_SPACES)[number];
export type SpatialPanel = 'search'|'sources'|'quality'|'tasks'|'history'|'settings';
export type FridayVisualState = 'idle'|'listening'|'thinking'|'executing'|'speaking'|'error';
export type PanelDock = 'floating'|'left'|'right'|'bottom';
export interface PanelRect { x:number; y:number; width:number; height:number; dock:PanelDock; zIndex:number; minimized:boolean; }
export interface SpatialSnapshot {
 version:2;
 activeSpace:SpatialSpace;
 expandedPanel:SpatialPanel|null;
 focusedPanel:SpatialPanel|null;
 panelOrder:SpatialPanel[];
 panelLayouts:Partial<Record<SpatialPanel,PanelRect>>;
 history:SpatialSpace[];
 updatedAt:number;
 scrollPositions:Partial<Record<SpatialSpace,number>>;
 filters:Record<string,string>;
}
export const DEFAULT_SPATIAL_STATE:SpatialSnapshot={
 version:2,activeSpace:'cinematic',expandedPanel:null,focusedPanel:null,
 panelOrder:[],panelLayouts:{},history:['cinematic'],updatedAt:0,scrollPositions:{},filters:{}
};
