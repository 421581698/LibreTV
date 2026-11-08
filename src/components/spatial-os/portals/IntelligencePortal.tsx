'use client';
import {useEffect,useState} from 'react';
import {fridayTaskEventStore} from '@/lib/friday/dexie-task-event-store';
import type {TaskEvent} from '@/lib/friday/task-runtime';
import {assessQuality,type QualityAssessment,type QualityEvidence} from '../runtime/QualityVerifier';

function eventStatus(type:string):'waiting'|'running'|'succeeded'|'failed'|'cancelled' {
 if(type==='task.succeeded')return'succeeded';
 if(type==='task.failed')return'failed';
 if(type==='task.cancelled')return'cancelled';
 if(type==='task.started'||type==='task.resumed'||type==='task.progress'||type==='task.checkpoint')return'running';
 return'waiting';
}
export function IntelligencePortal(){
 const [events,setEvents]=useState<TaskEvent[]>([]);
 const [loadError,setLoadError]=useState('');
 const [quality,setQuality]=useState<QualityAssessment>({label:'尚无播放器解码证据',height:null,confidence:'unknown',source:'unknown'});
 useEffect(()=>{
  let active=true;
  void fridayTaskEventStore.readRecent().then(rows=>{if(active)setEvents(rows);}).catch(()=>{if(active)setLoadError('本地任务事件暂不可读取');});
  const onQuality=(event:Event)=>{const evidence=(event as CustomEvent<QualityEvidence>).detail;if(evidence)setQuality(assessQuality(evidence));};
  window.addEventListener('friday-player-quality-evidence',onQuality);
  return()=>{active=false;window.removeEventListener('friday-player-quality-evidence',onQuality);};
 },[]);
 const latest=new Map<string,TaskEvent>();
 for(const event of events){const previous=latest.get(event.taskId);if(!previous||event.sequence>previous.sequence)latest.set(event.taskId,event);}
 const tasks=[...latest.values()].sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)).slice(0,12);
 const running=tasks.filter(e=>eventStatus(e.type)==='running').length;
 const failed=tasks.filter(e=>eventStatus(e.type)==='failed').length;
 const completed=tasks.filter(e=>eventStatus(e.type)==='succeeded').length;
 return <section className="spatial-os-panel" aria-label="Friday 智能任务空间">
  <p className="spatial-os-eyebrow">FRIDAY / INTELLIGENCE</p><h2>智能任务中心</h2>
  <p>读取现有 Friday V3 IndexedDB 任务事件；空间层只投影状态，不创建第二套任务运行时。</p>
  <div className="spatial-os-metrics"><span><strong>{tasks.length}</strong><small>近期任务</small></span><span><strong>{running}</strong><small>运行中</small></span><span><strong>{completed}</strong><small>已完成</small></span><span><strong>{failed}</strong><small>失败</small></span></div>
  <h3>任务事件</h3>{loadError&&<p role="status">{loadError}</p>}
  {tasks.length===0&&!loadError&&<p>当前浏览器尚无可展示的任务事件。执行 Friday 任务后会显示持久化记录。</p>}
  <ul className="spatial-os-task-list">{tasks.map(e=><li key={e.taskId}><span>{e.taskId}</span><small>{e.type} · {new Date(e.occurredAt).toLocaleString()}</small></li>)}</ul>
  <h3>播放质量证据</h3><p className="spatial-os-quality" data-confidence={quality.confidence}>{quality.label} · {quality.confidence==='verified'?'播放器实测':quality.confidence==='indicative'?'接口/分片参考':'未知'}</p>
  <p className="spatial-os-footnote">播放器 videoHeight 才标记为 verified；播放列表声明和服务端分片探测不能冒充实际解码画质。</p>
 </section>;
}
