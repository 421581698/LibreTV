export type TaskStatus = "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
export type TaskEventType = "task.created" | "task.started" | "task.progress" | "task.checkpoint" | "task.waiting" | "task.resumed" | "task.succeeded" | "task.failed" | "task.cancelled" | "task.replay_requested";
export type TaskEvent = { eventId:string; taskId:string; parentTaskId?:string; sequence:number; type:TaskEventType; occurredAt:string; agent?:string; payload?:unknown; error?:{code:string;message:string;retryable:boolean} };
export type TaskDefinition = { taskId:string; parentTaskId?:string; agent:string; input:unknown; dependsOn?:string[]; sideEffect?:boolean };
export type TaskSnapshot = { taskId:string; parentTaskId?:string; agent:string; status:TaskStatus; input:unknown; output?:unknown; dependsOn:string[]; sideEffect:boolean; checkpoint?:unknown; lastSequence:number; error?:{code:string;message:string;retryable:boolean} };
export interface TaskEventStore { append(event:TaskEvent):Promise<void>; read(taskId:string):Promise<TaskEvent[]>; readRecent?():Promise<TaskEvent[]>; readAll?():Promise<TaskEvent[]> }
export class TaskRuntimeError extends Error { constructor(message:string, public readonly code:string){super(message);this.name="TaskRuntimeError"} }
const TERMINAL=new Set<TaskStatus>(["succeeded","cancelled"]);
function assertSafeId(value:string,label:string):void { if(!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) throw new TaskRuntimeError("Invalid "+label,"INVALID_ID") }
export function validateTaskGraph(definitions:TaskDefinition[]):void {
 const byId=new Map<string,TaskDefinition>();
 for(const task of definitions){assertSafeId(task.taskId,"task id");assertSafeId(task.agent,"agent id");if(byId.has(task.taskId))throw new TaskRuntimeError("Duplicate task id","DUPLICATE_TASK");byId.set(task.taskId,task)}
 for(const task of definitions)for(const dependency of task.dependsOn??[]){if(!byId.has(dependency))throw new TaskRuntimeError("Unknown dependency: "+dependency,"UNKNOWN_DEPENDENCY");if(dependency===task.taskId)throw new TaskRuntimeError("Task cannot depend on itself","TASK_CYCLE")}
 const visiting=new Set<string>(),visited=new Set<string>();
 const visit=(id:string):void=>{if(visiting.has(id))throw new TaskRuntimeError("Task graph contains a cycle","TASK_CYCLE");if(visited.has(id))return;visiting.add(id);for(const dep of byId.get(id)?.dependsOn??[])visit(dep);visiting.delete(id);visited.add(id)};
 for(const id of byId.keys())visit(id);
}
export function reduceTaskEvents(definition:TaskDefinition,events:TaskEvent[]):TaskSnapshot {
 const state:TaskSnapshot={taskId:definition.taskId,parentTaskId:definition.parentTaskId,agent:definition.agent,status:"queued",input:definition.input,dependsOn:definition.dependsOn??[],sideEffect:Boolean(definition.sideEffect),lastSequence:0};
 for(const event of [...events].sort((a,b)=>a.sequence-b.sequence)){if(event.taskId!==definition.taskId||event.sequence<=state.lastSequence)continue;state.lastSequence=event.sequence;switch(event.type){
 case "task.created":state.status="queued";break;
 case "task.started":case "task.resumed":state.status="running";state.error=undefined;break;
 case "task.progress":break;
 case "task.checkpoint":state.checkpoint=event.payload;break;
 case "task.waiting":state.status="waiting";break;
 case "task.succeeded":state.status="succeeded";state.output=event.payload;state.error=undefined;break;
 case "task.failed":state.status="failed";state.error=event.error;break;
 case "task.cancelled":state.status="cancelled";break;
 case "task.replay_requested":break;
 }}return state;
}
export class TaskRuntime {
 constructor(private readonly store:TaskEventStore,private readonly now:()=>string=()=>new Date().toISOString(),private readonly createId:()=>string=()=>"evt-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8)){}
 async create(definition:TaskDefinition):Promise<TaskSnapshot>{assertSafeId(definition.taskId,"task id");assertSafeId(definition.agent,"agent id");if((await this.store.read(definition.taskId)).length)throw new TaskRuntimeError("Task already exists","TASK_EXISTS");const event:TaskEvent={eventId:this.createId(),taskId:definition.taskId,parentTaskId:definition.parentTaskId,sequence:1,type:"task.created",occurredAt:this.now(),agent:definition.agent,payload:{definition}};await this.store.append(event);return reduceTaskEvents(definition,[event])}
 async record(definition:TaskDefinition,type:Exclude<TaskEventType,"task.created"|"task.replay_requested">,payload?:unknown,error?:TaskEvent["error"]):Promise<TaskSnapshot>{const events=await this.store.read(definition.taskId);if(!events.length)throw new TaskRuntimeError("Task does not exist","TASK_NOT_FOUND");const current=reduceTaskEvents(definition,events);if(TERMINAL.has(current.status))throw new TaskRuntimeError("Terminal task cannot be changed","TASK_TERMINAL");const allowed:Record<Exclude<TaskEventType,"task.created"|"task.replay_requested">,TaskStatus[]>={"task.started":["queued"],"task.progress":["running"],"task.checkpoint":["running"],"task.waiting":["running"],"task.resumed":["waiting","failed"],"task.succeeded":["running"],"task.failed":["queued","running","waiting"],"task.cancelled":["queued","running","waiting"]};if(!allowed[type].includes(current.status))throw new TaskRuntimeError("Invalid transition: "+current.status+" -> "+type,"INVALID_TRANSITION");const event:TaskEvent={eventId:this.createId(),taskId:definition.taskId,parentTaskId:definition.parentTaskId,sequence:current.lastSequence+1,type,occurredAt:this.now(),agent:definition.agent,...(payload===undefined?{}:{payload}),...(error?{error}:{})};await this.store.append(event);return reduceTaskEvents(definition,[...events,event])}
 async requestReplay(definition:TaskDefinition):Promise<TaskEvent>{const events=await this.store.read(definition.taskId);if(!events.length)throw new TaskRuntimeError("Task does not exist","TASK_NOT_FOUND");const current=reduceTaskEvents(definition,events);if(definition.sideEffect)throw new TaskRuntimeError("Side-effect tasks require an explicit new execution; automatic replay is blocked","REPLAY_SIDE_EFFECT_BLOCKED");if(current.status!=="failed"||current.error?.retryable!==true)throw new TaskRuntimeError("Only retryable failed tasks can request replay","REPLAY_STATE_INVALID");const event:TaskEvent={eventId:this.createId(),taskId:definition.taskId,parentTaskId:definition.parentTaskId,sequence:current.lastSequence+1,type:"task.replay_requested",occurredAt:this.now(),agent:definition.agent,payload:{fromSequence:current.lastSequence,checkpoint:current.checkpoint}};await this.store.append(event);return event}
 async restoreAll():Promise<TaskSnapshot[]>{
  const readEvents=this.store.readRecent??this.store.readAll;
  if(!readEvents)return [];
  const events=await readEvents.call(this.store);
  const grouped=new Map<string,TaskEvent[]>();
  for(const event of events){const list=grouped.get(event.taskId)??[];list.push(event);grouped.set(event.taskId,list)}
  const snapshots:TaskSnapshot[]=[];
  for(const taskEvents of grouped.values()){
   const created=taskEvents.find(event=>event.type==="task.created");
   const definition=(created?.payload as {definition?:TaskDefinition}|undefined)?.definition;
   if(!definition||definition.taskId!==created?.taskId||typeof definition.agent!=="string")continue;
   snapshots.push(reduceTaskEvents(definition,taskEvents));
  }
  return snapshots.sort((a, b) => {
   const createdAt = (taskId: string) =>
    grouped.get(taskId)?.find((event) => event.type === "task.created")?.occurredAt ?? "";
   return createdAt(b.taskId).localeCompare(createdAt(a.taskId));
  });
 }

}
