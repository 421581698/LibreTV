'use client';
import {useSyncExternalStore} from 'react';
import {DEFAULT_SPATIAL_STATE,type SpatialSnapshot,type SpatialSpace,type SpatialPanel} from '../core/types';
import {activateSpace,goBackSpace} from './SpatialRouter';
import {setExpandedPanel} from './PanelManager';
import {readWorkspace,writeWorkspace} from './WorkspacePersistence';
let snapshot:SpatialSnapshot=DEFAULT_SPATIAL_STATE,hydrated=false;
const listeners=new Set<()=>void>();
function emit(){listeners.forEach(fn=>fn());}
function commit(next:SpatialSnapshot){snapshot=next;writeWorkspace(next);emit();}
function hydrate(){if(!hydrated&&typeof window!=='undefined'){snapshot=readWorkspace();hydrated=true;}return snapshot;}
export const spatialStateStore={
 getSnapshot:()=>hydrate(),
 subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
 activate(space:SpatialSpace){commit(activateSpace(hydrate(),space));},
 back(){commit(goBackSpace(hydrate()));},
 expand(panel:SpatialPanel|null){commit(setExpandedPanel(hydrate(),panel));},
 saveScroll(space:SpatialSpace,top:number){const current=hydrate();commit({...current,scrollPositions:{...current.scrollPositions,[space]:Math.max(0,top)}});},
 setFilter(key:string,value:string){const current=hydrate();commit({...current,filters:{...current.filters,[key]:value}});},
 reset(){commit(DEFAULT_SPATIAL_STATE);},
};
export function useSpatialState(){return useSyncExternalStore(spatialStateStore.subscribe,spatialStateStore.getSnapshot,()=>DEFAULT_SPATIAL_STATE);}
