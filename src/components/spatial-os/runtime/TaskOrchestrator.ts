import {runFridayDag,type FridayAgent,type DagRunResult} from '@/lib/friday/dag-orchestrator';
import type {TaskDefinition} from '@/lib/friday/task-runtime';
import type {TaskRuntime} from '@/lib/friday/task-runtime';
/** Adapter to the existing DAG runtime. It deliberately adds no competing task state or retry policy. */
export function createSpatialTaskOrchestrator(runtime:TaskRuntime,agents:FridayAgent[]){
 return {run(tasks:TaskDefinition[],options?:{signal?:AbortSignal;replayFailed?:boolean;maxAttempts?:number}):Promise<DagRunResult[]>{
  return runFridayDag({tasks,agents,runtime,...options});
 }};
}
