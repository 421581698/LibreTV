import {DEFAULT_SPATIAL_STATE,SPATIAL_SPACES,type SpatialSnapshot,type SpatialSpace} from '../core/types';
const KEY='libretv-spatial-os-v1';
export function readWorkspace():SpatialSnapshot {
 if(typeof window==='undefined')return DEFAULT_SPATIAL_STATE;
 try {
  const raw=window.localStorage.getItem(KEY);if(!raw)return DEFAULT_SPATIAL_STATE;
  const value=JSON.parse(raw) as Partial<SpatialSnapshot>;
  if(value.version!==1||!SPATIAL_SPACES.includes(value.activeSpace as never))return DEFAULT_SPATIAL_STATE;
  const history:SpatialSpace[]=Array.isArray(value.history)?value.history.filter((x):x is SpatialSnapshot['activeSpace']=>SPATIAL_SPACES.includes(x as never)).slice(-8):['cinematic'];
  return {...DEFAULT_SPATIAL_STATE,...value,activeSpace:value.activeSpace as SpatialSnapshot['activeSpace'],history,expandedPanel:null,scrollPositions:value.scrollPositions??{},filters:value.filters??{}};
 } catch{return DEFAULT_SPATIAL_STATE;}
}
export function writeWorkspace(state:SpatialSnapshot):void {
 if(typeof window==='undefined')return;
 try{window.localStorage.setItem(KEY,JSON.stringify({...state,expandedPanel:null,updatedAt:Date.now()}));}catch{/* Storage can be unavailable or full. */}
}
