import type {FridayVisualState} from '../core/types';
export type RuntimePhase='idle'|'listening'|'recognizing'|'thinking'|'executing'|'rendering'|'result'|'recovering'|'error';
export function projectFridayState(phase:RuntimePhase):FridayVisualState {
 switch(phase){case'listening':case'recognizing':return'listening';case'thinking':return'thinking';case'executing':case'rendering':return'executing';case'error':return'error';default:return'idle';}
}
export interface TaskProjection{id:string;label:string;status:'waiting'|'running'|'succeeded'|'failed'|'cancelled';progress?:number;}
export function summarizeTasks(tasks:readonly TaskProjection[]){return{total:tasks.length,running:tasks.filter(t=>t.status==='running').length,failed:tasks.filter(t=>t.status==='failed').length,completed:tasks.filter(t=>t.status==='succeeded').length};}
