'use client';
import {useEffect} from 'react';
import {goBackSpace} from './runtime/SpatialRouter';
import type {ReactNode} from 'react';
import {FMHY_CATEGORIES} from './data/fmhy-categories';
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
  {state.activeSpace==='cinematic'&&<div className="spatial-os-cinematic">{children}</div>}
  {state.activeSpace==='intelligence'&&<IntelligencePortal/>}
  {state.activeSpace==='resources'&&<section className="spatial-os-panel"><p className="spatial-os-eyebrow">FMHY / RESOURCE UNIVERSE</p><h2>13 个顶级资源分类</h2><p>展示官方顶级分类；资源条目与链接以 FMHY 官方目录为准，不复制或伪造第三方资源。</p><div className="spatial-os-category-grid">{FMHY_CATEGORIES.map(c=><a key={c.id} href={c.href} target="_blank" rel="noopener noreferrer"><strong>{c.zh}</strong><small>{c.title}</small></a>)}</div><a className="spatial-os-source" href="https://fmhy.fyi/" target="_blank" rel="noopener noreferrer">打开 FMHY 官方目录 ↗</a></section>}
  {state.activeSpace==='identity'&&<IdentityPortal onReset={()=>spatialStateStore.reset()}/>}
 </div>;
}
