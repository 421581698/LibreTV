import {describe,expect,it} from 'vitest';
import {cinemaSoundRouting} from './cinema-v51-sound';
describe('Cinema Audio / Spatial single graph routing',()=>{
 it('never mixes native, wet and HRTF outputs at the same time',()=>{
  for(const audio of [false,true])for(const spatial of [false,true]){
   const r=cinemaSoundRouting(audio,spatial);
   expect(r.native+r.eq+r.spatialOutput).toBe(audio||spatial?1:0);
   expect(r.spatialRaw+r.spatialEq).toBe(spatial?1:0);
   expect(r.spatialEq).toBe(audio&&spatial?1:0);
   expect(r.eq).toBe(audio&&!spatial?1:0);
  }
 });
 it('supports dialogue DSP and HRTF together without doubling audio',()=>{
   expect(cinemaSoundRouting(true,true)).toEqual({
    native:0,eq:0,spatialRaw:0,spatialEq:1,spatialOutput:1,
   });
 });
 it('leaves source native if both processors disabled',()=>{
   expect(cinemaSoundRouting(false,false)).toEqual({
    native:0,eq:0,spatialRaw:0,spatialEq:0,spatialOutput:0,
   });
 });
});
