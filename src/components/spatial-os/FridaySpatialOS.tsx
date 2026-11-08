'use client';
import {useEffect} from 'react';
import type {CSSProperties,ReactNode} from 'react';
import {SpatialEnvironment} from './environment/SpatialEnvironment';
import {CinematicPortal} from './portals/CinematicPortal';
import {ResourcePortal} from './portals/ResourcePortal';
import {IntelligencePortal} from './portals/IntelligencePortal';
import {IdentityPortal} from './portals/IdentityPortal';
import {SpatialPanelWorkspace} from './SpatialPanelWorkspace';
import {useSpatialState,spatialStateStore} from './runtime/SpatialStateStore';
import type {SpatialSpace} from './core/types';

const SPACES:{id:SpatialSpace;label:string;sub:string;position:string}[]=[
 {id:'cinematic',label:'CINEMATIC',sub:'影视空间',position:'left-0 top-0'},
 {id:'intelligence',label:'INTELLIGENCE',sub:'智能空间',position:'right-0 top-0'},
 {id:'resources',label:'RESOURCE UNIVERSE',sub:'资源宇宙',position:'left-0 bottom-0'},
 {id:'identity',label:'IDENTITY',sub:'个人空间',position:'right-0 bottom-0'},
];
const CORE_STYLE:CSSProperties={transition:'transform 700ms cubic-bezier(.2,.8,.2,1),opacity 500ms ease'};
export function FridaySpatialOS({children,friday}:{children:ReactNode;friday?:ReactNode}){
 const state=useSpatialState();
 const inLobby=state.presentation==='lobby';
 const inTask=state.presentation==='task';
 useEffect(()=>{
  if(typeof window==='undefined'||inLobby)return;
  window.scrollTo({top:state.scrollPositions[state.activeSpace]??0,behavior:'auto'});
 },[state.activeSpace,state.presentation,state.scrollPositions,inLobby]);
 return <SpatialEnvironment>
  <div className="spatial-os relative min-h-[100svh] overflow-hidden" data-space={state.activeSpace} data-presentation={state.presentation}>
   <section className={inLobby?'relative flex min-h-[100svh] items-center justify-center px-5 py-16':'relative flex min-h-[100svh] flex-col'} aria-label={inLobby?'Friday 空间大厅':'Friday '+state.activeSpace+' 空间'}>
    <div className="spatial-os-core relative z-10 flex items-center justify-center" style={{...CORE_STYLE,transform:inLobby?'scale(1)':'scale(.62)',opacity:1}}>{friday}</div>
    {inLobby&&<div className="pointer-events-none absolute inset-0" aria-hidden="true"><div className="absolute left-1/2 top-1/2 h-[min(78vw,620px)] w-[min(78vw,620px)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-300/10 shadow-[0_0_100px_rgba(212,166,74,0.07)]"/><div className="absolute left-1/2 top-1/2 h-[min(58vw,460px)] w-[min(58vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-200/10"/></div>}
    {inLobby&&<nav className="absolute inset-0 z-20 mx-auto max-w-5xl" aria-label="四大空间入口">
      {SPACES.map(space=><button key={space.id} type="button" className={`pointer-events-auto absolute ${space.position} flex min-h-20 w-[min(42vw,220px)] flex-col justify-center rounded-2xl border border-amber-200/20 bg-black/35 px-4 py-3 text-left text-amber-50 shadow-[0_12px_48px_rgba(0,0,0,.22)] backdrop-blur-xl transition duration-500 hover:scale-[1.04] hover:border-amber-200/55 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200`} onClick={()=>spatialStateStore.activate(space.id)}><span className="text-[10px] tracking-[.22em] text-amber-200/80">{space.label}</span><strong className="mt-1 text-sm font-medium">{space.sub}</strong><span className="mt-1 text-[11px] text-white/45">展开空间 ↗</span></button>)}
    </nav>}
   </section>
   {!inLobby&&<div className="relative z-10 flex min-h-0 flex-1 flex-col">
    <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
     <button type="button" onClick={()=>spatialStateStore.returnToLobby()} className="rounded-full border border-amber-200/20 px-4 py-2 text-xs text-amber-100/80 hover:border-amber-200/50">← 空间大厅</button>
     <span className="text-[10px] tracking-[.2em] text-amber-200/55">{inTask?'TASK SURFACE':state.activeSpace.toUpperCase()}</span>
    </div>
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 pb-12">
     {inTask?<IntelligencePortal taskId={state.taskContext?.taskId}/>:state.activeSpace==='cinematic'?<CinematicPortal>{children}</CinematicPortal>:state.activeSpace==='intelligence'?<IntelligencePortal/>:state.activeSpace==='resources'?<ResourcePortal/>:<IdentityPortal onReset={()=>spatialStateStore.reset()}/>}
    </div>
   </div>}
   {!inLobby&&<SpatialPanelWorkspace/>}
  </div>
 </SpatialEnvironment>;
}
