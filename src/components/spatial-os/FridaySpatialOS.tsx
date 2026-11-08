'use client';
import {useEffect} from 'react';
import type {ReactNode} from 'react';
import {CinematicPortal} from './portals/CinematicPortal';
import {ResourcePortal} from './portals/ResourcePortal';
import {IntelligencePortal} from './portals/IntelligencePortal';
import {IdentityPortal} from './portals/IdentityPortal';
import {useSpatialState,spatialStateStore} from './runtime/SpatialStateStore';
import type {SpatialSpace} from './core/types';
const SPACES:{id:SpatialSpace;label:string;sub:string}[]=[
{id:'cinematic',label:'CINEMATIC',sub:'影视空间'},
{id:'intelligence',label:'INTELLIGENCE',sub:'智能空间'},
{id:'resources',label:'RESOURCE UNIVERSE',sub:'资源宇宙'},
{id:'identity',label:'IDENTITY',sub:'个人空间'}];
export function FridaySpatialOS({children,friday}:{children:ReactNode;friday?:ReactNode}){
 const state=useSpatialState();
 useEffect(()=>{if(typeof window!=='undefined')window.scrollTo({top:state.scrollPositions[state.activeSpace]??0,behavior:'auto'});},[state.activeSpace,state.scrollPositions]);
 return <div className="spatial-os" data-space={state.activeSpace}>
  <div className="spatial-os-core">{friday}</div>
  <nav className="spatial-os-nav" aria-label="Spatial OS 空间导航">{state.history.length>1&&<button type="button" className="spatial-os-back" onClick={()=>spatialStateStore.back()} aria-label="返回上一个空间">←<small>返回</small></button>}{SPACES.map(s=><button key={s.id} type="button" aria-current={state.activeSpace===s.id?'page':undefined} onClick={()=>{if(typeof window!=='undefined')spatialStateStore.saveScroll(state.activeSpace,window.scrollY);spatialStateStore.activate(s.id);}}><span>{s.label}</span><small>{s.sub}</small></button>)}</nav>
  {state.activeSpace==='cinematic'&&<CinematicPortal>{children}</CinematicPortal>}
  {state.activeSpace==='intelligence'&&<IntelligencePortal/>}
  {state.activeSpace==='resources'&&<ResourcePortal/>}
  {state.activeSpace==='identity'&&<IdentityPortal onReset={()=>spatialStateStore.reset()}/>}
 </div>;
}
