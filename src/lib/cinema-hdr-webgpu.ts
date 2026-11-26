import { cinemaCanvasGeometry } from './cinema-hdr-geometry';
import { startCinemaSdrGpu, type CinemaGpuCallback, type CinemaGpuSession } from './cinema-hdr-gpu';

/**
 * Optional WebGPU SDR video-processing backend. Attempts WebGPU first, then
 * falls back to tested WebGL initialization. Native HDR decoded output must
 * NOT pass through this SDR canvas pipeline.
 *
 * These minimal structural types avoid depending on experimental DOM GPU
 * declarations that are missing in older TypeScript lib.dom versions.
 */
interface WebGpuDevice {
  createShaderModule(args: {code: string}): unknown;
  createRenderPipeline(args: unknown): {getBindGroupLayout(index: number): unknown};
  createRenderPipelineAsync?(args:unknown):Promise<{getBindGroupLayout(index:number):unknown}>;
  pushErrorScope?(type:'validation'):void;
  popErrorScope?():Promise<{message:string}|null>;
  createSampler(args: unknown): unknown;
  createBuffer(args: {size: number; usage: number}): unknown;
  createBindGroup(args: unknown): unknown;
  importExternalTexture(args: {source: HTMLVideoElement}): unknown;
  createCommandEncoder(): {
    beginRenderPass(args: unknown): {
      setPipeline(value: unknown): void; setBindGroup(index: number,value:unknown):void;
      draw(vertices:number):void; end():void;
    };
    finish(): unknown;
  };
  queue: { writeBuffer(buffer:unknown, offset:number, data:Float32Array):void; submit(commands:unknown[]):void };
  destroy(): void;
  lost: Promise<unknown>;
}
interface WebGpuHost {
  requestAdapter(): Promise<{requestDevice(): Promise<WebGpuDevice>} | null>;
  getPreferredCanvasFormat(): string;
}
interface WebGpuContext {
  configure(args: unknown): void;
  getCurrentTexture(): {createView(): unknown};
  unconfigure?(): void;
}
const SHADER = `
struct Params { uvScale: vec2f, uvOffset: vec2f }
@group(0) @binding(0) var frameSampler: sampler;
@group(0) @binding(1) var frameTexture: texture_external;
@group(0) @binding(2) var<uniform> params: Params;
struct VertexOut { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vertexMain(@builtin(vertex_index) i: u32) -> VertexOut {
  let corners = array<vec2f,4>(
    vec2f(-1.0,-1.0),vec2f(1.0,-1.0),vec2f(-1.0,1.0),vec2f(1.0,1.0)
  );
  let p = corners[i];
  var out: VertexOut;
  out.position = vec4f(p,0.0,1.0);
  out.uv = vec2f((p.x + 1.0) * 0.5, 1.0 - (p.y + 1.0) * 0.5);
  return out;
}
fn sampleFrame(uv:vec2f)->vec3f {
  return textureSampleBaseClampToEdge(frameTexture,frameSampler,uv).rgb;
}
@fragment fn fragmentMain(input:VertexOut)->@location(0) vec4f {
  let uv = input.uv * params.uvScale + params.uvOffset;
  let source = sampleFrame(uv);
  let lumaCoeffs = vec3f(0.2126,0.7152,0.0722);
  let scene = 0.25 * (
    dot(sampleFrame(vec2f(0.25,0.25)),lumaCoeffs)
   +dot(sampleFrame(vec2f(0.75,0.25)),lumaCoeffs)
   +dot(sampleFrame(vec2f(0.25,0.75)),lumaCoeffs)
   +dot(sampleFrame(vec2f(0.75,0.75)),lumaCoeffs));
  // Strong SDR look inspired by scene-referred tone mapping in mature
  // video renderers. Deliberately never represents native Dolby Vision/HDR.
  let gain = clamp(1.015+(0.45-scene)*0.31,0.87,1.19);
  let exposed = clamp(source*gain,vec3f(0.0),vec3f(1.0));
  let shadows = mix(exposed,sqrt(max(exposed,vec3f(0.0))),0.15);
  let highlights = shadows/(shadows+(vec3f(1.0)-shadows)*0.91);
  let contrast = clamp((highlights-vec3f(0.5))*1.16+vec3f(0.5),vec3f(0.0),vec3f(1.0));
  let luma = dot(contrast,lumaCoeffs);
  let chroma = contrast-vec3f(luma);
  let saturation = 1.15-0.22*smoothstep(0.7,1.0,luma);
  let saturated = clamp(vec3f(luma)+chroma*saturation,vec3f(0.0),vec3f(1.0));
  return vec4f(saturated,1.0);
}`;

async function startWebGpu(
  gpu: WebGpuHost, video: HTMLVideoElement, host: HTMLElement, onStatus: CinemaGpuCallback, enableP3: boolean,
): Promise<CinemaGpuSession | null> {
  const adapter = await gpu.requestAdapter();
  if (!adapter || !video.isConnected || !host.isConnected) return null;
  const device = await adapter.requestDevice();
  if (!video.isConnected || !host.isConnected) { device.destroy(); return null; }
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgpu') as unknown as WebGpuContext | null;
  if (!context) { device.destroy(); return null; }
  const format = gpu.getPreferredCanvasFormat();
  try {
    context.configure({device,format,alphaMode:'opaque',colorSpace:enableP3 ? 'display-p3' : 'srgb'});
  } catch {
    try { context.configure({device,format,alphaMode:'opaque'}); }
    catch { device.destroy(); return null; }
  }
  let pipeline: {getBindGroupLayout(index:number):unknown};
  try {
    device.pushErrorScope?.('validation');
    const shaderModule = device.createShaderModule({code:SHADER});
    const description = {
      layout:'auto',vertex:{module:shaderModule,entryPoint:'vertexMain'},
      fragment:{module:shaderModule,entryPoint:'fragmentMain',targets:[{format}]},
      primitive:{topology:'triangle-strip'},
    };
    pipeline = device.createRenderPipelineAsync
      ? await device.createRenderPipelineAsync(description)
      : device.createRenderPipeline(description);
    const validation = await device.popErrorScope?.();
    if (validation) throw new Error(validation.message);
  } catch {
    context.unconfigure?.();
    device.destroy();
    return null;
  }
  const sampler = device.createSampler({magFilter:'linear',minFilter:'linear'});
  const params = device.createBuffer({size:16,usage:72}); // UNIFORM (64) | COPY_DST (8)
  canvas.dataset.cinemaHdrGpu = 'true';
  canvas.setAttribute('aria-hidden','true');
  canvas.style.cssText = 'position:absolute;pointer-events:none;z-index:1;display:none;';
  host.append(canvas);
  let stopped = false;
  let raf = 0;
  let firstFrame = false;
  let lastFrame = 0;
  let maxDimension = 1280;
  let slowFrames = 0;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    canvas.remove();
    context.unconfigure?.();
    device.destroy();
  };
  void device.lost.then(() => {
    if (stopped) return;
    stop();
    onStatus('unavailable','WebGPU 设备连接已丢失，已恢复原始视频。');
  }).catch(() => {});
  const render = (now:number) => {
    if (stopped) return;
    raf = requestAnimationFrame(render);
    if (!video.isConnected || !host.isConnected) {
      stop();
      onStatus('unavailable','原播放器已切换媒体，旧视频画质处理已关闭。');
      return;
    }
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight ||
        Array.from(video.textTracks).some(track => track.mode === 'showing') ||
        document.fullscreenElement === video) {
      canvas.style.display = 'none';
      return;
    }
    if (now-lastFrame < 33) return;
    lastFrame = now;
    const started = performance.now();
    const geometry = cinemaCanvasGeometry(video.getBoundingClientRect(),
      host.getBoundingClientRect(),video.videoWidth,video.videoHeight,getComputedStyle(video).objectFit);
    if (geometry.width <= 0 || geometry.height <= 0) return;
    const ratio = Math.min(1,maxDimension/Math.max(video.videoWidth,video.videoHeight));
    const w = Math.max(1,Math.round(video.videoWidth*ratio));
    const h = Math.max(1,Math.round(video.videoHeight*ratio));
    canvas.style.left = `${geometry.left}px`;
    canvas.style.top = `${geometry.top}px`;
    canvas.style.width = `${geometry.width}px`;
    canvas.style.height = `${geometry.height}px`;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    try {
      const frame = device.importExternalTexture({source: video});
      device.queue.writeBuffer(params,0,new Float32Array([
        geometry.uvScaleX,geometry.uvScaleY,geometry.uvOffsetX,geometry.uvOffsetY,
      ]));
      const bindGroup = device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
        {binding:0,resource:sampler},{binding:1,resource:frame},{binding:2,resource:{buffer:params}},
      ]});
      const encoder=device.createCommandEncoder();
      const pass=encoder.beginRenderPass({colorAttachments:[{
        view:context.getCurrentTexture().createView(),
        loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1},
      }]});
      pass.setPipeline(pipeline);
      pass.setBindGroup(0,bindGroup);
      pass.draw(4);
      pass.end();
      device.queue.submit([encoder.finish()]);
      canvas.style.display = 'block';
      if (!firstFrame) {
        firstFrame = true;
        onStatus('active','Cinema Vision WebGPU 已处理 SDR 画面（实际 HDR 和 10-bit 输出未经确认）。');
      }
      slowFrames = performance.now()-started > 22 ? slowFrames+1 : Math.max(0,slowFrames-1);
      if (slowFrames >= 12 && maxDimension>640) { maxDimension=maxDimension===1280?960:640; slowFrames=0; }
    } catch {
      stop();
      onStatus('unavailable','此视频不支持 WebGPU 纹理读取或设备处理失败，已恢复原画。');
    }
  };
  raf=requestAnimationFrame(render);
  return {stop,backend:'webgpu'};
}

/** Use WebGPU when available; failed initialization falls back to WebGL. */
export async function startCinemaSdrEnhancedGpu(
  video:HTMLVideoElement,host:HTMLElement,onStatus:CinemaGpuCallback,enableP3=false,
):Promise<CinemaGpuSession|null> {
  const gpu = (navigator as Navigator & {gpu?:WebGpuHost}).gpu;
  if (gpu && typeof gpu.requestAdapter === 'function') {
    let session: CinemaGpuSession | null = null;
    let stopped = false;
    let processedWebGpuFrame = false;
    const wrapper: CinemaGpuSession = {
      get backend() { return session?.backend ?? 'webgpu'; },
      stop() { stopped=true; session?.stop(); },
    };
    try {
      const webGpuSession = await startWebGpu(gpu,video,host,(status,message) => {
        if (stopped) return;
        if (status === 'active') {
          processedWebGpuFrame = true;
          onStatus(status,message);
          return;
        }
        // A device loss or unsupported external video texture is not the end
        // of enhancement: actually try the independent WebGL processing path.
        if (!video.isConnected || !host.isConnected) {
          onStatus(status,message);
          return;
        }
        const fallback = startCinemaSdrGpu(video,host,onStatus,enableP3);
        if (fallback) {
          session=fallback;
          if (processedWebGpuFrame) {
            // A previously illuminated card is still valid only if WebGL
            // subsequently confirms a newly processed frame.
            onStatus('recovering','WebGPU 已停止，正在尝试 WebGL 重新处理视频帧。');
          }
        } else if (!processedWebGpuFrame) {
          onStatus(status,message);
        }
      },enableP3);
      if (stopped) { webGpuSession?.stop(); return null; }
      if (webGpuSession) {
        session = webGpuSession;
        return wrapper;
      }
    } catch {
      // Adapter/device/shader failure: continue with a fresh WebGL context.
    }
    if (video.isConnected && host.isConnected && !stopped) {
      session = startCinemaSdrGpu(video,host,onStatus,enableP3);
      return session ? wrapper : null;
    }
    return null;
  }
  if (!video.isConnected || !host.isConnected) return null;
  return startCinemaSdrGpu(video,host,onStatus,enableP3);
}
