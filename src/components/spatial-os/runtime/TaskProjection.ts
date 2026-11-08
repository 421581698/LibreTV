import type {TaskEvent,TaskDefinition} from '@/lib/friday/task-runtime';
import type {FridayVisualState} from '../core/types';

export type RuntimePhase='idle'|'listening'|'recognizing'|'thinking'|'executing'|'rendering'|'result'|'recovering'|'error';
export function projectFridayState(phase:RuntimePhase):FridayVisualState {
 switch(phase){case'listening':case'recognizing':return'listening';case'thinking':return'thinking';case'executing':case'rendering':return'executing';case'error':return'error';case'recovering':return'thinking';default:return'idle';}
}

export interface TaskProjection {
 id:string;
 label:string;
 agent:string;
 status:'waiting'|'running'|'succeeded'|'failed'|'cancelled';
 parentTaskId?:string;
 dependsOn:string[];
 progress?:string;
 checkpoint?:string;
 error?:{code:string;message:string;retryable:boolean};
 lastEventType:TaskEvent['type'];
 occurredAt:string;
 replayCount:number;
}

function summarizePayload(value:unknown):string|undefined {
 if(typeof value==='string')return value.trim().slice(0,160)||undefined;
 if(typeof value==='number')return String(value);
 if(!value||typeof value!=='object')return undefined;
 const record=value as Record<string,unknown>;
 for(const key of ['label','message','step','phase','status']){
  if(typeof record[key]==='string'&&record[key].trim())return record[key].trim().slice(0,160);
 }
 if(typeof record.percent==='number')return `${record.percent}%`;
 if(typeof record.progress==='number')return `进度 ${record.progress}`;
 return Object.keys(record).length?'已保存结构化记录':undefined;
}

function statusFromEvent(type:TaskEvent['type']):TaskProjection['status'] {
 switch(type){
  case'task.succeeded':return'succeeded';
  case'task.failed':return'failed';
  case'task.cancelled':return'cancelled';
  case'task.waiting':case'task.created':case'task.replay_requested':return'waiting';
  default:return'running';
 }
}

/** Rebuilds a display-only DAG projection from the durable Task Runtime event streams. */
export function projectTaskEvents(events:readonly TaskEvent[]):TaskProjection[] {
 const groups=new Map<string,TaskEvent[]>();
 for(const event of events){
  const list=groups.get(event.taskId)??[];
  list.push(event);
  groups.set(event.taskId,list);
 }
 const projections:TaskProjection[]=[];
 for(const [taskId,stream] of groups){
  const ordered=[...stream].sort((a,b)=>a.sequence-b.sequence);
  const created=ordered.find(event=>event.type==='task.created');
  const definition=(created?.payload as {definition?:TaskDefinition}|undefined)?.definition;
  if(!created||!definition||definition.taskId!==taskId)continue;
  const latest=ordered[ordered.length-1];
  const progressEvent=[...ordered].reverse().find(event=>event.type==='task.progress');
  const checkpointEvent=[...ordered].reverse().find(event=>event.type==='task.checkpoint');
  projections.push({
   id:taskId,
   label:definition.agent,
   agent:definition.agent,
   status:statusFromEvent(latest.type),
   parentTaskId:definition.parentTaskId,
   dependsOn:definition.dependsOn??[],
   progress:progressEvent?summarizePayload(progressEvent.payload):undefined,
   checkpoint:checkpointEvent?summarizePayload(checkpointEvent.payload):undefined,
   error:latest.type==='task.failed'?latest.error:undefined,
   lastEventType:latest.type,
   occurredAt:latest.occurredAt,
   replayCount:ordered.filter(event=>event.type==='task.replay_requested').length,
  });
 }
 return projections.sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt));
}

export function summarizeTasks(tasks:readonly TaskProjection[]){
 return{total:tasks.length,running:tasks.filter(t=>t.status==='running').length,failed:tasks.filter(t=>t.status==='failed').length,completed:tasks.filter(t=>t.status==='succeeded').length};
}
