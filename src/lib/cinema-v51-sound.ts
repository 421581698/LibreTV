/**
 * Cinema Audio / Spatial V5.1 Pro: captured-stream Web Audio DSP.
 *
 * The original video element is never permanently transferred to a
 * MediaElementAudioSourceNode. That API cannot be undone for an ArtPlayer
 * element reused across cross-origin source switches, and can permanently
 * silence a CORS-restricted stream. captureStream() is optional; unsupported,
 * DRM, cross-origin, and silent capture fail closed without muting the video.
 *
 * HRTF is the browser's binaural PannerNode model, NOT Dolby Atmos object
 * decoding, licensed HRTF datasets, bitstream passthrough, or speaker proof.
 */
export type CinemaSoundMode = 'audio' | 'spatial';
export interface CinemaSoundState {
  audio:boolean;
  spatial:boolean;
  output:'captured-dsp'|'native';
  reason:string;
}
export interface CinemaSoundSession {
  enable(mode:CinemaSoundMode,enabled:boolean):void;
  state():CinemaSoundState;
  stop():void;
}
interface CapturableVideo extends HTMLVideoElement {
  captureStream?:()=>MediaStream;
  mozCaptureStream?:()=>MediaStream;
}
const RAMP_SECONDS=.045;
export function cinemaSoundRouting(audio:boolean,spatial:boolean) {
  return {
    native:0,
    eq:audio&&!spatial?1:0,
    spatialRaw:spatial&&!audio?1:0,
    spatialEq:spatial&&audio?1:0,
    spatialOutput:spatial?1:0,
  };
}
function safeGain(gain:AudioParam,value:number,context:AudioContext) {
  const now=context.currentTime;
  gain.cancelScheduledValues(now);
  gain.setTargetAtTime(value,now,RAMP_SECONDS);
}
function panner(context:AudioContext,x:number):PannerNode {
  const node=context.createPanner();
  node.panningModel='HRTF';
  node.distanceModel='inverse';
  node.refDistance=1;
  node.rolloffFactor=0;
  node.coneOuterGain=1;
  if('positionX' in node && node.positionX) {
    node.positionX.setValueAtTime(x,context.currentTime);
    node.positionY.setValueAtTime(0,context.currentTime);
    node.positionZ.setValueAtTime(-1,context.currentTime);
  } else {
    node.setPosition(x,0,-1);
  }
  return node;
}
function configureEq(context:AudioContext) {
  const bass=context.createBiquadFilter();
  bass.type='lowshelf';bass.frequency.value=135;bass.gain.value=2.1;
  const voice=context.createBiquadFilter();
  voice.type='peaking';voice.frequency.value=2500;voice.Q.value=.85;voice.gain.value=2.4;
  const highs=context.createBiquadFilter();
  highs.type='highshelf';highs.frequency.value=6200;highs.gain.value=1.1;
  const compressor=context.createDynamicsCompressor();
  compressor.threshold.value=-18;compressor.knee.value=17;
  compressor.ratio.value=2.6;compressor.attack.value=.006;compressor.release.value=.26;
  const limiter=context.createDynamicsCompressor();
  limiter.threshold.value=-3;limiter.knee.value=0;limiter.ratio.value=12;
  limiter.attack.value=.002;limiter.release.value=.09;
  bass.connect(voice);voice.connect(highs);highs.connect(compressor);compressor.connect(limiter);
  return {input:bass,output:limiter};
}
function capturedAudioSource(video:CapturableVideo):MediaStream|null {
  try {
    const capture=video.captureStream?.bind(video)??video.mozCaptureStream?.bind(video);
    if(!capture) return null;
    const stream=capture();
    if(!stream.getAudioTracks().some(track=>track.readyState==='live'&&!track.muted)) {
      stream.getTracks().forEach(track=>track.stop());
      return null;
    }
    return stream;
  } catch { return null; }
}
export async function createCinemaSoundSession(
  video:HTMLVideoElement,onState:(state:CinemaSoundState)=>void,
):Promise<CinemaSoundSession|null> {
  if(typeof window==='undefined'||!(window.AudioContext||('webkitAudioContext' in window))) {
    onState({audio:false,spatial:false,output:'native',reason:'Web Audio 引擎不可用，保留原始声音。'});
    return null;
  }
  if(video.muted||video.volume===0){
    onState({audio:false,spatial:false,output:'native',reason:'请先恢复原生音轨和可听音量，再开启 DSP/空间化。'});
    return null;
  }
  const stream=capturedAudioSource(video);
  if(!stream) {
    onState({audio:false,spatial:false,output:'native',reason:'当前 Safari/媒体源不支持安全捕获音频（可能为跨域或受保护片源），保留原声。'});
    return null;
  }
  const WebkitContext=(window as Window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
  const Constructor=window.AudioContext??WebkitContext;
  if(!Constructor) {stream.getTracks().forEach(t=>t.stop());return null;}
  let context:AudioContext;
  try {context=new Constructor({latencyHint:'interactive'});}
  catch {
    stream.getTracks().forEach(t=>t.stop());
    onState({audio:false,spatial:false,output:'native',reason:'无法初始化音频上下文，保留原声。'});
    return null;
  }
  let stopped=false;
  let audio=false,spatial=false;
  let capturing=false;
  const previouslyMuted=video.muted;
  let streamSource:MediaStreamAudioSourceNode;
  let analyser:AnalyserNode;
  let unregisterVolume=()=>{};
  let unregisterRuntime=()=>{};
  let dry:GainNode,eqOut:GainNode,spatialRaw:GainNode,spatialEq:GainNode,spatialOut:GainNode;
  try {
    streamSource=context.createMediaStreamSource(stream);
    analyser=context.createAnalyser();
    analyser.fftSize=1024;
    const eq=configureEq(context);
    const master=context.createGain();
    master.gain.value=video.volume;
    const outputLimiter=context.createDynamicsCompressor();
    outputLimiter.threshold.value=-3;
    outputLimiter.knee.value=0;
    outputLimiter.ratio.value=14;
    outputLimiter.attack.value=.001;
    outputLimiter.release.value=.12;
    outputLimiter.connect(master);
    master.connect(context.destination);
    const onVolumeChange=()=>{
      if(stopped||!capturing)return;
      if(!video.muted){
        // Native output became audible while DSP is active; restore a single path.
        session.stop();
        onState({audio:false,spatial:false,output:'native',
          reason:'原生音轨恢复，DSP 自动关闭以防止双重播放。'});
        return;
      }
      safeGain(master.gain,video.volume,context);
    };
    video.addEventListener('volumechange',onVolumeChange);
    unregisterVolume=()=>video.removeEventListener('volumechange',onVolumeChange);
    dry=context.createGain();
    eqOut=context.createGain();
    spatialRaw=context.createGain();
    spatialEq=context.createGain();
    spatialOut=context.createGain();
    // Audio capture is monitored without muting source output until proof
    // of non-zero data. Never double sound or interrupt original playback.
    streamSource.connect(analyser);
    streamSource.connect(dry);
    streamSource.connect(eq.input);
    streamSource.connect(spatialRaw);
    dry.connect(outputLimiter);
    eq.output.connect(eqOut);
    eq.output.connect(spatialEq);
    eqOut.connect(outputLimiter);
    const splitter=context.createChannelSplitter(2);
    spatialRaw.connect(splitter);
    spatialEq.connect(splitter);
    const left=panner(context,-0.65),right=panner(context,.65);
    const gainLeft=context.createGain(),gainRight=context.createGain();
    gainLeft.gain.value=.68;gainRight.gain.value=.68;
    splitter.connect(left,0,0);
    splitter.connect(right,1,0);
    left.connect(gainLeft);right.connect(gainRight);
    gainLeft.connect(spatialOut);gainRight.connect(spatialOut);
    spatialOut.connect(outputLimiter);
    // The primary video element still plays normally until capture is proven.
    dry.gain.value=0;eqOut.gain.value=0;spatialRaw.gain.value=0;spatialEq.gain.value=0;spatialOut.gain.value=0;
  } catch {
    unregisterVolume();
    stream.getTracks().forEach(t=>t.stop());
    void context.close().catch(()=>{});
    onState({audio:false,spatial:false,output:'native',reason:'音频 DSP 节点创建失败，原声保持不变。'});
    return null;
  }
  const snapshot=():CinemaSoundState=>({
    audio:capturing&&audio,spatial:capturing&&spatial,
    output:capturing?'captured-dsp':'native',
    reason:capturing
      ? spatial?'Cinema Spatial 已通过 HRTF 双耳实时处理音轨；非 Dolby Atmos。'
        :'Cinema Audio 已通过动态压缩、EQ 和限幅实时处理音轨；非 Dolby 解码。'
      :'音频处理链就绪，等待确认媒体捕获到真实 PCM 信号。',
  });
  const update=()=>{
    if(!capturing||stopped)return;
    const levels=cinemaSoundRouting(audio,spatial);
    safeGain(dry.gain,levels.native,context);
    safeGain(eqOut.gain,levels.eq,context);
    safeGain(spatialRaw.gain,levels.spatialRaw,context);
    safeGain(spatialEq.gain,levels.spatialEq,context);
    safeGain(spatialOut.gain,levels.spatialOutput,context);
    // Browser capture stream is independent of the element's native speaker
    // playback. Mute only after verified nonzero PCM to avoid dead silence.
    video.muted=audio||spatial?true:previouslyMuted;
    onState(snapshot());
  };
  let checkRaf=0;
  let frames=0;
  const started=performance.now();
  const samples=new Uint8Array(analyser.fftSize);
  const check=()=>{
    if(stopped)return;
    if(video.isConnected===false||stream.getAudioTracks().every(track=>track.readyState!=='live')){
      session.stop();return;
    }
    if(!capturing&&context.state==='running'&&video.readyState>=2&&!video.paused){
      analyser.getByteTimeDomainData(samples);
      let energy=0;
      for(let i=0;i<samples.length;i++){const v=(samples[i]-128)/128;energy+=v*v;}
      if(Math.sqrt(energy/samples.length)>.0025) frames++;
      else frames=0;
      if(frames>=3){
        capturing=true;
        update();
        return;
      }
    }
    if(!capturing&&performance.now()-started>10000){
      session.stop();
      onState({audio:false,spatial:false,output:'native',reason:'没有验证到可处理的 PCM 音频信号；保留原始播放。'});
      return;
    }
    checkRaf=requestAnimationFrame(check);
  };
  const session:CinemaSoundSession={
    enable(mode,enabled){
      if(stopped)return;
      if(mode==='audio')audio=enabled;
      else spatial=enabled;
      update();
      if(!audio&&!spatial) {
        session.stop();
      }
    },
    state:snapshot,
    stop(){
      if(stopped)return;
      stopped=true;
      cancelAnimationFrame(checkRaf);
      // Restore native speaker playback before releasing the captured track.
      unregisterVolume();
      unregisterRuntime();
      if(capturing)video.muted=previouslyMuted;
      stream.getTracks().forEach(track=>track.stop());
      try{streamSource.disconnect();}catch{/* closed */}
      void context.close().catch(()=>{});
    },
  };
  const onCaptureLost=()=>{
    if(stopped)return;
    session.stop();
    onState({audio:false,spatial:false,output:'native',
      reason:'检测到音轨结束、切源或音频上下文中断，已恢复原生音频。'});
  };
  const tracks=stream.getAudioTracks();
  const stateChanged=()=>{if(context.state!=='running')onCaptureLost();};
  const onVideoChange=()=>onCaptureLost();
  for(const track of tracks){
    track.addEventListener('ended',onCaptureLost);
    track.addEventListener('mute',onCaptureLost);
  }
  for(const event of ['emptied','error','seeking'] as const){
    video.addEventListener(event,onVideoChange);
  }
  context.addEventListener('statechange',stateChanged);
  unregisterRuntime=()=>{
    for(const track of tracks){
      track.removeEventListener('ended',onCaptureLost);
      track.removeEventListener('mute',onCaptureLost);
    }
    for(const event of ['emptied','error','seeking'] as const){
      video.removeEventListener(event,onVideoChange);
    }
    context.removeEventListener('statechange',stateChanged);
  };
  try {await context.resume();} catch {session.stop();return null;}
  if(context.state!=='running'){session.stop();return null;}
  checkRaf=requestAnimationFrame(check);
  return session;
}
