export const SPATIAL_SPACES = ['cinematic','intelligence','resources','identity'] as const;
export type SpatialSpace = (typeof SPATIAL_SPACES)[number];
export type SpatialPanel = 'search'|'sources'|'quality'|'tasks'|'history'|'settings';
export type FridayVisualState = 'idle'|'listening'|'thinking'|'executing'|'speaking'|'error';
export type PanelDock = 'floating'|'left'|'right'|'bottom';
export type SpatialPresentation = 'lobby'|'space'|'task';
export interface PanelRect { x:number; y:number; width:number; height:number; dock:PanelDock; zIndex:number; minimized:boolean; }
export interface SpaceWorkspaceState { expanded:boolean; scrollTop:number; selectedItemId:string|null; }
export interface SpatialPanelEntry { panel:SpatialPanel; ownerSpace:SpatialSpace; openedAt:number; }
export interface SpatialTaskContext { taskId:string; agentId?:string; }
export interface SpatialSnapshot {
 version:3; activeSpace:SpatialSpace; presentation:SpatialPresentation;
 spaceStates:Record<SpatialSpace,SpaceWorkspaceState>; panelStack:SpatialPanelEntry[];
 taskContext:SpatialTaskContext|null; expandedPanel:SpatialPanel|null; focusedPanel:SpatialPanel|null;
 panelOrder:SpatialPanel[]; panelLayouts:Partial<Record<SpatialPanel,PanelRect>>;
 history:SpatialSpace[]; updatedAt:number; revision:number; originId:string;
 scrollPositions:Partial<Record<SpatialSpace,number>>; filters:Record<string,string>;
}
const EMPTY_SPACE_STATE:SpaceWorkspaceState={expanded:false,scrollTop:0,selectedItemId:null};
export const DEFAULT_SPATIAL_STATE:SpatialSnapshot={
 version:3,activeSpace:'cinematic',presentation:'lobby',
 spaceStates:{cinematic:{...EMPTY_SPACE_STATE},intelligence:{...EMPTY_SPACE_STATE},resources:{...EMPTY_SPACE_STATE},identity:{...EMPTY_SPACE_STATE}},
 panelStack:[],taskContext:null,expandedPanel:null,focusedPanel:null,panelOrder:[],panelLayouts:{},
 history:['cinematic'],updatedAt:0,revision:0,originId:'server',scrollPositions:{},filters:{}
};
