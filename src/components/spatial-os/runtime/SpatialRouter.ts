import {DEFAULT_SPATIAL_STATE,SPATIAL_SPACES,type SpatialSnapshot,type SpatialSpace} from '../core/types';
export const SPATIAL_HISTORY_KEY='__libretvSpatialOS';
export function activateSpace(state:SpatialSnapshot,next:SpatialSpace):SpatialSnapshot {
 if(!SPATIAL_SPACES.includes(next))return state;
 const enteringSameSpace=state.activeSpace===next&&state.presentation!=='space';
 if(state.activeSpace===next&&!enteringSameSpace)return state;
 const history=state.activeSpace===next?state.history:[...state.history,next].slice(-32);
 return {...state,activeSpace:next,presentation:'space',spaceStates:{...state.spaceStates,[next]:{...state.spaceStates[next],expanded:true}},expandedPanel:null,focusedPanel:null,panelStack:state.panelStack.filter(entry=>entry.ownerSpace!==state.activeSpace),history,updatedAt:Date.now()};
}
export function returnToLobby(state:SpatialSnapshot):SpatialSnapshot {
 if(state.presentation==='lobby')return state;
 return {...state,presentation:'lobby',expandedPanel:null,focusedPanel:null,taskContext:null,updatedAt:Date.now()};
}
export function setSpatialPresentation(state:SpatialSnapshot,presentation:SpatialSnapshot['presentation']):SpatialSnapshot {
 if(!['lobby','space','task'].includes(presentation)||state.presentation===presentation)return state;
 return {...state,presentation,updatedAt:Date.now()};
}
export function goBackSpace(state:SpatialSnapshot):SpatialSnapshot {
 if(state.presentation==='task')return {...state,presentation:'space',taskContext:null,updatedAt:Date.now()};
 if(state.presentation==='space')return returnToLobby(state);
 if(state.history.length<2)return {...state,expandedPanel:null,focusedPanel:null};
 const history=state.history.slice(0,-1),activeSpace=history.at(-1)??DEFAULT_SPATIAL_STATE.activeSpace;
 return {...state,activeSpace,presentation:'space',history,expandedPanel:null,focusedPanel:null,updatedAt:Date.now()};
}
export function restoreHistorySnapshot(restored:SpatialSnapshot,current:SpatialSnapshot):SpatialSnapshot {
 return {...restored,scrollPositions:{...restored.scrollPositions,...current.scrollPositions}};
}
export function historyIndexFromState(value:unknown):number {
 if(!value||typeof value!=='object')return 0;
 const candidate=(value as Record<string,unknown>)[SPATIAL_HISTORY_KEY];
 if(!candidate||typeof candidate!=='object')return 0;
 const index=(candidate as {index?:unknown}).index;
 return typeof index==='number'&&Number.isInteger(index)&&index>=0?index:0;
}
export function snapshotFromHistoryState(value:unknown):SpatialSnapshot|null {
 if(!value||typeof value!=='object')return null;
 const candidate=(value as Record<string,unknown>)[SPATIAL_HISTORY_KEY];
 if(!candidate||typeof candidate!=='object')return null;
 const state=(candidate as {snapshot?:unknown}).snapshot;
 if(!state||typeof state!=='object')return null;
 const snapshot=state as SpatialSnapshot;
 return snapshot.version===3&&SPATIAL_SPACES.includes(snapshot.activeSpace)?snapshot:null;
}
export function shouldAcceptWorkspaceUpdate(current:Pick<SpatialSnapshot,'revision'|'updatedAt'|'originId'>,incoming:Pick<SpatialSnapshot,'revision'|'updatedAt'|'originId'>):boolean {
 if(incoming.revision!==current.revision)return incoming.revision>current.revision;
 if(incoming.updatedAt!==current.updatedAt)return incoming.updatedAt>current.updatedAt;
 return incoming.originId.localeCompare(current.originId)>0;
}
