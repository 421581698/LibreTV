import {afterEach,describe,expect,it,vi} from 'vitest';
import {createCinemaExtendedWebGpuPresenter,cinemaSupportsExtendedConfiguration} from './cinema-v51-webgpu-presenter';
afterEach(()=>vi.unstubAllGlobals());
describe('WebGPU extended output submission receipt, not physical HDR proof',()=>{
 it('requires actual canvas configuration, submits a matching frame PTS, and records a receipt',async()=>{
  vi.stubGlobal('window',{matchMedia:()=>({matches:true})});
  const submit=vi.fn();
  const context={
   configure:vi.fn(),unconfigure:vi.fn(),
   getConfiguration:()=>({format:'rgba16float',colorSpace:'display-p3',toneMapping:{mode:'extended'}}),
   getCurrentTexture:()=>({createView:()=>({})}),
  };
  const canvas={isConnected:true,width:0,height:0,style:{display:'',pointerEvents:''},dataset:{},
   getContext:()=>context};
  const pass={setPipeline:vi.fn(),setBindGroup:vi.fn(),draw:vi.fn(),end:vi.fn()};
  const device={
   createShaderModule:()=>({}),
   createRenderPipeline:()=>({getBindGroupLayout:()=>({})}),
   createSampler:()=>({}),
   createBuffer:()=>({}),
   importExternalTexture:()=>({}),
   createBindGroup:()=>({}),
   createCommandEncoder:()=>({beginRenderPass:()=>pass,finish:()=>({})}),
   queue:{submit,writeBuffer:vi.fn()},
   lost:new Promise<void>(()=>{}),
   destroy:vi.fn(),
  };
  const gpu={requestAdapter:async()=>({requestDevice:async()=>device})};
  const presenter=await createCinemaExtendedWebGpuPresenter(
   canvas as unknown as HTMLCanvasElement,vi.fn(),gpu as never);
  expect(presenter?.highPrecisionCanvas).toBe(true);
  expect(presenter?.lastSubmittedPtsUs).toBeNull();
  expect(await presenter!.present({timestamp:33367,codedWidth:2,codedHeight:2},33367)).toBe(true);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(presenter?.submittedFrameCount).toBe(1);
  expect(presenter?.lastSubmittedPtsUs).toBe(33367);
  expect(await presenter!.present({timestamp:33367,codedWidth:2,codedHeight:2},33368)).toBe(false);
  presenter?.stop();
  expect(canvas.style.display).toBe('none');
 });
 it('rejects a non-extended canvas rather than claiming HDR output',()=>{
  expect(cinemaSupportsExtendedConfiguration({format:'rgba16float',colorSpace:'display-p3',toneMapping:{mode:'standard'}})).toBe(false);
  expect(cinemaSupportsExtendedConfiguration({format:'bgra8unorm',colorSpace:'display-p3',toneMapping:{mode:'extended'}})).toBe(false);
 });
});
