import {DEFAULT_SPATIAL_STATE,SPATIAL_SPACES,type SpatialSnapshot,type SpatialSpace} from '../core/types';
export const SPATIAL_HISTORY_KEY='__libretvSpatialOS';
export function activateSpace(state:SpatialSnapshot,next:SpatialSpace):SpatialSnapshot {
 if(!SPATIAL_SPACES.includes(next)||state.activeSpace===next)return state;
 return {...state,activeSpace:next,expandedPanel:null,focusedPanel:null,history:[...state.history,next].slice(-32),updatedAt:Date.now()};
}
export function goBackSpace(state:SpatialSnapshot):SpatialSnapshot {
 if(state.history.length<2)return {...state,expandedPanel:null,focusedPanel:null};
 const history=state.history.slice(0,-1);
 return {...state,activeSpace:history.at(-1)??DEFAULT_SPATIAL_STATE.activeSpace,history,expandedPanel:null,focusedPanel:null,updatedAt:Date.now()};
}
export function snapshotFromHistoryState(value:unknown):SpatialSnapshot|null {
 if(!value||typeof value!=='object')return null;
 const candidate=(value as Record<string,unknown>)[SPATIAL_HISTORY_KEY];
 if(!candidate||typeof candidate!=='object')return null;
 const state=(candidate as {snapshot?:unknown}).snapshot;
 if(!state||typeof state!=='object')return null;
 const snapshot=state as SpatialSnapshot;
 return snapshot.version===2&&SPATIAL_SPACES.includes(snapshot.activeSpace)?snapshot:null;
}
