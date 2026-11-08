'use client';
import {useEffect,useState} from 'react';
import {liveQuery} from 'dexie';
import {fridayTaskEventStore} from '@/lib/friday/dexie-task-event-store';
import type {TaskEvent} from '@/lib/friday/task-runtime';
import {db} from '@/lib/db';
import {readQualities} from '@/lib/store';
import {qualityKey} from '@/lib/quality';
import {assessQuality,type QualityAssessment,type QualityEvidence} from '../runtime/QualityVerifier';
import {projectTaskEvents,summarizeTasks} from '../runtime/TaskProjection';
import {spatialStateStore} from '../runtime/SpatialStateStore';

export function IntelligencePortal({taskId}:{taskId?:string|null}={}){
 const [events,setEvents]=useState<TaskEvent[]>([]);
 const [loadError,setLoadError]=useState('');
 const [quality,setQuality]=useState<QualityAssessment>({label:'尚无播放器解码证据',height:null,confidence:'unknown',source:'unknown'});
 useEffect(()=>{
  let active=true;
  const subscription=liveQuery(()=>fridayTaskEventStore.readRecent()).subscribe({
   next:rows=>{if(active){setEvents(rows);setLoadError('');}},
   error:()=>{if(active)setLoadError('本地任务事件暂不可读取');},
  });
  void db.history.orderBy('timestamp').reverse().limit(30).toArray().then(history=>{
   if(!active||history.length===0)return;
   const qualities=readQualities(history.map(item=>({sourceKey:item.sourceKey,vodId:item.vodId})));
   for(const item of history){
    const entry=qualities[qualityKey(item.sourceKey,item.vodId)];
    if(!entry?.height)continue;
    const evidence:QualityEvidence=entry.from==='play'
     ?{kind:'player-decoded',decodedHeight:entry.lastPlaybackHeight??entry.height,observedAt:entry.lastPlaybackSampleAt??entry.timestamp}
     :{kind:'segment-probe',segmentHeight:entry.height,observedAt:entry.timestamp};
    setQuality(assessQuality(evidence));break;
   }
  }).catch(()=>{});
  const onQuality=(event:Event)=>{const evidence=(event as CustomEvent<QualityEvidence>).detail;if(evidence)setQuality(assessQuality(evidence));};
  window.addEventListener('friday-player-quality-evidence',onQuality);
  return()=>{active=false;subscription.unsubscribe();window.removeEventListener('friday-player-quality-evidence',onQuality);};
 },[]);
 const allTasks=projectTaskEvents(events);
 const tasks=taskId?allTasks.filter(task=>task.id===taskId||task.parentTaskId===taskId):allTasks;
 const metrics=summarizeTasks(tasks);
 return <section className="spatial-os-panel" aria-label={taskId?'Friday 任务详情':'Friday 智能任务空间'}>
  <p className="spatial-os-eyebrow">FRIDAY / INTELLIGENCE</p><h2>{taskId?'任务执行详情':'智能任务中心'}</h2>
  <p>{taskId?'当前任务及其直接子任务的持久化事件、进度和恢复信息。':'实时读取现有 Friday V3 IndexedDB 任务事件；DAG 依赖、进度、检查点和失败信息均从持久化事件重建，不创建第二套任务运行时。'}</p>
  <div className="spatial-os-metrics"><span><strong>{metrics.total}</strong><small>{taskId?'关联任务':'近期任务'}</small></span><span><strong>{metrics.running}</strong><small>运行中</small></span><span><strong>{metrics.completed}</strong><small>已完成</small></span><span><strong>{metrics.failed}</strong><small>失败</small></span></div>
  <h3>Agent DAG / 任务事件</h3>{loadError&&<p role="status">{loadError}</p>}
  {tasks.length===0&&!loadError&&<p>{taskId?'尚未找到该任务的持久化事件。':'当前浏览器尚无可展示的任务事件。执行 Friday 任务后会显示持久化记录。'}</p>}
  <ul className="spatial-os-task-list">{tasks.map(task=><li key={task.id}>
   <div><button type="button" className="text-left" onClick={()=>spatialStateStore.setTaskContext({taskId:task.id,agentId:task.agent})}><span>{task.label}</span><small className="block">{task.id} · {task.status} · {task.lastEventType} · 查看任务 ↗</small></button></div>
   {task.parentTaskId&&<small>父任务：{task.parentTaskId}</small>}
   {task.dependsOn.length>0&&<small>依赖：{task.dependsOn.join('、')}</small>}
   {task.progress&&<small>进度：{task.progress}</small>}
   {task.checkpoint&&<small>恢复检查点：{task.checkpoint}</small>}
   {task.replayCount>0&&<small>显式恢复次数：{task.replayCount}</small>}
   {task.error&&<p role="alert">失败原因：{task.error.message}（{task.error.code} · {task.error.retryable?'允许受限重试':'不可自动重试'}）</p>}
   <small>{new Date(task.occurredAt).toLocaleString()}</small>
  </li>)}</ul>
  {!taskId&&<><h3>播放质量证据</h3><p className="spatial-os-quality" data-confidence={quality.confidence}>{quality.label} · {quality.confidence==='verified'?'播放器实测':quality.confidence==='indicative'?'接口/分片参考':'未知'}</p><p className="spatial-os-footnote">播放器 videoHeight 才标记为 verified；播放列表声明和服务端分片探测不能冒充实际解码画质。</p></>}
 </section>;
}
