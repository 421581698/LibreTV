import {describe,expect,it} from "vitest";
import {reduceTaskEvents,TaskRuntime,TaskRuntimeError,validateTaskGraph,type TaskDefinition,type TaskEvent,type TaskEventStore} from "./task-runtime";
class MemoryStore implements TaskEventStore { private data=new Map<string,TaskEvent[]>(); async append(event:TaskEvent){const list=this.data.get(event.taskId)??[];list.push(event);this.data.set(event.taskId,list)} async read(id:string){return [...(this.data.get(id)??[])]} async readAll(){return [...this.data.values()].flat()} }
const task:TaskDefinition={taskId:"movie-search-1",agent:"search-agent",input:{title:"Arrival"}};
describe("Friday task runtime",()=>{
 it("restores task snapshots from the durable event log after a reload",async()=>{
  const store=new MemoryStore();
  const firstRuntime=new TaskRuntime(store);
  await firstRuntime.create({...task,dependsOn:["source"],sideEffect:false});
  await firstRuntime.record(task,"task.started");
  await firstRuntime.record(task,"task.checkpoint",{cursor:"page-2"});
  const restored=await new TaskRuntime(store).restoreAll();
  expect(restored).toHaveLength(1);
  expect(restored[0]).toMatchObject({taskId:task.taskId,status:"running",input:task.input,dependsOn:["source"],checkpoint:{cursor:"page-2"},lastSequence:3});
 });
 it("rejects cyclic DAG dependencies",()=>{expect(()=>validateTaskGraph([{...task,dependsOn:["quality"]},{taskId:"quality",agent:"quality-agent",input:{},dependsOn:[task.taskId]}])).toThrowError(TaskRuntimeError)});
 it("records lifecycle and reconstructs checkpoints",async()=>{const runtime=new TaskRuntime(new MemoryStore(),()=>"2026-11-06T00:00:00Z",()=>"event-id");await runtime.create(task);await runtime.record(task,"task.started");await runtime.record(task,"task.checkpoint",{cursor:"source-2"});const result=await runtime.record(task,"task.succeeded",{matches:3});expect(result).toMatchObject({status:"succeeded",checkpoint:{cursor:"source-2"},output:{matches:3}})});
 it("blocks automatic replay for side effects",async()=>{const side={...task,taskId:"player-control-1",sideEffect:true};const runtime=new TaskRuntime(new MemoryStore());await runtime.create(side);await expect(runtime.requestReplay(side)).rejects.toMatchObject({code:"REPLAY_SIDE_EFFECT_BLOCKED"})});
 it("rejects lifecycle transitions that skip required states",async()=>{const runtime=new TaskRuntime(new MemoryStore());await runtime.create(task);await expect(runtime.record(task,"task.succeeded",{})).rejects.toMatchObject({code:"INVALID_TRANSITION"});await expect(runtime.record(task,"task.progress",50)).rejects.toMatchObject({code:"INVALID_TRANSITION"});await runtime.record(task,"task.started");await expect(runtime.record(task,"task.resumed")).rejects.toMatchObject({code:"INVALID_TRANSITION"});await runtime.record(task,"task.waiting");await expect(runtime.record(task,"task.succeeded",{})).rejects.toMatchObject({code:"INVALID_TRANSITION"});});
 it("rejects changes after terminal state",async()=>{const runtime=new TaskRuntime(new MemoryStore());await runtime.create(task);await runtime.record(task,"task.started");await runtime.record(task,"task.succeeded",{});await expect(runtime.record(task,"task.progress",50)).rejects.toMatchObject({code:"TASK_TERMINAL"})});
 it("allows an explicit retry transition from failed but keeps success terminal",async()=>{const runtime=new TaskRuntime(new MemoryStore());await runtime.create(task);await runtime.record(task,"task.started");await runtime.record(task,"task.failed",undefined,{code:"TIMEOUT",message:"Timed out",retryable:true});const resumed=await runtime.record(task,"task.resumed");expect(resumed.status).toBe("running");await runtime.record(task,"task.succeeded",{ok:true});await expect(runtime.record(task,"task.resumed")).rejects.toMatchObject({code:"TASK_TERMINAL"});});
 it("only records replay requests for retryable failed tasks",async()=>{const runtime=new TaskRuntime(new MemoryStore());await runtime.create(task);await expect(runtime.requestReplay(task)).rejects.toMatchObject({code:"REPLAY_STATE_INVALID"});await runtime.record(task,"task.started");await runtime.record(task,"task.failed",undefined,{code:"BAD_INPUT",message:"Invalid input",retryable:false});await expect(runtime.requestReplay(task)).rejects.toMatchObject({code:"REPLAY_STATE_INVALID"});});
 it("records replay intent before explicitly resuming a retryable task",async()=>{const runtime=new TaskRuntime(new MemoryStore());await runtime.create(task);await runtime.record(task,"task.started");await runtime.record(task,"task.checkpoint",{cursor:"page-3"});await runtime.record(task,"task.failed",undefined,{code:"TEMPORARY",message:"Temporary failure",retryable:true});const replay=await runtime.requestReplay(task);expect(replay.type).toBe("task.replay_requested");expect(replay.payload).toMatchObject({fromSequence:4,checkpoint:{cursor:"page-3"}});const resumed=await runtime.record(task,"task.resumed");expect(resumed).toMatchObject({status:"running",lastSequence:6,error:undefined,checkpoint:{cursor:"page-3"}});});
 it("rebuilds a failed snapshot from immutable events",()=>{const events:TaskEvent[]=[{eventId:"1",taskId:task.taskId,sequence:1,type:"task.created",occurredAt:"2026-11-06T00:00:00Z"},{eventId:"2",taskId:task.taskId,sequence:2,type:"task.started",occurredAt:"2026-11-06T00:00:01Z"},{eventId:"3",taskId:task.taskId,sequence:3,type:"task.failed",occurredAt:"2026-11-06T00:00:02Z",error:{code:"TIMEOUT",message:"Timed out",retryable:true}}];expect(reduceTaskEvents(task,events)).toMatchObject({status:"failed",lastSequence:3,error:{code:"TIMEOUT",retryable:true}})});
 it("skips legacy events without a persisted task definition during restore",async()=>{
  const legacyEvent:TaskEvent={eventId:"legacy-1",taskId:task.taskId,sequence:1,type:"task.created",occurredAt:"2026-11-06T00:00:00Z",agent:task.agent};
  const store:TaskEventStore={append:async()=>{},read:async()=>[],readAll:async()=>[legacyEvent]};
  await expect(new TaskRuntime(store).restoreAll()).resolves.toEqual([]);
 });
 it("remains compatible with event stores that do not implement readAll",async()=>{
  const store:TaskEventStore={append:async()=>{},read:async()=>[]};
  await expect(new TaskRuntime(store).restoreAll()).resolves.toEqual([]);
 });
});
