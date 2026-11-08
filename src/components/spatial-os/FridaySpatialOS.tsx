'use client';
import type {ReactNode} from 'react';
import {FMHY_CATEGORIES} from './data/fmhy-categories';
import {useSpatialState,spatialStateStore} from './runtime/SpatialStateStore';
import type {SpatialSpace} from './core/types';
const SPACES:{id:SpatialSpace;label:string;sub:string}[]=[
{id:'cinematic',label:'CINEMATIC',sub:'影视空间'},
{id:'intelligence',label:'INTELLIGENCE',sub:'智能空间'},
{id:'resources',label:'RESOURCE UNIVERSE',sub:'资源宇宙'},
{id:'identity',label:'IDENTITY',sub:'个人空间'}];
export function FridaySpatialOS({children,friday}:{children:ReactNode;friday?:ReactNode}){
 const state=useSpatialState();
 return <div className="spatial-os" data-space={state.activeSpace}>
  <div className="spatial-os-core">{friday}</div>
  <nav className="spatial-os-nav" aria-label="Spatial OS 空间导航">{SPACES.map(s=><button key={s.id} type="button" aria-current={state.activeSpace===s.id?'page':undefined} onClick={()=>spatialStateStore.activate(s.id)}><span>{s.label}</span><small>{s.sub}</small></button>)}</nav>
  {state.activeSpace==='cinematic'&&<div className="spatial-os-cinematic">{children}</div>}
  {state.activeSpace==='intelligence'&&<section className="spatial-os-panel"><p className="spatial-os-eyebrow">FRIDAY / INTELLIGENCE</p><h2>智能任务中心</h2><p>语音、Agent DAG、任务事件与播放器能力继续由现有 Friday V3 Runtime 管理；空间层只负责呈现，不接管运行时。</p><div className="spatial-os-actions">{(['tasks','quality','sources'] as const).map(k=><button key={k} onClick={()=>spatialStateStore.expand(state.expandedPanel===k?null:k)}>{k==='tasks'?'任务运行':k==='quality'?'画质证据':'来源检测'}</button>)}</div>{state.expandedPanel&&<p className="spatial-os-note">当前选择：{state.expandedPanel}。真实状态以现有 Runtime 和探测结果为准。</p>}</section>}
  {state.activeSpace==='resources'&&<section className="spatial-os-panel"><p className="spatial-os-eyebrow">FMHY / RESOURCE UNIVERSE</p><h2>13 个顶级资源分类</h2><p>展示官方顶级分类；资源条目与链接以 FMHY 官方目录为准，不复制或伪造第三方资源。</p><div className="spatial-os-category-grid">{FMHY_CATEGORIES.map(c=><a key={c.id} href="https://fmhy.fyi/" target="_blank" rel="noopener noreferrer"><strong>{c.zh}</strong><small>{c.title}</small></a>)}</div><a className="spatial-os-source" href="https://fmhy.fyi/" target="_blank" rel="noopener noreferrer">打开 FMHY 官方目录 ↗</a></section>}
  {state.activeSpace==='identity'&&<section className="spatial-os-panel"><p className="spatial-os-eyebrow">IDENTITY SPACE</p><h2>个人空间</h2><p>观看历史、收藏、偏好与设置仍由 LibreTV 原有数据模块管理。</p><button onClick={()=>spatialStateStore.reset()}>恢复默认空间布局</button></section>}
 </div>;
}
