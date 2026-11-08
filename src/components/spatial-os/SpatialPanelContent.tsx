'use client';

import {useState,type FormEvent} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {db} from '@/lib/db';
import {useAppStore} from '@/lib/store';
import {IntelligencePortal} from './portals/IntelligencePortal';

export function SpatialPanelContent({panel}:{panel:'search'|'sources'|'quality'|'tasks'|'history'|'settings'}){
 switch(panel){
  case 'search':return <SpatialSearchPanel/>;
  case 'sources':return <SpatialSourcesPanel/>;
  case 'quality':return <IntelligencePortal view="quality"/>;
  case 'tasks':return <IntelligencePortal view="tasks"/>;
  case 'history':return <SpatialHistoryPanel/>;
  case 'settings':return <SpatialSettingsPanel/>;
 }
}

function SpatialSearchPanel(){
 const [query,setQuery]=useState('');
 const submit=(event:FormEvent)=>{event.preventDefault();const value=query.trim().slice(0,100);if(value)window.dispatchEvent(new CustomEvent('friday-spatial-search',{detail:{query:value}}));};
 return <section className="spatial-os-panel" aria-label="影视搜索面板">
  <p className="spatial-os-eyebrow">FRIDAY / SEARCH</p><h2>影视意图搜索</h2>
  <p>复用 LibreTV 当前搜索控制器与已启用点播源，不创建第二套搜索或 Agent 生命周期。</p>
  <form onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:flex-row"><label className="sr-only" htmlFor="spatial-movie-query">搜索影片</label><input id="spatial-movie-query" value={query} onChange={event=>setQuery(event.target.value)} maxLength={100} placeholder="输入片名、演员或自然语言意图…" className="min-w-0 flex-1 rounded-xl border bg-transparent px-4 py-3"/><button type="submit" className="rounded-xl border px-5 py-3">开始搜索</button></form>
  <small className="mt-3 block opacity-60">搜索结果沿用影院空间的现有结果列表与影片详情弹窗。</small>
 </section>;
}

function SpatialSourcesPanel(){
 const custom=useAppStore(state=>state.customAPIs);
 const env=useAppStore(state=>state.envSources);
 const selected=useAppStore(state=>state.selectedKeys);
 const toggle=useAppStore(state=>state.toggleSourceSelected);
 const sources=[...env,...custom];
 return <section className="spatial-os-panel" aria-label="点播源管理面板">
  <p className="spatial-os-eyebrow">LIBRETV / SOURCES</p><h2>点播源管理</h2>
  <p>直接读取现有源配置和启用状态；开关操作写回原 Zustand 持久化，不复制源数据库。</p>
  <div className="spatial-os-metrics"><span><strong>{sources.length}</strong><small>可用源</small></span><span><strong>{selected.length}</strong><small>已选择</small></span></div>
  {sources.length===0?<p>当前没有已加载的点播源，请在站点原有设置中添加或同步数据源。</p>:<ul className="spatial-os-task-list">{sources.map(source=><li key={source.key} className="flex items-center justify-between gap-3"><div className="min-w-0"><strong>{source.name}</strong><small className="block break-all opacity-60">{source.url}</small></div><button type="button" aria-pressed={selected.includes(source.key)} onClick={()=>toggle(source.key)} className="shrink-0 rounded-full border px-3 py-2 text-sm">{selected.includes(source.key)?'已启用':'已停用'}</button></li>)}</ul>}
 </section>;
}

function SpatialHistoryPanel(){
 const history=useLiveQuery(()=>db.history.orderBy('timestamp').reverse().limit(30).toArray(),[]);
 return <section className="spatial-os-panel" aria-label="观看历史面板">
  <p className="spatial-os-eyebrow">LIBRETV / HISTORY</p><h2>观看历史</h2>
  {!history?<p>正在读取本地观看记录…</p>:history.length===0?<p>暂无观看记录。播放影片后，记录会显示在这里。</p>:<ul className="spatial-os-task-list">{history.map(item=><li key={item.id}><strong>{item.title}</strong><small className="block opacity-60">{new Date(item.timestamp).toLocaleString()} · 第 {item.episodeIndex+1} 集</small></li>)}</ul>}
  <small className="spatial-os-footnote">数据来自 LibreTV 现有 IndexedDB 观看历史。</small>
 </section>;
}

function SpatialSettingsPanel(){
 const douban=useAppStore(state=>state.doubanEnabled);
 const yellow=useAppStore(state=>state.yellowFilter);
 const autoplay=useAppStore(state=>state.autoplayNext);
 const update=useAppStore(state=>state.updateSettings);
 const rows=[{id:'douban',label:'首页推荐',value:douban,change:()=>update({doubanEnabled:!douban})},{id:'yellow',label:'内容过滤',value:yellow,change:()=>update({yellowFilter:!yellow})},{id:'autoplay',label:'自动连播',value:autoplay,change:()=>update({autoplayNext:!autoplay})}];
 return <section className="spatial-os-panel" aria-label="LibreTV 设置面板">
  <p className="spatial-os-eyebrow">LIBRETV / PREFERENCES</p><h2>偏好设置</h2>
  <p>这些开关直接更新 LibreTV 原有设置存储；语音控制器、播放器和 Friday 核心参数不在此处重置。</p>
  <ul className="spatial-os-task-list">{rows.map(row=><li key={row.id} className="flex items-center justify-between gap-3"><strong>{row.label}</strong><button type="button" role="switch" aria-checked={row.value} onClick={row.change} className="rounded-full border px-4 py-2 text-sm">{row.value?'开启':'关闭'}</button></li>)}</ul>
 </section>;
}
