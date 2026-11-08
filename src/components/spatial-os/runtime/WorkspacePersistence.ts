import {DEFAULT_SPATIAL_STATE,SPATIAL_SPACES,type PanelRect,type SpatialPanel,type SpatialSnapshot,type SpatialSpace,type SpatialPresentation,type SpaceWorkspaceState,type SpatialPanelEntry} from '../core/types';
export const WORKSPACE_KEY='libretv-spatial-os-v3';
const LEGACY_KEYS=['libretv-spatial-os-v2','libretv-spatial-os-v1'];
const PANELS:SpatialPanel[]=['search','sources','quality','tasks','history','settings'];
function validSpace(value:unknown):value is SpatialSpace{return SPATIAL_SPACES.includes(value as SpatialSpace);}
function validPanel(value:unknown):value is SpatialPanel{return PANELS.includes(value as SpatialPanel);}
function validPresentation(value:unknown):value is SpatialPresentation{return value==='lobby'||value==='space'||value==='task';}
function normalizeRect(value:unknown):PanelRect|null {
 if(!value||typeof value!=='object')return null;
 const r=value as Partial<PanelRect>;
 if(![r.x,r.y,r.width,r.height,r.zIndex].every(n=>typeof n==='number'&&Number.isFinite(n)))return null;
 return {x:Math.max(0,r.x!),y:Math.max(0,r.y!),width:Math.max(240,r.width!),height:Math.max(160,r.height!),zIndex:Math.max(1,r.zIndex!),dock:['floating','left','right','bottom'].includes(r.dock as string)?r.dock!:'floating',minimized:Boolean(r.minimized)};
}
function normalizeSpaceState(value:unknown,scrollFallback:number):SpaceWorkspaceState {
 if(!value||typeof value!=='object')return {expanded:false,scrollTop:scrollFallback,selectedItemId:null};
 const raw=value as Partial<SpaceWorkspaceState>;
 return {expanded:Boolean(raw.expanded),scrollTop:typeof raw.scrollTop==='number'&&Number.isFinite(raw.scrollTop)?Math.max(0,raw.scrollTop):scrollFallback,selectedItemId:typeof raw.selectedItemId==='string'?raw.selectedItemId:null};
}
export function migrateWorkspace(value:unknown):SpatialSnapshot {
 if(!value||typeof value!=='object')return DEFAULT_SPATIAL_STATE;
 const raw=value as Record<string,unknown>;
 const activeSpace=validSpace(raw.activeSpace)?raw.activeSpace:DEFAULT_SPATIAL_STATE.activeSpace;
 const history=Array.isArray(raw.history)?raw.history.filter(validSpace).slice(-32):[activeSpace];
 const scrollPositions:SpatialSnapshot['scrollPositions']={};
 if(raw.scrollPositions&&typeof raw.scrollPositions==='object')for(const [key,position] of Object.entries(raw.scrollPositions))if(validSpace(key)&&typeof position==='number'&&Number.isFinite(position))scrollPositions[key]=Math.max(0,position);
 const spaceStates={} as Record<SpatialSpace,SpaceWorkspaceState>;
 for(const space of SPATIAL_SPACES){const stored=(raw.spaceStates as Record<string,unknown>|undefined)?.[space];spaceStates[space]=normalizeSpaceState(stored,scrollPositions[space]??0);}
 const panelLayouts:SpatialSnapshot['panelLayouts']={};
 if(raw.panelLayouts&&typeof raw.panelLayouts==='object')for(const [key,rect] of Object.entries(raw.panelLayouts))if(validPanel(key)){const normalized=normalizeRect(rect);if(normalized)panelLayouts[key]=normalized;}
 const panelOrder=Array.isArray(raw.panelOrder)?raw.panelOrder.filter(validPanel):[];
 const expandedPanel=validPanel(raw.expandedPanel)?raw.expandedPanel:null;
 const focusedPanel=validPanel(raw.focusedPanel)?raw.focusedPanel:expandedPanel;
 const panelStack:SpatialPanelEntry[]=Array.isArray(raw.panelStack)?raw.panelStack.flatMap(item=>{if(!item||typeof item!=='object')return [];const entry=item as Partial<SpatialPanelEntry>;return validPanel(entry.panel)&&validSpace(entry.ownerSpace)&&typeof entry.openedAt==='number'?[{panel:entry.panel,ownerSpace:entry.ownerSpace,openedAt:entry.openedAt}]:[];}):(focusedPanel?[{panel:focusedPanel,ownerSpace:activeSpace,openedAt:typeof raw.updatedAt==='number'?raw.updatedAt:Date.now()}]:[]);
 const filters:Record<string,string>={};
 if(raw.filters&&typeof raw.filters==='object')for(const [key,val] of Object.entries(raw.filters))if(typeof val==='string')filters[key]=val;
 const rawTask=raw.taskContext&&typeof raw.taskContext==='object'?raw.taskContext as Record<string,unknown>:null;
 const taskContext=rawTask&&typeof rawTask.taskId==='string'?{taskId:rawTask.taskId,...(typeof rawTask.agentId==='string'?{agentId:rawTask.agentId}:{})}:null;
 return {version:3,activeSpace,presentation:validPresentation(raw.presentation)?raw.presentation:(raw.version===2&&activeSpace!=='cinematic'?'space':'lobby'),spaceStates,panelStack,taskContext,expandedPanel,focusedPanel,panelOrder,panelLayouts,history:history.length?history:[activeSpace],updatedAt:typeof raw.updatedAt==='number'?raw.updatedAt:Date.now(),revision:typeof raw.revision==='number'&&Number.isFinite(raw.revision)?Math.max(0,raw.revision):0,originId:typeof raw.originId==='string'?raw.originId:'migrated',scrollPositions,filters};
}
function readRaw(storage:Storage,key:string):string|null {try{return storage.getItem(key);}catch{return null;}}
export function readWorkspace():SpatialSnapshot {
 if(typeof window==='undefined')return DEFAULT_SPATIAL_STATE;
 try{const current=readRaw(window.localStorage,WORKSPACE_KEY);if(current){try{return migrateWorkspace(JSON.parse(current));}catch{try{window.localStorage.setItem(WORKSPACE_KEY+'.corrupt',current);}catch{};}}
  for(const key of LEGACY_KEYS){const legacy=readRaw(window.localStorage,key);if(!legacy)continue;try{const migrated=migrateWorkspace(JSON.parse(legacy));writeWorkspace(migrated);return migrated;}catch{try{window.localStorage.setItem(key+'.corrupt',legacy);}catch{}}}
  return DEFAULT_SPATIAL_STATE;
 }catch{return DEFAULT_SPATIAL_STATE;}
}
export function writeWorkspace(state:SpatialSnapshot):boolean {
 if(typeof window==='undefined')return false;
 try{window.localStorage.setItem(WORKSPACE_KEY,JSON.stringify({...state,version:3,updatedAt:Date.now()}));return true;}catch{return false;}
}
