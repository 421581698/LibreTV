import {describe,expect,it} from 'vitest';
import type {TaskEvent} from '@/lib/friday/task-runtime';
import {DEFAULT_SPATIAL_STATE} from '../core/types';
import {activateSpace,goBackSpace} from './SpatialRouter';
import {setExpandedPanel} from './PanelManager';
import {projectFridayState,projectTaskEvents,summarizeTasks} from './TaskProjection';
import {transitionFridayVisualState} from './FridayStateMachine';
import {assessQuality} from './QualityVerifier';
import {FMHY_CATEGORIES} from '../data/fmhy-categories';

describe('Spatial OS runtime',()=>{
 it('switches spaces and restores the previous space',()=>{const next=activateSpace(DEFAULT_SPATIAL_STATE,'resources');expect(next.activeSpace).toBe('resources');expect(goBackSpace(next).activeSpace).toBe('cinematic');});
 it('allows only one expanded panel',()=>{const next=setExpandedPanel(DEFAULT_SPATIAL_STATE,'quality');expect(next.expandedPanel).toBe('quality');expect(setExpandedPanel(next,null).expandedPanel).toBeNull();});
 it('maps detailed runtime phases and drives presentation-only transitions',()=>{expect(projectFridayState('recognizing')).toBe('thinking');expect(projectFridayState('executing')).toBe('executing');expect(transitionFridayVisualState('idle','MIC_ON')).toBe('listening');expect(transitionFridayVisualState('speaking','FAIL')).toBe('error');});
 it('keeps all 13 official FMHY categories as distinct local destinations',()=>{expect(FMHY_CATEGORIES).toHaveLength(13);expect(new Set(FMHY_CATEGORIES.map(category=>category.id)).size).toBe(13);expect(FMHY_CATEGORIES.every(category=>category.id.length>0&&category.zh.length>0)).toBe(true);});
 it('distinguishes decoded height from playlist claims',()=>{expect(assessQuality({kind:'player-decoded',decodedHeight:1080,observedAt:1}).confidence).toBe('verified');expect(assessQuality({kind:'playlist-declared',declaredHeight:1080,observedAt:1}).confidence).toBe('indicative');});
 it('reconstructs real DAG dependencies, progress, checkpoints and failure reasons',()=>{
  const events:TaskEvent[]=[
   {eventId:'e1',taskId:'quality',sequence:1,type:'task.created',occurredAt:'2026-11-08T12:00:00.000Z',agent:'quality.assess',payload:{definition:{taskId:'quality',agent:'quality.assess',input:{},dependsOn:['search'],parentTaskId:'root'}}},
   {eventId:'e2',taskId:'quality',sequence:2,type:'task.started',occurredAt:'2026-11-08T12:00:01.000Z',agent:'quality.assess'},
   {eventId:'e3',taskId:'quality',sequence:3,type:'task.progress',occurredAt:'2026-11-08T12:00:02.000Z',agent:'quality.assess',payload:{percent:45}},
   {eventId:'e4',taskId:'quality',sequence:4,type:'task.checkpoint',occurredAt:'2026-11-08T12:00:03.000Z',agent:'quality.assess',payload:{label:'已完成源探测'}},
   {eventId:'e5',taskId:'quality',sequence:5,type:'task.failed',occurredAt:'2026-11-08T12:00:04.000Z',agent:'quality.assess',error:{code:'SOURCE_TIMEOUT',message:'源站超时',retryable:true}},
  ];
  const [task]=projectTaskEvents(events);
  expect(task.status).toBe('failed');
  expect(task.dependsOn).toEqual(['search']);
  expect(task.parentTaskId).toBe('root');
  expect(task.progress).toBe('45%');
  expect(task.checkpoint).toBe('已完成源探测');
  expect(task.error?.code).toBe('SOURCE_TIMEOUT');
  expect(summarizeTasks([task]).failed).toBe(1);
 });
});
