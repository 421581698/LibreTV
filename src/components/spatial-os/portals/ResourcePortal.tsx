'use client';

import {useEffect,useMemo,useState} from 'react';
import {FMHY_CATEGORIES} from '../data/fmhy-categories';
import {loadAllFMHYCategories,loadFMHYCategory,type FMHYResource,FMHY_RESOURCE_SOURCE} from '../data/fmhy-resource-index';

const FAVORITES_KEY='libretv.fmhy.favorites.v1';

export function ResourcePortal(){
 const [category,setCategory]=useState('video');
 const [query,setQuery]=useState('');
 const [section,setSection]=useState('all');
 const [tag,setTag]=useState('all');
 const [favoritesOnly,setFavoritesOnly]=useState(false);
 const [favorites,setFavorites]=useState<string[]>([]);
 const [records,setRecords]=useState<FMHYResource[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [visibleCount,setVisibleCount]=useState(60);

 useEffect(()=>{
  try{const raw=window.localStorage.getItem(FAVORITES_KEY);if(raw){const parsed=JSON.parse(raw);if(Array.isArray(parsed))setFavorites(parsed.filter((x):x is string=>typeof x==='string'));}}catch{/* Storage may be unavailable in private browsing. */}
 },[]);

 useEffect(()=>{
  let active=true;setLoading(true);setError('');setSection('all');setTag('all');setVisibleCount(60);
  const task=category==='all'?loadAllFMHYCategories():loadFMHYCategory(category);
  void task.then(rows=>{if(active)setRecords(rows);}).catch(()=>{if(active){setRecords([]);setError('本地资源索引暂时无法读取，请稍后重试。');}}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[category]);

 const sections=useMemo(()=>Array.from(new Set(records.map(r=>r.section.filter(Boolean).join(' / ')).filter(Boolean))).sort((a,b)=>a.localeCompare(b)),[records]);
 const tags=useMemo(()=>Array.from(new Set(records.flatMap(r=>r.tags))).filter(Boolean).sort((a,b)=>a.localeCompare(b)),[records]);
 const filtered=useMemo(()=>{
  const needle=query.trim().toLocaleLowerCase();
  return records.filter(r=>{
   if(favoritesOnly&&!favorites.includes(r.id))return false;
   if(section!=='all'&&r.section.join(' / ')!==section)return false;
   if(tag!=='all'&&!r.tags.includes(tag))return false;
   if(!needle)return true;
   return [r.title,r.url,r.categoryTitle,...r.section,...r.tags,...r.links.map(l=>l.label)].join(' ').toLocaleLowerCase().includes(needle);
  });
 },[records,query,section,tag,favoritesOnly,favorites]);
 const visible=filtered.slice(0,visibleCount);
 const toggleFavorite=(id:string)=>{
  setFavorites(current=>{
   const next=current.includes(id)?current.filter(x=>x!==id):[...current,id];
   try{window.localStorage.setItem(FAVORITES_KEY,JSON.stringify(next));}catch{/* Favorites remain usable for this session. */}
   return next;
  });
 };

 return <section className="spatial-os-panel space-y-5" aria-label="LibreTV 本地资源宇宙">
  <header className="space-y-2">
   <p className="spatial-os-eyebrow">RESOURCE UNIVERSE / LOCAL INDEX</p>
   <div className="flex flex-wrap items-end justify-between gap-3">
    <div><h2 className="text-2xl font-semibold">资源宇宙</h2><p className="text-sm opacity-70">FMHY 目录已建立本地索引。分类、搜索、筛选和收藏均在 LibreTV 内完成。</p></div>
    <div className="rounded-full border px-3 py-1 text-xs opacity-70">{loading?'正在载入…':`${filtered.length.toLocaleString()} 条结果`}</div>
   </div>
  </header>

  <div className="flex flex-wrap gap-2" role="group" aria-label="资源分类">
   <button type="button" onClick={()=>setCategory('all')} aria-pressed={category==='all'} className={`rounded-full border px-3 py-2 text-sm ${category==='all'?'bg-black text-white dark:bg-white dark:text-black':'opacity-75'}`}>全部分类</button>
   {FMHY_CATEGORIES.map(c=><button key={c.id} type="button" onClick={()=>setCategory(c.id)} aria-pressed={category===c.id} className={`rounded-full border px-3 py-2 text-sm ${category===c.id?'bg-black text-white dark:bg-white dark:text-black':'opacity-75'}`}>{c.zh}</button>)}
  </div>

  <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(180px,0.45fr)_minmax(160px,0.35fr)]">
   <label className="sr-only" htmlFor="fmhy-search">搜索资源</label>
   <input id="fmhy-search" type="search" value={query} onChange={e=>{setQuery(e.target.value);setVisibleCount(60);}} placeholder="搜索资源名称、网址、平台或标签…" className="min-w-0 rounded-xl border bg-transparent px-4 py-3 text-base"/>
   <label className="sr-only" htmlFor="fmhy-section">筛选子分类</label>
   <select id="fmhy-section" value={section} onChange={e=>setSection(e.target.value)} className="rounded-xl border bg-transparent px-3 py-3 text-sm"><option value="all">全部子分类</option>{sections.map(s=><option key={s} value={s}>{s}</option>)}</select>
   <label className="sr-only" htmlFor="fmhy-tag">筛选标签</label>
   <select id="fmhy-tag" value={tag} onChange={e=>setTag(e.target.value)} className="rounded-xl border bg-transparent px-3 py-3 text-sm"><option value="all">全部标签</option>{tags.map(t=><option key={t} value={t}>{t}</option>)}</select>
  </div>

  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
   <button type="button" onClick={()=>{if(!favoritesOnly)setCategory('all');setFavoritesOnly(v=>!v);}} aria-pressed={favoritesOnly} className={`rounded-full border px-3 py-2 ${favoritesOnly?'bg-black text-white dark:bg-white dark:text-black':''}`}>★ {favoritesOnly?'正在查看收藏':'我的收藏'} ({favorites.length})</button>
   <span className="opacity-60">当前显示 {visible.length} / {filtered.length}</span>
  </div>

  {error&&<p role="alert" className="rounded-xl border border-red-500/40 p-4 text-sm">{error}</p>}
  {loading&&<p role="status" className="py-10 text-center text-sm opacity-60">正在载入本地资源索引…</p>}
  {!loading&&!error&&filtered.length===0&&<div className="rounded-2xl border p-8 text-center"><p className="font-medium">没有找到匹配资源</p><p className="mt-1 text-sm opacity-60">试试其他关键词，或清除筛选条件。</p><button type="button" onClick={()=>{setQuery('');setSection('all');setTag('all');setFavoritesOnly(false);}} className="mt-3 rounded-full border px-4 py-2 text-sm">清除筛选</button></div>}

  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
   {visible.map(resource=><article key={resource.id} className="min-w-0 rounded-2xl border p-4 transition-colors hover:bg-black/[0.025] dark:hover:bg-white/[0.04]">
    <div className="flex items-start justify-between gap-3">
     <div className="min-w-0"><h3 className="break-words font-semibold">{resource.title}</h3><p className="mt-1 break-all text-xs opacity-55">{resource.url}</p></div>
     <button type="button" onClick={()=>toggleFavorite(resource.id)} aria-label={favorites.includes(resource.id)?'取消收藏':'收藏资源'} aria-pressed={favorites.includes(resource.id)} className="shrink-0 rounded-full border px-3 py-1 text-sm">{favorites.includes(resource.id)?'★':'☆'}</button>
    </div>
    <p className="mt-3 text-xs opacity-60">{resource.section.join(' / ')||resource.categoryTitle}</p>
    <p className="mt-1 text-[11px] opacity-45">来源快照 {resource.sourceRetrievedAt} · 修订 {resource.sourceRevision.slice(0,7)}</p>
    <div className="mt-3 flex flex-wrap gap-1.5">
     {resource.flags.recommended&&<span className="rounded-full bg-amber-500/10 px-2 py-1 text-xs">社区推荐</span>}
     {resource.flags.thirdParty&&<span className="rounded-full bg-sky-500/10 px-2 py-1 text-xs">第三方索引</span>}
     {resource.flags.section&&<span className="rounded-full bg-slate-500/10 px-2 py-1 text-xs">分区入口</span>}
     {resource.tags.slice(0,5).map(t=><span key={t} className="rounded-full bg-black/[0.05] px-2 py-1 text-xs dark:bg-white/[0.08]">{t}</span>)}
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3">
     <a href={resource.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium underline underline-offset-4">打开资源 ↗</a>
     {resource.links.length>0&&<details className="text-sm"><summary className="cursor-pointer opacity-70">备用 / 相关链接 ({resource.links.length})</summary><div className="mt-2 flex flex-col gap-2">{resource.links.map((link,i)=><a key={`${link.url}-${i}`} href={link.url} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-4">{link.label} ↗</a>)}</div></details>}
     <a href={resource.sourcePage} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs opacity-50">来源</a>
    </div>
   </article>)}
  </div>
  {!loading&&visible.length<filtered.length&&<div className="flex justify-center"><button type="button" onClick={()=>setVisibleCount(n=>n+60)} className="rounded-full border px-5 py-3 text-sm">加载更多 ({filtered.length-visible.length})</button></div>}

  <footer className="border-t pt-4 text-xs leading-6 opacity-60">
   <p>索引来源：<a href={FMHY_RESOURCE_SOURCE.repository} target="_blank" rel="noopener noreferrer" className="underline">FMHY 官方编辑仓库</a> · 数据快照：{FMHY_RESOURCE_SOURCE.retrievedAt} · 共 13 个分类。</p>
   <p>{FMHY_RESOURCE_SOURCE.attribution}</p>
   <p>目录条目仅供发现和索引。LibreTV 不托管第三方内容，不代表第三方网站的安全性、合法性或可用性；请遵守所在地法律并自行判断。</p>
  </footer>
 </section>;
}
