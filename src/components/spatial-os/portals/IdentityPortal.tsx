'use client';
import {useEffect,useState} from 'react';
import {db,type HistoryEntry} from '@/lib/db';
import {useAppStore} from '@/lib/store';
import {ThemeToggle} from '@/components/theme';
import {requestShowDownloadManager} from '@/components/download-manager';
import {spatialStateStore} from '../runtime/SpatialStateStore';
export function IdentityPortal({onReset}:{onReset:()=>void}){
 const [history,setHistory]=useState<HistoryEntry[]>([]);
 const [error,setError]=useState('');
 const douban=useAppStore(s=>s.doubanEnabled);
 const recommend=useAppStore(s=>s.recommendSource);
 const yellow=useAppStore(s=>s.yellowFilter);
 const sources=useAppStore(s=>s.selectedKeys.length);
 useEffect(()=>{let active=true;void db.history.orderBy('timestamp').reverse().limit(8).toArray().then(rows=>{if(active)setHistory(rows);}).catch(()=>{if(active)setError('观看历史暂时不可读取');});return()=>{active=false;};},[]);
 return <section className="spatial-os-panel" aria-label="个人空间"><p className="spatial-os-eyebrow">IDENTITY SPACE</p><h2>个人空间</h2>
 <div className="spatial-os-metrics"><span><strong>{history.length}</strong><small>最近观看记录</small></span><span><strong>{sources}</strong><small>已启用点播源</small></span><span><strong>{douban?'ON':'OFF'}</strong><small>首页推荐</small></span><span><strong>{yellow?'ON':'OFF'}</strong><small>内容过滤</small></span></div>
 <h3>最近观看</h3>{error&&<p role="status">{error}</p>}{history.length===0&&!error&&<p>暂无观看历史。播放影片后，记录会自动显示在这里。</p>}
 <ul className="spatial-os-task-list">{history.map(item=><li key={item.id}><span>{item.title}</span><small>{new Date(item.timestamp).toLocaleString()} · 第 {item.episodeIndex+1} 集</small></li>)}</ul>
 <p className="spatial-os-footnote">推荐数据源：{recommend}。观看记录与偏好沿用 LibreTV 现有 IndexedDB / Zustand 存储。</p>
 <h3>个人控制台</h3><div className="spatial-os-actions"><ThemeToggle/><button type="button" onClick={()=>spatialStateStore.expand('history')}>完整观看历史</button><button type="button" onClick={()=>requestShowDownloadManager()}>下载管理</button><button type="button" onClick={()=>spatialStateStore.expand('settings')}>偏好设置</button><button type="button" onClick={()=>spatialStateStore.expand('sources')}>管理点播源</button><button type="button" onClick={onReset}>恢复默认空间布局</button></div></section>;
}
