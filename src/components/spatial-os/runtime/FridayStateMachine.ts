import type {FridayVisualState} from '../core/types';
export type FridayVisualEvent='MIC_ON'|'MIC_OFF'|'REQUEST'|'TASK_START'|'TASK_DONE'|'TTS_START'|'TTS_END'|'FAIL'|'RESET';
/** Presentation-only reducer. ASR/TTS/VAD and Task Runtime remain the owners of real execution. */
export function transitionFridayVisualState(current:FridayVisualState,event:FridayVisualEvent):FridayVisualState {
 switch(event){
  case'MIC_ON':return'listening';
  case'MIC_OFF':case'TTS_END':case'TASK_DONE':case'RESET':return'idle';
  case'REQUEST':return'thinking';
  case'TASK_START':return'executing';
  case'TTS_START':return'speaking';
  case'FAIL':return'error';
  default:return current;
 }
}
