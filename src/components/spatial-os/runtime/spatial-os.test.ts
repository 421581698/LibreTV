import {describe,expect,it} from 'vitest';
import {DEFAULT_SPATIAL_STATE} from '../core/types';
import {activateSpace,goBackSpace} from './SpatialRouter';
import {setExpandedPanel} from './PanelManager';
import {projectFridayState} from './TaskProjection';
import {transitionFridayVisualState} from './FridayStateMachine';
import {assessQuality} from './QualityVerifier';
describe('Spatial OS runtime',()=>{
 it('switches spaces and restores the previous space',()=>{const next=activateSpace(DEFAULT_SPATIAL_STATE,'resources');expect(next.activeSpace).toBe('resources');expect(goBackSpace(next).activeSpace).toBe('cinematic');});
 it('allows only one expanded panel',()=>{const next=setExpandedPanel(DEFAULT_SPATIAL_STATE,'quality');expect(next.expandedPanel).toBe('quality');expect(setExpandedPanel(next,null).expandedPanel).toBeNull();});
 it('maps detailed runtime phases and drives presentation-only transitions',()=>{expect(projectFridayState('recognizing')).toBe('listening');expect(projectFridayState('executing')).toBe('executing');expect(transitionFridayVisualState('idle','MIC_ON')).toBe('listening');expect(transitionFridayVisualState('speaking','FAIL')).toBe('error');});
 it('distinguishes decoded height from playlist claims',()=>{expect(assessQuality({kind:'player-decoded',decodedHeight:1080,observedAt:1}).confidence).toBe('verified');expect(assessQuality({kind:'playlist-declared',declaredHeight:1080,observedAt:1}).confidence).toBe('indicative');});
});
