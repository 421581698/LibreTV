/**
 * Explicitly source-bound decoded AAC -> Web Audio output path.
 *
 * An independently authenticated demuxer must supply verified, clear ADTS
 * packets and the exact presentation-to-video offset. No arbitrary CMS URL is
 * fetched here; no DRM access, native Dolby decoding or Atmos is implied.
 * Native video sound is preserved until non-silent decoded PCM is scheduled.
 */
import {
  createCinemaAacDecoder,CinemaPcmQueue,
  type CinemaPcmPacket,
} from './cinema-v51-pcm';
import {
  cinemaConfigureEq,cinemaCreatePanner,cinemaSoundRouting,cinemaLoudnessGain,
  type CinemaSoundMode,type CinemaSoundSession,type CinemaSoundState,
} from './cinema-v51-sound';

export interface CinemaAuthorizedAacSource {
  sourceSha256:string;
  /** Independently verified immutable media identity, not a self-declared title. */
  expectedSourceSha256:string;
  /** Verified audio presentation PTS - native video mediaTime in microseconds. */
  presentationOffsetUs:number;
  packets:AsyncIterable<CinemaPcmPacket>;
}
const SHA=/^[a-f0-9]{64}$/i;
interface AudioGraph {
  input:GainNode;master:GainNode;dry:GainNode;eqOut:GainNode;
  spatialRaw:GainNode;spatialEq:GainNode;spatialOut:GainNode;
}
function createGraph(context:AudioContext,channels:number):AudioGraph {
  if(![1,2,6].includes(channels))throw new Error('Unsupported PCM spatial channel layout');
  const input=context.createGain();
  const master=context.createGain();
  const compressor=context.createDynamicsCompressor();
  compressor.threshold.value=-3;compressor.knee.value=0;compressor.ratio.value=14;
  compressor.attack.value=.002;compressor.release.value=.08;
  compressor.connect(master);master.connect(context.destination);
  const eq=cinemaConfigureEq(context);
  const dry=context.createGain(),eqOut=context.createGain();
  const spatialRaw=context.createGain(),spatialEq=context.createGain(),spatialOut=context.createGain();
  input.connect(dry);input.connect(eq.input);input.connect(spatialRaw);
  dry.connect(compressor);eq.output.connect(eqOut);eq.output.connect(spatialEq);
  eqOut.connect(compressor);
  const splitter=context.createChannelSplitter(channels);
  spatialRaw.connect(splitter);spatialEq.connect(splitter);
  const speakers=channels===6
    ? [{x:-.8,z:-1,g:.48},{x:.8,z:-1,g:.48},{x:0,z:-1,g:.36},
       {x:0,z:-1,g:.14},{x:-.95,z:.6,g:.38},{x:.95,z:.6,g:.38}]
    : channels===1?[{x:0,z:-1,g:.9}]
    : [{x:-.65,z:-1,g:.68},{x:.65,z:-1,g:.68}];
  speakers.forEach((speaker,index)=>{
    const panner=cinemaCreatePanner(context,speaker.x);
    if(panner.positionZ)panner.positionZ.setValueAtTime(speaker.z,context.currentTime);
    else panner.setPosition(speaker.x,0,speaker.z);
    const gain=context.createGain();gain.gain.value=speaker.g;
    splitter.connect(panner,index,0);panner.connect(gain);gain.connect(spatialOut);
  });
  spatialOut.connect(compressor);
  for(const gain of [dry,eqOut,spatialRaw,spatialEq,spatialOut])gain.gain.value=0;
  master.gain.value=0;
  return {input,master,dry,eqOut,spatialRaw,spatialEq,spatialOut};
}
export async function createCinemaAuthorizedPcmSoundSession(
  video:HTMLVideoElement,source:CinemaAuthorizedAacSource,
  onState:(state:CinemaSoundState)=>void,
):Promise<CinemaSoundSession|null> {
  if(!SHA.test(source.sourceSha256)||source.sourceSha256.toLowerCase()!==
      source.expectedSourceSha256.toLowerCase()||
     !Number.isSafeInteger(source.presentationOffsetUs)||video.muted||video.volume<=0||
     video.mediaKeys||typeof window==='undefined'){
    onState({audio:false,spatial:false,output:'native',
      reason:'未获得已验证的清晰 AAC 音轨或精确时间映射，拒绝接管视频原声。'});
    return null;
  }
  const Constructor=window.AudioContext??(window as Window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
  if(!Constructor){
    onState({audio:false,spatial:false,output:'native',reason:'独立 PCM 路径缺少 Web Audio 支持。'});
    return null;
  }
  let context:AudioContext;
  try{context=new Constructor({latencyHint:'interactive'});await context.resume();}
  catch{
    onState({audio:false,spatial:false,output:'native',reason:'PCM AudioContext 未能启动。'});
    return null;
  }
  if(context.state!=='running'){void context.close().catch(()=>{});return null;}
  let stopped=false,active=false,audio=false,spatial=false;
  let mutedNative=false;
  let graph:AudioGraph|null=null;
  let formatChannels=0;
  let raf=0;
  let scheduledSamples=0;
  let earliestScheduledAt=Infinity;
  let lastDecodedAt=performance.now();
  let measuredRms=.10;
  let lastLoudnessAt=0;
  let misses=0;
  const scheduled=new Set<AudioBufferSourceNode>();
  const queue=new CinemaPcmQueue(source.sourceSha256,96000);
  const clock={
    sourceSha256:source.sourceSha256,
    presentationOffsetUs:source.presentationOffsetUs,
    currentMediaTimeSeconds:()=>video.currentTime,
  };
  const snapshot=():CinemaSoundState=>({
    audio:active&&audio,spatial:active&&spatial,
    output:active?'decoded-pcm':'native',
    reason:active
      ? spatial?'Cinema Spatial 已处理经验证的独立 PCM 音轨（虚拟 HRTF，非 Atmos）。'
      :'Cinema Audio 已处理经验证的独立 PCM 音轨（EQ/响度控制，非 Dolby）。'
      :'等待经验证的 AAC 解码、PCM 缓冲与时间戳同步。',
  });
  const ramp=(node:GainNode,value:number)=>{
    node.gain.cancelScheduledValues(context.currentTime);
    node.gain.setTargetAtTime(value,context.currentTime,.04);
  };
  const apply=()=>{
    if(!graph)return;
    const route=cinemaSoundRouting(audio,spatial);
    ramp(graph.dry,route.native);
    ramp(graph.eqOut,route.eq);
    ramp(graph.spatialRaw,route.spatialRaw);
    ramp(graph.spatialEq,route.spatialEq);
    ramp(graph.spatialOut,route.spatialOutput);
    const volume=video.volume*(audio?cinemaLoudnessGain(measuredRms):1);
    ramp(graph.master,active?volume:0);
    if(active && (audio||spatial)) {
      if(!mutedNative){video.muted=true;mutedNative=true;}
      onState(snapshot());
    }
  };
  const fail=(reason:string)=>{
    if(stopped)return;
    session.stop();
    onState({audio:false,spatial:false,output:'native',reason});
  };
  const decoder=createCinemaAacDecoder(source.sourceSha256,frame=>{
    try {
      if(stopped)return;
      if(!graph){formatChannels=frame.channels;graph=createGraph(context,formatChannels);}
      if(frame.channels!==formatChannels)throw new Error('Audio channel layout changed');
      // Validate that decoded PCM is real and non-silent before native takeover.
      // A digital-silence decoder result cannot justify muting the source.
      let sum=0,count=0;
      for(const plane of frame.planes){
        for(let i=0;i<plane.length;i+=16){
          const value=plane[i];
          if(!Number.isFinite(value)||Math.abs(value)>1.25)
            throw new Error('Non-finite or invalid decoded PCM amplitude');
          sum+=value*value;count++;
        }
      }
      const rms=count>0?Math.sqrt(sum/count):0;
      if(rms<.0025)return;
      measuredRms=rms;
      queue.enqueue(frame);
      lastDecodedAt=performance.now();
    }catch(error){fail(error instanceof Error?error.message:'Invalid decoded PCM');}
  },message=>fail(message));
  let stream:AsyncIterator<CinemaPcmPacket>;
  try{stream=source.packets[Symbol.asyncIterator]();}
  catch{
    decoder.stop();void context.close().catch(()=>{});
    onState({audio:false,spatial:false,output:'native',reason:'可信 AAC 音轨无法生成数据流。'});
    return null;
  }
  let pendingStop=false;
  const onVideoInterrupt=()=>fail('视频暂停、切源、进度跳转或倍速改变，已恢复原始音频。');
  const onVolume=()=>{
    if(stopped||!active)return;
    if(!video.muted){fail('视频原声被重新打开，已停止独立 PCM 以避免双声道叠音。');return;}
    if(graph)ramp(graph.master,video.volume*(audio?cinemaLoudnessGain(measuredRms):1));
  };
  const onContextState=()=>{if(active&&context.state!=='running')fail('音频引擎暂停，已恢复原声。');};
  const onVideoEnd=()=>fail('视频已结束，独立 PCM 已停止。');
  for(const event of ['pause','seeking','emptied','error','ratechange'] as const)
    video.addEventListener(event,onVideoInterrupt);
  video.addEventListener('ended',onVideoEnd);
  video.addEventListener('volumechange',onVolume);
  context.addEventListener('statechange',onContextState);
  const pump=()=>{
    if(stopped)return;
    raf=requestAnimationFrame(pump);
    if(!video.isConnected||video.paused||context.state!=='running'){
      fail('播放器或音频设备不再处于有效状态，已恢复原声。');return;
    }
    if(active&&graph&&performance.now()-lastLoudnessAt>=250){
      lastLoudnessAt=performance.now();
      ramp(graph.master,video.volume*(audio?cinemaLoudnessGain(measuredRms):1));
    }
    if(!audio&&!spatial)return;
    if(performance.now()-lastDecodedAt>1800 && scheduledSamples>0){
      fail('独立 PCM 音轨缓冲不足，已恢复原声。');return;
    }
    if(performance.now()-lastDecodedAt>10000){
      fail('未收到可用的独立 PCM 解码数据。');return;
    }
    for(let i=0;i<12;i++){
      let frame;
      try{frame=queue.dequeue(clock);}
      catch{fail('PCM 时间戳或来源身份已失效，已恢复原声。');return;}
      if(!frame)break;
      const delta=(frame.ptsUs-source.presentationOffsetUs-Math.round(video.currentTime*1e6))/1e6;
      if(delta<-.035){if(++misses>8)fail('PCM 连续错过视频时间戳，已恢复原声。');continue;}
      if(!graph)break;
      try {
        const buffer=context.createBuffer(frame.channels,frame.frames,frame.sampleRate);
        frame.planes.forEach((plane,index)=>buffer.copyToChannel(new Float32Array(plane),index));
        const node=context.createBufferSource();
        node.buffer=buffer;
        node.playbackRate.value=video.playbackRate;
        node.connect(graph.input);
        const when=Math.max(context.currentTime+.008,context.currentTime+delta/Math.max(.5,video.playbackRate));
        scheduled.add(node);
        node.onended=()=>scheduled.delete(node);
        node.start(when);
        scheduledSamples+=frame.frames;
        earliestScheduledAt=Math.min(earliestScheduledAt,when);
      }catch{fail('PCM 音频缓冲创建或排程失败。');return;}
    }
    if(!active&&scheduledSamples>=3072&&earliestScheduledAt<=context.currentTime+.025){
      active=true;apply();
    }
  };
  const session:CinemaSoundSession={
    enable(mode:CinemaSoundMode,enabled:boolean){
      if(stopped)return;
      if(mode==='audio')audio=enabled;else spatial=enabled;
      if(!audio&&!spatial){session.stop();return;}
      apply();
    },
    state:snapshot,
    stop(){
      if(stopped)return;
      stopped=true;cancelAnimationFrame(raf);
      for(const event of ['pause','seeking','emptied','error','ratechange'] as const)
        video.removeEventListener(event,onVideoInterrupt);
      video.removeEventListener('ended',onVideoEnd);
      video.removeEventListener('volumechange',onVolume);
      context.removeEventListener('statechange',onContextState);
      decoder.stop();queue.clear();
      for(const node of scheduled){try{node.stop();}catch{/* ended */}try{node.disconnect();}catch{/* closed */}}
      scheduled.clear();
      if(mutedNative)video.muted=false;
      void context.close().catch(()=>{});
      if(!pendingStop){pendingStop=true;void Promise.resolve(stream.return?.()).catch(()=>{});}
    },
  };
  raf=requestAnimationFrame(pump);
  void (async()=>{
    try{
      for(let count=0;count<2_000_000&&!stopped;count++){
        const next=await stream.next();
        if(stopped||next.done)break;
        if(queue.queuedSamples>60000){
          for(let checks=0;queue.queuedSamples>24000&&!stopped;checks++){
            if(checks>100){fail('PCM decoder queue remained full');return;}
            await new Promise<void>(resolve=>setTimeout(resolve,20));
          }
        }
        if(stopped)return;
        await decoder.push(next.value);
      }
      if(!stopped)await decoder.flush();
    }catch(error){
      if(!stopped)fail(error instanceof Error?error.message:'Independent audio demux failed');
    }
  })();
  onState(snapshot());
  return session;
}
