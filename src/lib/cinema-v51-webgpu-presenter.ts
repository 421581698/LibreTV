/**
 * Cinema V5.1 Pro extended-range GPU presenter for an authenticated P010
 * VideoFrame. No HTMLVideoElement readback, no RGBA8 intermediate, and no
 * unsupported HDR card state. Browser toneMapping and physical HDR output
 * are separate facts; even a successful submission is NOT hardware proof.
 *
 * WebGPU extended canvas format requires rgba16float + display-p3, and
 * presentation is allowed only when getConfiguration confirms that mode.
 */
interface GpuDevice {
  createShaderModule(args:{code:string}):unknown;
  createRenderPipelineAsync?(args:unknown):Promise<{getBindGroupLayout(i:number):unknown}>;
  createRenderPipeline(args:unknown):{getBindGroupLayout(i:number):unknown};
  createSampler(args:unknown):unknown;
  createBuffer(args:{size:number;usage:number}):unknown;
  importExternalTexture(args:{source:unknown}):unknown;
  createBindGroup(args:unknown):unknown;
  createCommandEncoder():{
    beginRenderPass(args:unknown):{
      setPipeline(value:unknown):void;
      setBindGroup(index:number,value:unknown):void;
      draw(count:number):void;
      end():void;
    };
    finish():unknown;
  };
  queue:{submit(commands:unknown[]):void;writeBuffer(buffer:unknown,offset:number,data:Float32Array):void};
  lost:Promise<unknown>;
  destroy():void;
}
interface GpuApi{
  requestAdapter():Promise<{requestDevice():Promise<GpuDevice>}|null>;
}
interface GpuCanvas{
  configure(args:unknown):void;
  getConfiguration?():{format?:string;colorSpace?:string;toneMapping?:{mode?:string}}|null;
  getCurrentTexture():{createView():unknown};
  unconfigure?():void;
}
export interface CinemaExtendedFrame {
  readonly timestamp:number;
  readonly codedWidth?:number;
  readonly codedHeight?:number;
}
export interface CinemaExtendedUvCrop {
  uvScaleX:number;uvScaleY:number;uvOffsetX:number;uvOffsetY:number;
}
export interface CinemaExtendedPresenter{
  present:(frame:CinemaExtendedFrame,ptsUs:number,crop?:CinemaExtendedUvCrop)=>Promise<boolean>;
  stop:()=>void;
  readonly highPrecisionCanvas:boolean;
  /** GPU-submission receipt only; never a physical display HDR attestation. */
  readonly lastSubmittedPtsUs:number|null;
  readonly submittedFrameCount:number;
}
const SHADER=`
struct Out{ @builtin(position) position:vec4f,@location(0) uv:vec2f }
@group(0) @binding(0) var source:texture_external;
@group(0) @binding(1) var linearSampler:sampler;
struct Crop {scale:vec2f,offset:vec2f}
@group(0) @binding(2) var<uniform> crop:Crop;
@vertex fn vs(@builtin(vertex_index) i:u32)->Out {
  let vertices=array<vec2f,4>(
    vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(1,1));
  let p=vertices[i];
  var out:Out;
  out.position=vec4f(p,0,1);
  out.uv=vec2f((p.x+1.0)*0.5,1.0-(p.y+1.0)*0.5);
  return out;
}
@fragment fn fs(input:Out)->@location(0) vec4f {
  return textureSampleBaseClampToEdge(source,linearSampler,input.uv*crop.scale+crop.offset);
}`;
export function cinemaSupportsExtendedConfiguration(
  config:{format?:string;colorSpace?:string;toneMapping?:{mode?:string}}|null|undefined,
):boolean{
  return config?.format==='rgba16float'&&config.colorSpace==='display-p3'&&
    config.toneMapping?.mode==='extended';
}
export async function createCinemaExtendedWebGpuPresenter(
  canvas:HTMLCanvasElement,
  onFailure:(reason:string)=>void,
  api:GpuApi|null=typeof navigator!=='undefined'
    ?(navigator as Navigator&{gpu?:GpuApi}).gpu??null:null,
):Promise<CinemaExtendedPresenter|null>{
  if(!api||!canvas.isConnected||
    typeof window==='undefined'||typeof window.matchMedia!=='function'||
    !window.matchMedia('(dynamic-range: high)').matches)return null;
  const context=canvas.getContext('webgpu') as unknown as GpuCanvas|null;
  if(!context||typeof context.getConfiguration!=='function')return null;
  const adapter=await api.requestAdapter();
  if(!adapter)return null;
  const device=await adapter.requestDevice();
  let stopped=false;
  let submittedFrameCount=0;
  let lastSubmittedPtsUs:number|null=null;
  const stop=()=>{
    if(stopped)return;
    stopped=true;
    canvas.style.display='none';
    try{context.unconfigure?.();}catch{/* driver shutdown */}
    try{device.destroy();}catch{/* driver shutdown */}
  };
  try{
    context.configure({
      device,format:'rgba16float',colorSpace:'display-p3',
      alphaMode:'opaque',toneMapping:{mode:'extended'},
    });
    if(!cinemaSupportsExtendedConfiguration(context.getConfiguration()))
      throw new Error('HDR canvas toneMapping unavailable');
    const shaderModule=device.createShaderModule({code:SHADER});
    const description={
      layout:'auto',vertex:{module:shaderModule,entryPoint:'vs'},
      fragment:{module:shaderModule,entryPoint:'fs',targets:[{format:'rgba16float'}]},
      primitive:{topology:'triangle-strip'},
    };
    const pipeline=device.createRenderPipelineAsync
      ?await device.createRenderPipelineAsync(description)
      :device.createRenderPipeline(description);
    const sampler=device.createSampler({magFilter:'linear',minFilter:'linear'});
    const cropBuffer=device.createBuffer({size:16,usage:72}); // UNIFORM | COPY_DST
    void device.lost.then(()=>{
      if(stopped)return;
      stop();onFailure('WebGPU HDR 设备丢失，已恢复原生画面。');
    }).catch(()=>{});
    canvas.dataset.cinemaHdrHighPrecision='candidate';
    canvas.style.pointerEvents='none';
    canvas.style.display='none';
    return {
      highPrecisionCanvas:true,
      get lastSubmittedPtsUs(){return lastSubmittedPtsUs;},
      get submittedFrameCount(){return submittedFrameCount;},
      stop,
      async present(frame,ptsUs,crop){
        if(stopped||!canvas.isConnected||frame.timestamp!==ptsUs||
          !Number.isSafeInteger(frame.codedWidth)||!Number.isSafeInteger(frame.codedHeight)||
          (frame.codedWidth??0)<=0||(frame.codedHeight??0)<=0)return false;
        try{
          if(canvas.width!==frame.codedWidth||canvas.height!==frame.codedHeight){
            canvas.width=frame.codedWidth!;
            canvas.height=frame.codedHeight!;
          }
          const uv=crop??{uvScaleX:1,uvScaleY:1,uvOffsetX:0,uvOffsetY:0};
          if([uv.uvScaleX,uv.uvScaleY,uv.uvOffsetX,uv.uvOffsetY].some(v=>!Number.isFinite(v)) ||
             uv.uvScaleX<=0||uv.uvScaleY<=0||uv.uvOffsetX<0||uv.uvOffsetY<0||
             uv.uvScaleX+uv.uvOffsetX>1.000001||uv.uvScaleY+uv.uvOffsetY>1.000001) return false;
          device.queue.writeBuffer(cropBuffer,0,new Float32Array([
            uv.uvScaleX,uv.uvScaleY,uv.uvOffsetX,uv.uvOffsetY,
          ]));
          const external=device.importExternalTexture({source:frame});
          const group=device.createBindGroup({
            layout:pipeline.getBindGroupLayout(0),
            entries:[{binding:0,resource:external},{binding:1,resource:sampler},
              {binding:2,resource:{buffer:cropBuffer}}],
          });
          const encoder=device.createCommandEncoder();
          const pass=encoder.beginRenderPass({colorAttachments:[{
            view:context.getCurrentTexture().createView(),
            loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1},
          }]});
          pass.setPipeline(pipeline);
          pass.setBindGroup(0,group);
          pass.draw(4);
          pass.end();
          device.queue.submit([encoder.finish()]);
          if(stopped)return false;
          lastSubmittedPtsUs=ptsUs;
          submittedFrameCount++;
          canvas.dataset.cinemaHdrSubmittedPtsUs=String(ptsUs);
          canvas.style.display='block';
          return true;
        }catch{
          stop();onFailure('无法以 rgba16float HDR 画布渲染实际 P010 帧，恢复原生画面。');
          return false;
        }
      },
    };
  }catch{
    stop();return null;
  }
}
