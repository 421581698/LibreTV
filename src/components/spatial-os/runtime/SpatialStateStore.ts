'use client';
import {useSyncExternalStore} from 'react';
import {DEFAULT_SPATIAL_STATE,type PanelDock,type PanelRect,type SpatialSnapshot,type SpatialSpace,type SpatialPanel} from '../core/types';
import {activateSpace,goBackSpace,historyIndexFromState,restoreHistorySnapshot,snapshotFromHistoryState,SPATIAL_HISTORY_KEY} from './SpatialRouter';
import {bringPanelToFront,placePanelAvoidingOverlap,setExpandedPanel,setPanelDock,setPanelRect} from './PanelManager';
import {readWorkspace,writeWorkspace,WORKSPACE_KEY,migrateWorkspace} from './WorkspacePersistence';
let snapshot:SpatialSnapshot=DEFAULT_SPATIAL_STATE,hydrated=false,historyBound=false,storageBound=false,historyIndex=0;
const listeners=new Set<()=>void>();
function emit(){listeners.forEach(fn=>fn());}
function persist(){writeWorkspace(snapshot);}
function commit(next:SpatialSnapshot){if(next===snapshot)return;snapshot={...next,updatedAt:Date.now()};persist();emit();}
function withHistoryMarker(value:unknown,state:SpatialSnapshot,index=historyIndex){return {...(value&&typeof value==='object'?value as Record<string,unknown>:{}),[SPATIAL_HISTORY_KEY]:{snapshot:state,index}};}
function hydrate(){
 if(!hydrated&&typeof window!=='undefined'){
  snapshot=readWorkspace();hydrated=true;historyIndex=historyIndexFromState(window.history.state);
  try{window.history.replaceState(withHistoryMarker(window.history.state,snapshot,historyIndex),'',window.location.href);}catch{}
 }
 return snapshot;
}
function onPopState(event:PopStateEvent){
 const restored=snapshotFromHistoryState(event.state);
 if(restored){historyIndex=historyIndexFromState(event.state);commit(restoreHistorySnapshot(migrateWorkspace(restored),snapshot));}
}
function bindHistory(){
 if(typeof window==='undefined'||historyBound)return;
 window.addEventListener('popstate',onPopState);historyBound=true;
}
function pushSpaceHistory(next:SpatialSnapshot){
 if(typeof window==='undefined')return;
 try{const nextIndex=historyIndex+1;window.history.pushState(withHistoryMarker(window.history.state,next,nextIndex),'',window.location.href);historyIndex=nextIndex;}catch{/* Embedded browsers may deny History API access. */}
}
function onStorage(event:StorageEvent){
 if(event.key!==WORKSPACE_KEY||!event.newValue)return;
 try{const incoming=migrateWorkspace(JSON.parse(event.newValue));if(incoming.updatedAt>=snapshot.updatedAt){snapshot=incoming;try{window.history.replaceState(withHistoryMarker(window.history.state,snapshot),'',window.location.href);}catch{};emit();}}catch{/* Ignore malformed cross-tab payloads. */}
}
function bindStorage(){if(typeof window!=='undefined'&&!storageBound){window.addEventListener('storage',onStorage);storageBound=true;}}
export const spatialStateStore={
 getSnapshot:()=>hydrate(),
 subscribe(listener:()=>void){hydrate();bindHistory();bindStorage();listeners.add(listener);return()=>{listeners.delete(listener);};},
 activate(space:SpatialSpace){const current=hydrate(),next=activateSpace(current,space);if(next!==current){commit(next);pushSpaceHistory(snapshot);}},
 back(){hydrate();if(typeof window!=='undefined'&&historyIndex>0){window.history.back();return;}const next=goBackSpace(snapshot);commit(next);if(typeof window!=='undefined')try{window.history.replaceState(withHistoryMarker(window.history.state,snapshot,historyIndex),'',window.location.href);}catch{}},
 expand(panel:SpatialPanel|null){commit(setExpandedPanel(hydrate(),panel));},
 focus(panel:SpatialPanel){commit(bringPanelToFront(hydrate(),panel));},
 dock(panel:SpatialPanel,dock:PanelDock){commit(setPanelDock(hydrate(),panel,dock));},
 setPanelRect(panel:SpatialPanel,rect:Partial<PanelRect>){commit(setPanelRect(hydrate(),panel,rect));},
 avoidPanelOverlap(panel:SpatialPanel,viewport:{width:number;height:number}){commit(placePanelAvoidingOverlap(hydrate(),panel,viewport));},
 saveScroll(space:SpatialSpace,top:number){const current=hydrate();commit({...current,scrollPositions:{...current.scrollPositions,[space]:Math.max(0,top)}});if(typeof window!=='undefined')try{window.history.replaceState(withHistoryMarker(window.history.state,snapshot,historyIndex),'',window.location.href);}catch{}},
 setFilter(key:string,value:string){const current=hydrate();commit({...current,filters:{...current.filters,[key]:value}});},
 reset(){const next={...DEFAULT_SPATIAL_STATE,updatedAt:Date.now()};commit(next);historyIndex=0;if(typeof window!=='undefined')try{window.history.replaceState(withHistoryMarker(window.history.state,next,historyIndex),'',window.location.href);}catch{}},
};
export function useSpatialState(){return useSyncExternalStore(spatialStateStore.subscribe,spatialStateStore.getSnapshot,()=>DEFAULT_SPATIAL_STATE);}
