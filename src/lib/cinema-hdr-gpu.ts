/**
 * Real SDR frame enhancement using a WebGL fragment shader. Never claims a
 * Dolby/HDR10+/10-bit hardware output. A media-element texture upload is only
 * legal for same-origin or CORS-authorized video; failure leaves native playback
 * entirely untouched. This deliberately does NOT replace Safari's HDR decoder.
 */
export type CinemaGpuStatus = 'active' | 'unavailable' | 'failed';
export type CinemaGpuBackend = 'webgl2' | 'webgl1';
export type CinemaGpuCallback = (status: CinemaGpuStatus, explanation: string) => void;
export interface CinemaGpuSession { stop(): void; backend: CinemaGpuBackend; }

/** Colors operate on available SDR samples; clipped source detail cannot be reconstructed. */
const VERTEX = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = vec2((a_position.x + 1.0) * 0.5, 1.0 - (a_position.y + 1.0) * 0.5);
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;
const FRAGMENT = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_video;
uniform float u_strength;
void main() {
  vec3 sampleColor = texture2D(u_video, v_uv).rgb;
  // Estimate scene luminance from a bounded four-position sample. The estimate
  // adjusts independently for every decoded frame (not a static CSS filter).
  float scene = 0.0;
  scene += dot(texture2D(u_video, vec2(0.25, 0.25)).rgb, vec3(0.2126, 0.7152, 0.0722));
  scene += dot(texture2D(u_video, vec2(0.75, 0.25)).rgb, vec3(0.2126, 0.7152, 0.0722));
  scene += dot(texture2D(u_video, vec2(0.25, 0.75)).rgb, vec3(0.2126, 0.7152, 0.0722));
  scene += dot(texture2D(u_video, vec2(0.75, 0.75)).rgb, vec3(0.2126, 0.7152, 0.0722));
  scene *= 0.25;
  // Mild inverse-tone-curve / contrast enhancement: this is SDR appearance
  // processing and does not create a PQ/HLG HDR signal.
  float gain = clamp(0.98 + (0.45 - scene) * 0.24, 0.88, 1.13);
  vec3 exposed = clamp(sampleColor * gain, 0.0, 1.0);
  vec3 shadows = mix(exposed, sqrt(max(exposed, vec3(0.0))), 0.09 * u_strength);
  vec3 highlights = shadows / (shadows + (vec3(1.0) - shadows) * (1.0 - 0.05 * u_strength));
  vec3 contrast = clamp((highlights - 0.5) * (1.0 + 0.09 * u_strength) + 0.5, 0.0, 1.0);
  float luma = dot(contrast, vec3(0.2126, 0.7152, 0.0722));
  vec3 saturated = clamp(vec3(luma) + (contrast - vec3(luma)) * (1.0 + 0.07 * u_strength), 0.0, 1.0);
  gl_FragColor = vec4(mix(sampleColor, saturated, u_strength), 1.0);
}`;
function shader(gl: WebGLRenderingContext, type: number, code: string): WebGLShader {
  const handle = gl.createShader(type);
  if (!handle) throw new Error('GPU shader allocation unavailable');
  gl.shaderSource(handle, code);
  gl.compileShader(handle);
  if (!gl.getShaderParameter(handle, gl.COMPILE_STATUS)) {
    const reason = gl.getShaderInfoLog(handle) || 'shader compilation failed';
    gl.deleteShader(handle);
    throw new Error(reason);
  }
  return handle;
}
export function startCinemaSdrGpu(
  video: HTMLVideoElement, host: HTMLElement, onStatus: CinemaGpuCallback,
): CinemaGpuSession | null {
  const canvas = document.createElement('canvas');
  canvas.dataset.cinemaHdrGpu = 'true';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;pointer-events:none;z-index:1;display:none;';
  const gl = (canvas.getContext('webgl2', {alpha:false,antialias:false,preserveDrawingBuffer:false}) ??
    canvas.getContext('webgl', {alpha:false,antialias:false,preserveDrawingBuffer:false})) as WebGLRenderingContext | null;
  if (!gl) {
    onStatus('unavailable', '此设备未提供可用的 WebGL 视频增强路径，保留原始视频。');
    return null;
  }
  const backend: CinemaGpuBackend = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
    ? 'webgl2' : 'webgl1';
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let texture: WebGLTexture | null = null;
  let vertex: WebGLShader | null = null;
  let fragment: WebGLShader | null = null;
  let raf = 0;
  let finished = false;
  let active = false;
  let firstFrame = false;
  let lastFrameAt = 0;
  let maxDimension = 1280;
  let slowFrames = 0;
  // Existing video stays visible until the first successfully processed GPU
  // frame; errors cannot silently blank the picture.
  const stop = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    canvas.remove();
    if (texture) gl.deleteTexture(texture);
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
  };
  try {
    vertex = shader(gl, gl.VERTEX_SHADER, VERTEX);
    fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    program = gl.createProgram();
    if (!program) throw new Error('GPU program allocation unavailable');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'GPU link failed');
    buffer = gl.createBuffer();
    texture = gl.createTexture();
    if (!buffer || !texture) throw new Error('GPU resources unavailable');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    gl.useProgram(program);
    const position = gl.getAttribLocation(program, 'a_position');
    if (position < 0) throw new Error('GPU vertex attribute unavailable');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.uniform1i(gl.getUniformLocation(program, 'u_video'), 0);
    gl.uniform1f(gl.getUniformLocation(program, 'u_strength'), 1);
    host.append(canvas);
  } catch {
    stop();
    onStatus('failed', '画质 GPU 引擎初始化失败，已保留原始播放。');
    return null;
  }
  const render = (now: number) => {
    if (finished) return;
    raf = requestAnimationFrame(render);
    if (!video.isConnected || !host.isConnected) {
      stop();
      onStatus('unavailable', '播放元素已切换，关闭旧视频的画质增强。');
      return;
    }
    // Preserve native subtitles (which may be composited into the video layer),
    // and do not draw over an element while it is entering native fullscreen.
    const subtitlesActive = Array.from(video.textTracks).some(t => t.mode === 'showing');
    if (video.readyState < 2 || video.videoWidth < 1 || video.videoHeight < 1 ||
        subtitlesActive || document.fullscreenElement === video) {
      canvas.style.display = 'none';
      active = false;
      return;
    }
    if (now - lastFrameAt < 33) return;
    const started = performance.now();
    lastFrameAt = now;
    const containerBounds = host.getBoundingClientRect();
    const videoBounds = video.getBoundingClientRect();
    if (videoBounds.width <= 0 || videoBounds.height <= 0) return;
    const width = Math.max(1, Math.round(videoBounds.width));
    const height = Math.max(1, Math.round(videoBounds.height));
    canvas.style.left = `${videoBounds.left - containerBounds.left}px`;
    canvas.style.top = `${videoBounds.top - containerBounds.top}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ratio = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
    const deviceWidth = Math.max(1, Math.round(video.videoWidth * ratio));
    const deviceHeight = Math.max(1, Math.round(video.videoHeight * ratio));
    if (canvas.width !== deviceWidth || canvas.height !== deviceHeight) {
      canvas.width = deviceWidth;
      canvas.height = deviceHeight;
      gl.viewport(0, 0, deviceWidth, deviceHeight);
    }
    try {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (gl.isContextLost()) throw new Error('GPU context lost');
      canvas.style.display = 'block';
      active = true;
      if (!firstFrame) {
        firstFrame = true;
        onStatus('active', 'Cinema Vision SDR GPU 增强已实际处理视频帧（非 Dolby Vision / 原生 HDR 输出）。');
      }
      // Degrade resolution if recurrent long frames threaten iPad playback.
      slowFrames = performance.now() - started > 22 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
      if (slowFrames >= 12 && maxDimension > 640) { maxDimension = maxDimension === 1280 ? 960 : 640; slowFrames = 0; }
    } catch {
      stop();
      onStatus('unavailable', '当前片源不允许浏览器读取视频帧（可能是跨域/受保护内容）或 GPU 失败，已恢复原始播放。');
    }
  };
  raf = requestAnimationFrame(render);
  return {stop, backend};
}
