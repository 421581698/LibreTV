import {describe,expect,it} from 'vitest';
import type {TaskEvent} from '@/lib/friday/task-runtime';
import {DEFAULT_SPATIAL_STATE} from '../core/types';
import {activateSpace,goBackSpace,restoreHistorySnapshot} from './SpatialRouter';
import {bringPanelToFront,placePanelAvoidingOverlap,setExpandedPanel,setPanelDock,setPanelRect} from './PanelManager';
import {migrateWorkspace} from './WorkspacePersistence';
import {historyIndexFromState,snapshotFromHistoryState,SPATIAL_HISTORY_KEY,shouldAcceptWorkspaceUpdate,returnToLobby} from './SpatialRouter';
import {projectFridayState,projectTaskEvents,summarizeTasks} from './TaskProjection';
import {transitionFridayVisualState} from './FridayStateMachine';
import {assessQuality} from './QualityVerifier';
import {FMHY_CATEGORIES} from '../data/fmhy-categories';

describe('Spatial OS runtime',()=>{
 it('enters a space from the lobby and returns without mutating browser routes',()=>{const next=activateSpace(DEFAULT_SPATIAL_STATE,'resources');expect(next.activeSpace).toBe('resources');expect(next.presentation).toBe('space');expect(returnToLobby(next).presentation).toBe('lobby');});
 it('keeps browser back within the current spatial presentation before changing space history',()=>{const opened=activateSpace(DEFAULT_SPATIAL_STATE,'intelligence');expect(goBackSpace(opened).presentation).toBe('lobby');const second=activateSpace(opened,'resources');expect(goBackSpace(second).presentation).toBe('lobby');const previous=goBackSpace(goBackSpace(second));expect(previous.activeSpace).toBe('intelligence');expect(previous.presentation).toBe('space');});
 it('allows only one expanded panel',()=>{const next=setExpandedPanel(DEFAULT_SPATIAL_STATE,'quality');expect(next.expandedPanel).toBe('quality');expect(setExpandedPanel(next,null).expandedPanel).toBeNull();});
 it('keeps bounded, reversible spatial history and ignores no-op navigation',()=>{let state=DEFAULT_SPATIAL_STATE;for(const space of ['intelligence','resources','identity','cinematic','resources','identity','intelligence','cinematic','resources'] as const)state=activateSpace(state,space);expect(state.history.length).toBeLessThanOrEqual(32);expect(goBackSpace(goBackSpace(state)).activeSpace).toBe('cinematic');expect(activateSpace(state,state.activeSpace)).toBe(state);});
 it('preserves the outgoing space scroll position when restoring a previous history entry',()=>{const previous={...DEFAULT_SPATIAL_STATE,activeSpace:'cinematic' as const,scrollPositions:{cinematic:240}};const outgoing={...activateSpace(previous,'resources'),scrollPositions:{cinematic:240,resources:860}};const restored=restoreHistorySnapshot(previous,outgoing);expect(restored.activeSpace).toBe('cinematic');expect(restored.scrollPositions).toEqual({cinematic:240,resources:860});});
 it('tracks valid spatial browser history entry indexes without hijacking external entries',()=>{expect(historyIndexFromState({[SPATIAL_HISTORY_KEY]:{index:3}})).toBe(3);expect(historyIndexFromState({[SPATIAL_HISTORY_KEY]:{index:-1}})).toBe(0);expect(historyIndexFromState({})).toBe(0);});
 it('restores a validated snapshot from browser history state',()=>{const state=activateSpace(DEFAULT_SPATIAL_STATE,'resources');expect(snapshotFromHistoryState({[SPATIAL_HISTORY_KEY]:{snapshot:{...state,version:3}}})?.activeSpace).toBe('resources');expect(snapshotFromHistoryState({[SPATIAL_HISTORY_KEY]:{snapshot:{version:99,activeSpace:'resources'}}})).toBeNull();});
 it('brings focused panels to the front with a stable z-order',()=>{const first=bringPanelToFront(DEFAULT_SPATIAL_STATE,'search');const second=bringPanelToFront(first,'quality');expect(second.focusedPanel).toBe('quality');expect(second.panelOrder).toEqual(['search','quality']);expect(second.panelLayouts.quality!.zIndex).toBeGreaterThan(second.panelLayouts.search!.zIndex);});
 it('assigns opened panels to the active space and closes only the focused panel',()=>{const intelligence=activateSpace(DEFAULT_SPATIAL_STATE,'intelligence');const tasks=setExpandedPanel(intelligence,'tasks');expect(tasks.focusedPanel).toBe('tasks');expect(tasks.panelStack).toEqual([{panel:'tasks',ownerSpace:'intelligence',openedAt:expect.any(Number)}]);const quality=setExpandedPanel(tasks,'quality');expect(quality.focusedPanel).toBe('quality');expect(quality.panelStack).toEqual([{panel:'tasks',ownerSpace:'intelligence',openedAt:expect.any(Number)},{panel:'quality',ownerSpace:'intelligence',openedAt:expect.any(Number)}]);const closed=setExpandedPanel(quality,null);expect(closed.focusedPanel).toBe('tasks');expect(closed.expandedPanel).toBe('tasks');expect(closed.panelStack).toEqual([{panel:'tasks',ownerSpace:'intelligence',openedAt:expect.any(Number)}]);});
 it('supports panel docking, resizing and minimized state',()=>{const docked=setPanelDock(DEFAULT_SPATIAL_STATE,'tasks','right');expect(docked.panelLayouts.tasks?.dock).toBe('right');const resized=setPanelRect(docked,'tasks',{width:480,height:600,minimized:true});expect(resized.panelLayouts.tasks).toMatchObject({width:480,height:600,minimized:true});});
 it('places a new panel in the least-overlapping available position',()=>{const occupied=setPanelRect(DEFAULT_SPATIAL_STATE,'search',{x:12,y:12,width:360,height:520});const placed=placePanelAvoidingOverlap(occupied,'quality',{width:1200,height:800});expect(placed.panelLayouts.quality?.x).not.toBe(12);});
 it('migrates V1/V2 workspace data into per-space V3 state without losing existing values',()=>{const migrated=migrateWorkspace({version:2,activeSpace:'resources',history:['cinematic','resources','bad'],expandedPanel:'quality',scrollPositions:{resources:120,bad:999},panelLayouts:{quality:{x:10,y:20,width:400,height:500,zIndex:21,dock:'floating'}},filters:{genre:'action'}});expect(migrated.version).toBe(3);expect(migrated.activeSpace).toBe('resources');expect(migrated.history).toEqual(['cinematic','resources']);expect(migrated.expandedPanel).toBe('quality');expect(migrated.scrollPositions).toEqual({resources:120});expect(migrated.spaceStates.resources.scrollTop).toBe(120);expect(migrated.panelStack[0]).toMatchObject({panel:'quality',ownerSpace:'resources'});expect(migrated.panelLayouts.quality?.width).toBe(400);expect(migrated.filters).toEqual({genre:'action'});});

 it('orders cross-tab workspace writes by revision, timestamp and origin id',()=>{
  const current={revision:4,updatedAt:100,originId:'tab-a'};
  expect(shouldAcceptWorkspaceUpdate(current,{revision:5,updatedAt:90,originId:'tab-b'})).toBe(true);
  expect(shouldAcceptWorkspaceUpdate(current,{revision:3,updatedAt:200,originId:'tab-z'})).toBe(false);
  expect(shouldAcceptWorkspaceUpdate(current,{revision:4,updatedAt:101,originId:'tab-a'})).toBe(true);
  expect(shouldAcceptWorkspaceUpdate(current,{revision:4,updatedAt:100,originId:'tab-z'})).toBe(true);
 });
 it('records per-space expansion, scroll and selected-item state independently',()=>{
  const opened=activateSpace(DEFAULT_SPATIAL_STATE,'identity');
  const persisted={...opened,spaceStates:{...opened.spaceStates,identity:{expanded:true,scrollTop:420,selectedItemId:'profile'}}};
  const migrated=migrateWorkspace(persisted);
  expect(migrated.spaceStates.identity).toEqual({expanded:true,scrollTop:420,selectedItemId:'profile'});
  expect(migrated.spaceStates.cinematic).toEqual({expanded:false,scrollTop:0,selectedItemId:null});
 });
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
