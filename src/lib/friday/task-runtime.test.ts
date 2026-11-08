import {describe,expect,it} from "vitest";
import {reduceTaskEvents,TaskRuntime,TaskRuntimeError,validateTaskGraph,type TaskDefinition,type TaskEvent,type TaskEventStore} from "./task-runtime";
class MemoryStore implements TaskEventStore { private data=new Map<string,TaskEvent[]>(); async append(event:TaskEvent){const list=this.data.get(event.taskId)??[];list.push(event);this.data.set(event.taskId,list)} async read(id:string){return [...(this.data.get(id)??[])]} async readRecent(){return [...this.data.values()].flat()} }
const task:TaskDefinition={taskId:"movie-search-1",agent:"search-agent",input:{title:"Arrival"}};
describe("Friday task runtime",()=>{
 it("allows only one concurrent creator to claim a persisted task ID",async()=>{
  class UniqueStore implements TaskEventStore {
   private events=new Map<string,TaskEvent[]>();
   async append(event:TaskEvent) {
    const list=this.events.get(event.taskId)??[];
    if(list.some(item=>item.sequence===event.sequence)||[...this.events.values()].flat().some(item=>item.eventId===event.eventId)) {
     throw new Error("Duplicate task event key");
    }
    list.push(event);
    this.events.set(event.taskId,list);
   }
   async read(taskId:string) { return [...(this.events.get(taskId)??[])]; }
   async readRecent() { return [...this.events.values()].flat(); }
  }
  const store=new UniqueStore();
  const runtimes=[new TaskRuntime(store),new TaskRuntime(store)];
  const outcomes=await Promise.allSettled(runtimes.map(runtime=>runtime.create(task)));
  expect(outcomes.filter(result=>result.status==="fulfilled")).toHaveLength(1);
  expect(outcomes.filter(result=>result.status==="rejected")).toHaveLength(1);
  expect(await store.read(task.taskId)).toHaveLength(1);
 });

 it("marks orphaned running tasks interrupted when restoring after a reload",async()=>{
  const store=new MemoryStore();
  const firstRuntime=new TaskRuntime(store);
  const definition={...task,dependsOn:["source"],sideEffect:false};
  await firstRuntime.create(definition);
  await firstRuntime.record(definition,"task.started");
  await firstRuntime.record(definition,"task.checkpoint",{cursor:"page-2"});
  const restored=await new TaskRuntime(store).restoreAll();
  expect(restored).toHaveLength(1);
  expect(restored[0]).toMatchObject({taskId:task.taskId,status:"failed",input:task.input,dependsOn:["source"],checkpoint:{cursor:"page-2"},lastSequence:4,error:{code:"TASK_INTERRUPTED",retryable:false}});
  const restoredAgain=await new TaskRuntime(store).restoreAll();
  expect(restoredAgain[0]).toMatchObject({status:"failed",lastSequence:4});
 });
 it("rejects cyclic DAG dependencies",()=>{expect(()=>validateTaskGraph([{...task,dependsOn:["quality"]},{taskId:"quality",agent:"quality-agent",input:{},dependsOn:[task.taskId]}])).toThrowError(TaskRuntimeError)});
 it("records lifecycle and reconstructs checkpoints",async()=>{let eventNumber=0;const runtime=new TaskRuntime(new MemoryStore(),()=>"2026-11-06T00:00:00Z",()=>`event-${++eventNumber}`);await runtime.create(task);await runtime.record(task,"task.started");await runtime.record(task,"task.checkpoint",{cursor:"source-2"});const result=await runtime.record(task,"task.succeeded",{matches:3});expect(result).toMatchObject({status:"succeeded",checkpoint:{cursor:"source-2"},output:{matches:3}})});
 it("blocks automatic replay for side effects",async()=>{const side={...task,taskId:"player-control-1",sideEffect:true};const runtime=new TaskRuntime(new MemoryStore());await runtime.create(side);await expect(runtime.requestReplay(side)).rejects.toMatchObject({code:"REPLAY_SIDE_EFFECT_BLOCKED"})});
 it("rejects lifecycle transitions that skip required states",async()=>{const runtime=new TaskRuntime(new MemoryStore());await runtime.create(task);await expect(runtime.record(task,"task.succeeded",{})).rejects.toMatchObject({code:"INVALID_TRANSITION"});await expect(runtime.record(task,"task.progress",50)).rejects.toMatchObject({code:"INVALID_TRANSITION"});await runtime.record(task,"task.started");await expect(runtime.record(task,"task.resumed")).rejects.toMatchObject({code:"INVALID_TRANSITION"});await runtime.record(task,"task.waiting");await expect(runtime.record(task,"task.succeeded",{})).rejects.toMatchObject({code:"INVALID_TRANSITION"});});
 it("rejects changes after terminal state",async()=>{const runtime=new TaskRuntime(new MemoryStore());await runtime.create(task);await runtime.record(task,"task.started");await runtime.record(task,"task.succeeded",{});await expect(runtime.record(task,"task.progress",50)).rejects.toMatchObject({code:"TASK_TERMINAL"})});
 it("allows an explicit retry transition from failed but keeps success terminal",async()=>{const runtime=new TaskRuntime(new MemoryStore());await runtime.create(task);await runtime.record(task,"task.started");await runtime.record(task,"task.failed",undefined,{code:"TIMEOUT",message:"Timed out",retryable:true});const resumed=await runtime.record(task,"task.resumed");expect(resumed.status).toBe("running");await runtime.record(task,"task.succeeded",{ok:true});await expect(runtime.record(task,"task.resumed")).rejects.toMatchObject({code:"TASK_TERMINAL"});});
 it("only records replay requests for retryable failed tasks",async()=>{const runtime=new TaskRuntime(new MemoryStore());await runtime.create(task);await expect(runtime.requestReplay(task)).rejects.toMatchObject({code:"REPLAY_STATE_INVALID"});await runtime.record(task,"task.started");await runtime.record(task,"task.failed",undefined,{code:"BAD_INPUT",message:"Invalid input",retryable:false});await expect(runtime.requestReplay(task)).rejects.toMatchObject({code:"REPLAY_STATE_INVALID"});});
 it("records replay intent before explicitly resuming a retryable task",async()=>{const runtime=new TaskRuntime(new MemoryStore());await runtime.create(task);await runtime.record(task,"task.started");await runtime.record(task,"task.checkpoint",{cursor:"page-3"});await runtime.record(task,"task.failed",undefined,{code:"TEMPORARY",message:"Temporary failure",retryable:true});const replay=await runtime.requestReplay(task);expect(replay.type).toBe("task.replay_requested");expect(replay.payload).toMatchObject({attempt:2,fromSequence:4,checkpoint:{cursor:"page-3"}});const resumed=await runtime.record(task,"task.resumed");expect(resumed).toMatchObject({status:"running",lastSequence:6,error:undefined,checkpoint:{cursor:"page-3"}});});
  it("caps explicit replay requests to prevent unbounded retry loops",async()=>{
  const runtime=new TaskRuntime(new MemoryStore());
  await runtime.create(task);
  await runtime.record(task,"task.started");
  await runtime.record(task,"task.failed",undefined,{code:"TEMP",message:"Temporary",retryable:true});
  for(let attempt=0;attempt<4;attempt++){
   await runtime.requestReplay(task);
   await runtime.record(task,"task.resumed");
   await runtime.record(task,"task.failed",undefined,{code:"TEMP",message:"Temporary",retryable:true});
  }
  await expect(runtime.requestReplay(task)).rejects.toMatchObject({code:"REPLAY_LIMIT_REACHED"});
 });
 it("rebuilds a failed snapshot from immutable events",()=>{const events:TaskEvent[]=[{eventId:"1",taskId:task.taskId,sequence:1,type:"task.created",occurredAt:"2026-11-06T00:00:00Z"},{eventId:"2",taskId:task.taskId,sequence:2,type:"task.started",occurredAt:"2026-11-06T00:00:01Z"},{eventId:"3",taskId:task.taskId,sequence:3,type:"task.failed",occurredAt:"2026-11-06T00:00:02Z",error:{code:"TIMEOUT",message:"Timed out",retryable:true}}];expect(reduceTaskEvents(task,events)).toMatchObject({status:"failed",lastSequence:3,error:{code:"TIMEOUT",retryable:true}})});
 it("skips legacy events without a persisted task definition during restore",async()=>{
  const legacyEvent:TaskEvent={eventId:"legacy-1",taskId:task.taskId,sequence:1,type:"task.created",occurredAt:"2026-11-06T00:00:00Z",agent:task.agent};
  const store:TaskEventStore={append:async()=>{},read:async()=>[],readRecent:async()=>[legacyEvent]};
  await expect(new TaskRuntime(store).restoreAll()).resolves.toEqual([]);
 });
 it("remains compatible with event stores that do not implement a restore reader",async()=>{
  const store:TaskEventStore={append:async()=>{},read:async()=>[]};
  await expect(new TaskRuntime(store).restoreAll()).resolves.toEqual([]);
 });
 it("rejects reuse of a task ID with a different persisted input",async()=>{
  const runtime=new TaskRuntime(new MemoryStore());
  await runtime.create(task);
  await expect(runtime.getSnapshot({...task,input:{title:"Different film"}}))
   .rejects.toMatchObject({code:"TASK_DEFINITION_MISMATCH"});
 });
 it("rejects reuse of a task ID with a different agent or dependency contract",async()=>{
  const runtime=new TaskRuntime(new MemoryStore());
  const definition={...task,dependsOn:["source"]};
  await runtime.create(definition);
  await expect(runtime.getSnapshot({...definition,agent:"other-agent"}))
   .rejects.toMatchObject({code:"TASK_DEFINITION_MISMATCH"});
  await expect(runtime.getSnapshot({...definition,dependsOn:["other-source"]}))
   .rejects.toMatchObject({code:"TASK_DEFINITION_MISMATCH"});
 });
 it("compares task input objects independent of property insertion order",async()=>{
  const runtime=new TaskRuntime(new MemoryStore());
  await runtime.create({...task,input:{title:"Arrival",filters:{year:2016,genre:"Sci-Fi"}}});
  await expect(runtime.getSnapshot({...task,input:{filters:{genre:"Sci-Fi",year:2016},title:"Arrival"}}))
   .resolves.toMatchObject({status:"queued"});
 });
 it("rejects event streams with sequence gaps or duplicate event IDs",async()=>{
  const corruptStore:TaskEventStore={
   append:async()=>{},
   read:async()=>[
    {eventId:"same",taskId:task.taskId,sequence:1,type:"task.created",occurredAt:"2026-11-08T00:00:00Z",payload:{definition:task}},
    {eventId:"same",taskId:task.taskId,sequence:3,type:"task.started",occurredAt:"2026-11-08T00:00:01Z"},
   ],
  };
  await expect(new TaskRuntime(corruptStore).getSnapshot(task))
   .rejects.toMatchObject({code:"EVENT_STREAM_CORRUPT"});
 });
 it("checks the persisted definition before recording a lifecycle event",async()=>{
  const runtime=new TaskRuntime(new MemoryStore());
  await runtime.create(task);
  await expect(runtime.record({...task,input:{title:"Changed"}},"task.started"))
   .rejects.toMatchObject({code:"TASK_DEFINITION_MISMATCH"});
 });
});
