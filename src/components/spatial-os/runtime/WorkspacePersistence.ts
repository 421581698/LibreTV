import {DEFAULT_SPATIAL_STATE,SPATIAL_SPACES,type PanelRect,type SpatialPanel,type SpatialSnapshot,type SpatialSpace} from '../core/types';
export const WORKSPACE_KEY='libretv-spatial-os-v2';
const LEGACY_KEYS=['libretv-spatial-os-v1'];
const PANELS:SpatialPanel[]=['search','sources','quality','tasks','history','settings'];
function validSpace(value:unknown):value is SpatialSpace{return SPATIAL_SPACES.includes(value as SpatialSpace);}
function validPanel(value:unknown):value is SpatialPanel{return PANELS.includes(value as SpatialPanel);}
function normalizeRect(value:unknown):PanelRect|null {
 if(!value||typeof value!=='object')return null;
 const r=value as Partial<PanelRect>;
 if(![r.x,r.y,r.width,r.height,r.zIndex].every(n=>typeof n==='number'&&Number.isFinite(n)))return null;
 return {x:Math.max(0,r.x!),y:Math.max(0,r.y!),width:Math.max(240,r.width!),height:Math.max(160,r.height!),zIndex:Math.max(1,r.zIndex!),dock:['floating','left','right','bottom'].includes(r.dock as string)?r.dock!:'floating',minimized:Boolean(r.minimized)};
}
export function migrateWorkspace(value:unknown):SpatialSnapshot {
 if(!value||typeof value!=='object')return DEFAULT_SPATIAL_STATE;
 const raw=value as Record<string,unknown>;
 const activeSpace=validSpace(raw.activeSpace)?raw.activeSpace:DEFAULT_SPATIAL_STATE.activeSpace;
 const history=Array.isArray(raw.history)?raw.history.filter(validSpace).slice(-32):[activeSpace];
 const panelLayouts:SpatialSnapshot['panelLayouts']={};
 if(raw.panelLayouts&&typeof raw.panelLayouts==='object')for(const [key,rect] of Object.entries(raw.panelLayouts))if(validPanel(key)){const normalized=normalizeRect(rect);if(normalized)panelLayouts[key]=normalized;}
 const panelOrder=Array.isArray(raw.panelOrder)?raw.panelOrder.filter(validPanel):[];
 const expandedPanel=validPanel(raw.expandedPanel)?raw.expandedPanel:null;
 const focusedPanel=validPanel(raw.focusedPanel)?raw.focusedPanel:expandedPanel;
 const scrollPositions:SpatialSnapshot['scrollPositions']={};
 if(raw.scrollPositions&&typeof raw.scrollPositions==='object')for(const [key,position] of Object.entries(raw.scrollPositions))if(validSpace(key)&&typeof position==='number'&&Number.isFinite(position))scrollPositions[key]=Math.max(0,position);
 const filters:Record<string,string>={};
 if(raw.filters&&typeof raw.filters==='object')for(const [key,val] of Object.entries(raw.filters))if(typeof val==='string')filters[key]=val;
 return {version:2,activeSpace,expandedPanel,focusedPanel,panelOrder,panelLayouts,history:history.length?history:[activeSpace],updatedAt:typeof raw.updatedAt==='number'?raw.updatedAt:Date.now(),scrollPositions,filters};
}
function readRaw(storage:Storage,key:string):string|null {try{return storage.getItem(key);}catch{return null;}}
export function readWorkspace():SpatialSnapshot {
 if(typeof window==='undefined')return DEFAULT_SPATIAL_STATE;
 try{
  const current=readRaw(window.localStorage,WORKSPACE_KEY);
  if(current){try{return migrateWorkspace(JSON.parse(current));}catch{try{window.localStorage.setItem(WORKSPACE_KEY+'.corrupt',current);}catch{};}}
  for(const key of LEGACY_KEYS){const legacy=readRaw(window.localStorage,key);if(!legacy)continue;try{const migrated=migrateWorkspace(JSON.parse(legacy));writeWorkspace(migrated);return migrated;}catch{try{window.localStorage.setItem(key+'.corrupt',legacy);}catch{}}}
  return DEFAULT_SPATIAL_STATE;
 }catch{return DEFAULT_SPATIAL_STATE;}
}
export function writeWorkspace(state:SpatialSnapshot):boolean {
 if(typeof window==='undefined')return false;
 try{window.localStorage.setItem(WORKSPACE_KEY,JSON.stringify({...state,version:2,updatedAt:Date.now()}));return true;}catch{return false;}
}
