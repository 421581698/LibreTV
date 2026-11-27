/**
 * Cinema Audio / Spatial V5.1 Pro: capture/mirror Web Audio DSP.
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
  output:'captured-dsp'|'decoded-pcm'|'native';
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
export function cinemaCreatePanner(context:AudioContext,x:number):PannerNode {
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
/** A bounded cinema voice/bass/dynamics preset; this is PCM DSP, not Dolby decoding. */
export function cinemaConfigureEq(context:AudioContext) {
  const sub=context.createBiquadFilter();
  sub.type='lowshelf';sub.frequency.value=64;sub.gain.value=2.6;
  const bass=context.createBiquadFilter();
  bass.type='peaking';bass.frequency.value=150;bass.Q.value=.7;bass.gain.value=1.8;
  const mud=context.createBiquadFilter();
  mud.type='peaking';mud.frequency.value=340;mud.Q.value=1.05;mud.gain.value=-1.4;
  const voice=context.createBiquadFilter();
  voice.type='peaking';voice.frequency.value=2400;voice.Q.value=.8;voice.gain.value=2.8;
  const intelligibility=context.createBiquadFilter();
  intelligibility.type='peaking';intelligibility.frequency.value=3900;
  intelligibility.Q.value=1.15;intelligibility.gain.value=1.6;
  const highs=context.createBiquadFilter();
  highs.type='highshelf';highs.frequency.value=7600;highs.gain.value=.8;
  const compressor=context.createDynamicsCompressor();
  compressor.threshold.value=-19;compressor.knee.value=15;
  compressor.ratio.value=2.7;compressor.attack.value=.008;compressor.release.value=.24;
  const limiter=context.createDynamicsCompressor();
  limiter.threshold.value=-3;limiter.knee.value=0;limiter.ratio.value=12;
  limiter.attack.value=.002;limiter.release.value=.09;
  sub.connect(bass);bass.connect(mud);mud.connect(voice);voice.connect(intelligibility);
  intelligibility.connect(highs);highs.connect(compressor);compressor.connect(limiter);
  return {input:sub,output:limiter};
}
/** Only trust explicit capture-track channel-count metadata for 5.1 steering. */
export function cinemaVerifiedSpatialChannels(stream:MediaStream|null):2|6 {
  const track=stream?.getAudioTracks()[0];
  try {
    return track?.getSettings?.().channelCount===6?6:2;
  } catch {return 2;}
}
/** Scene-adaptive bounded makeup gain; never boost digital silence. */
export function cinemaLoudnessGain(rms:number):number {
  if(!Number.isFinite(rms)||rms<0.004)return 1;
  return Math.min(1.22,Math.max(0.86,0.14/Math.max(rms,0.01)));
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
  prewarmedContext?:AudioContext,
):Promise<CinemaSoundSession|null> {
  if(typeof window==='undefined'||(!prewarmedContext&&!(window.AudioContext||('webkitAudioContext' in window)))) {
    onState({audio:false,spatial:false,output:'native',reason:'Cinema DSP/HRTF 启动失败：Web Audio 引擎不可用。'});
    return null;
  }
  if(video.muted||video.volume===0){
    if(prewarmedContext)void prewarmedContext.close().catch(()=>{});
    onState({audio:false,spatial:false,output:'native',reason:'请先恢复原生音轨和可听音量，再开启 DSP/空间化。'});
    return null;
  }
  const stream=capturedAudioSource(video);
  // A disposable audio element can be routed through Web Audio without
  // permanently binding the reusable ArtPlayer video to an AudioContext.
  const url=video.currentSrc;
  // Never fetch an untrusted internal/loopback resource or a playlist whose
  // auth/variant selection is controlled by the original media loader.
  const parsed=(()=>{try{return new URL(url,window.location.href);}catch{return null;}})();
  const isPrivateHost=Boolean(parsed && (parsed.hostname==='localhost' || parsed.hostname==='127.0.0.1' || parsed.hostname==='::1' || parsed.hostname==='[::1]' || /^(?:10|127|192\.168|169\.254|172\.(?:1[6-9]|2[0-9]|3[01]))\.[0-9]+\.[0-9]+(?:\.[0-9]+)?$/.test(parsed.hostname)));
  // Safari does not expose captureStream() for many native HLS streams. A
  // disposable <audio> may decode a clear, seekable HLS rendition and expose
  // real PCM through Web Audio. CORS still governs each playlist/segment;
  // denied audio remains silent in the analyser and MUST NOT mute the video.
  // MPEG-DASH is not a natively supported Safari mirror input.
  // Safari can expose a finite VOD before populating seekable TimeRanges.
  // Still require real nonzero PCM and independently checked media-time sync.
  const eligibleVodClock=video.readyState>=2 && video.duration>0 &&
    Number.isFinite(video.duration) && Number.isFinite(video.currentTime) &&
    video.currentTime>=0 && video.currentTime<=video.duration+.5;
  const useElement=!stream && Boolean(parsed && parsed.protocol==='https:' && !isPrivateHost &&
    !/\.mpd$/i.test(parsed.pathname) && !video.mediaKeys && eligibleVodClock);
  const mirror=useElement?document.createElement('audio'):null;
  if(!stream&&!mirror) {
    if(prewarmedContext)void prewarmedContext.close().catch(()=>{});
    onState({audio:false,spatial:false,output:'native',reason:'Cinema DSP/HRTF 启动失败：当前浏览器或媒体未提供可读取的 PCM 音轨。'});
    return null;
  }
  const WebkitContext=(window as Window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
  const Constructor=window.AudioContext??WebkitContext;
  if(!Constructor&&!prewarmedContext) {stream?.getTracks().forEach(t=>t.stop());return null;}
  let context:AudioContext;
  try {
    if(prewarmedContext)context=prewarmedContext;
    else if(Constructor)context=new Constructor({latencyHint:'interactive'});
    else throw new Error('No AudioContext constructor');
  }
  catch {
    stream?.getTracks().forEach(t=>t.stop());
    onState({audio:false,spatial:false,output:'native',reason:'Cinema DSP/HRTF 启动失败：无法初始化音频上下文。'});
    return null;
  }
  let stopped=false;
  let audio=false,spatial=false;
  let capturing=false;
  let changingNativeMute=false;
  const previouslyMuted=video.muted;
  let streamSource:AudioNode;
  let analyser:AnalyserNode;
  let master:GainNode;
  let unregisterVolume=()=>{};
  let unregisterRuntime=()=>{};
  let lastSyncCheck=0;
  let lastGainCheck=0;
  let syncMismatchFrames=0;
  const releaseMirror=()=>{if(mirror){mirror.pause();mirror.removeAttribute('src');mirror.load();}};
  let dry:GainNode,eqOut:GainNode,spatialRaw:GainNode,spatialEq:GainNode,spatialOut:GainNode;
  try {
    if(mirror){
      mirror.crossOrigin='anonymous';
      mirror.preload='auto';
      mirror.src=url;
      mirror.playbackRate=video.playbackRate;
      streamSource=context.createMediaElementSource(mirror);
    }else if(stream) streamSource=context.createMediaStreamSource(stream);
    else throw new Error('No audio input');
    analyser=context.createAnalyser();
    analyser.fftSize=1024;
    const eq=cinemaConfigureEq(context);
    master=context.createGain();
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
      if(!video.muted&&!changingNativeMute){
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
    const channels=cinemaVerifiedSpatialChannels(stream);
    const splitter=context.createChannelSplitter(channels);
    spatialRaw.connect(splitter);
    spatialEq.connect(splitter);
    // Web Audio 5.1 channel order L,R,C,LFE,SL,SR. Rear speakers use
    // positive Z; center and LFE remain center-weighted with headroom.
    const speakers=channels===6
      ? [{x:-.8,z:-1,g:.48},{x:.8,z:-1,g:.48},{x:0,z:-1,g:.36},
         {x:0,z:-1,g:.14},{x:-.95,z:.6,g:.38},{x:.95,z:.6,g:.38}]
      : [{x:-.65,z:-1,g:.68},{x:.65,z:-1,g:.68}];
    speakers.forEach((speaker,index)=>{
      const node=cinemaCreatePanner(context,speaker.x);
      if('positionZ' in node && node.positionZ) {
        node.positionZ.setValueAtTime(speaker.z,context.currentTime);
      }else {
        node.setPosition(speaker.x,0,speaker.z);
      }
      const trim=context.createGain();
      trim.gain.value=speaker.g;
      splitter.connect(node,index,0);
      node.connect(trim);
      trim.connect(spatialOut);
    });
    spatialOut.connect(outputLimiter);
    // The primary video element still plays normally until capture is proven.
    dry.gain.value=0;eqOut.gain.value=0;spatialRaw.gain.value=0;spatialEq.gain.value=0;spatialOut.gain.value=0;
  } catch {
    unregisterVolume();
    releaseMirror();
    stream?.getTracks().forEach(t=>t.stop());
    void context.close().catch(()=>{});
    onState({audio:false,spatial:false,output:'native',reason:'Cinema DSP/HRTF 启动失败：音频处理节点创建失败。'});
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
    changingNativeMute=true;
    video.muted=audio||spatial?true:previouslyMuted;
    changingNativeMute=false;
    onState(snapshot());
  };
  let checkRaf=0;
  let frames=0;
  const started=performance.now();
  const samples=new Uint8Array(analyser.fftSize);
  const check=()=>{
    if(stopped)return;
    if(video.isConnected===false||(stream!==null&&stream.getAudioTracks().every(track=>track.readyState!=='live'))){
      session.stop();
      onState({audio:false,spatial:false,output:'native',reason:'音频输入已断开，增强已停止。'});
      return;
    }
    if(mirror && capturing && mirror.readyState>=2 && performance.now()-lastSyncCheck>250){
      lastSyncCheck=performance.now();
      const difference=mirror.currentTime-video.currentTime;
      if(Math.abs(difference)>0.18) syncMismatchFrames++;
      else syncMismatchFrames=0;
      if(syncMismatchFrames>=3){
        session.stop();
        onState({audio:false,spatial:false,output:'native',
          reason:'独立音频与视频持续不同步，已停止增强并恢复视频原声。'});
        return;
      }
      if(Math.abs(difference)>0.07 && Math.abs(difference)<=0.18){
        mirror.playbackRate=video.playbackRate*Math.min(1.04,Math.max(.96,1-difference*.2));
      } else mirror.playbackRate=video.playbackRate;
    }
    if(!capturing&&context.state==='running'&&video.readyState>=2&&!video.paused){
      analyser.getByteTimeDomainData(samples);
      let energy=0;
      for(let i=0;i<samples.length;i++){const v=(samples[i]-128)/128;energy+=v*v;}
      if(Math.sqrt(energy/samples.length)>.0025) frames++;
      else frames=0;
      if(frames>=3){
        if(mirror && (mirror.paused || Math.abs(mirror.currentTime-video.currentTime)>.12)){
          frames=0;
        } else {
        capturing=true;
        update();
        // Continue monitoring captured PCM for adaptive loudness and track loss.
        }
      }
    }
    if(capturing && context.state==='running' && !video.paused &&
        performance.now()-lastGainCheck>=250){
      lastGainCheck=performance.now();
      analyser.getByteTimeDomainData(samples);
      let energy=0;
      for(let i=0;i<samples.length;i++){const value=(samples[i]-128)/128;energy+=value*value;}
      const rms=Math.sqrt(energy/samples.length);
      safeGain(master.gain,video.volume*(audio?cinemaLoudnessGain(rms):1),context);
    }
    if(!capturing&&performance.now()-started>10000){
      session.stop();
      onState({audio:false,spatial:false,output:'native',reason:'Cinema DSP/HRTF 启动失败：未检测到有效 PCM 信号。'});
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
      releaseMirror();
      if(capturing){changingNativeMute=true;video.muted=previouslyMuted;changingNativeMute=false;}
      stream?.getTracks().forEach(track=>track.stop());
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
  const tracks=stream?.getAudioTracks()??[];
  const stateChanged=()=>{if(capturing&&context.state!=='running')onCaptureLost();};
  const onVideoChange=()=>onCaptureLost();
  for(const track of tracks){
    track.addEventListener('ended',onCaptureLost);
    track.addEventListener('mute',onCaptureLost);
  }
  for(const event of ['emptied','error','seeking'] as const){
    video.addEventListener(event,onVideoChange);
  }
  const syncPlay=()=>{if(mirror)void mirror.play().catch(onCaptureLost);};
  const syncPause=()=>mirror?.pause();
  const syncRate=()=>{if(mirror)mirror.playbackRate=video.playbackRate;};
  const syncTime=()=>{
    if(mirror&&mirror.readyState>=2){
      try{mirror.currentTime=video.currentTime;}
      catch{onCaptureLost();}
    }
  };
  video.addEventListener('play',syncPlay);
  video.addEventListener('pause',syncPause);
  video.addEventListener('ratechange',syncRate);
  mirror?.addEventListener('loadedmetadata',syncTime);
  mirror?.addEventListener('error',onCaptureLost);
  context.addEventListener('statechange',stateChanged);
  unregisterRuntime=()=>{
    for(const track of tracks){
      track.removeEventListener('ended',onCaptureLost);
      track.removeEventListener('mute',onCaptureLost);
    }
    for(const event of ['emptied','error','seeking'] as const){
      video.removeEventListener(event,onVideoChange);
    }
    video.removeEventListener('play',syncPlay);
    video.removeEventListener('pause',syncPause);
    video.removeEventListener('ratechange',syncRate);
    mirror?.removeEventListener('loadedmetadata',syncTime);
    mirror?.removeEventListener('error',onCaptureLost);
    context.removeEventListener('statechange',stateChanged);
  };
  try {const resumed=context.resume();if(mirror&&!video.paused)await Promise.all([resumed,mirror.play()]);else await resumed;} catch {session.stop();return null;}
  if(context.state!=='running'){session.stop();onState({audio:false,spatial:false,output:'native',reason:'音频上下文未进入运行状态，未启用增强。'});return null;}
  checkRaf=requestAnimationFrame(check);
  return session;
}
