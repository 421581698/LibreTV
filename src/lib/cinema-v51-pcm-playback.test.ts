import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createCinemaAuthorizedPcmSoundSession} from './cinema-v51-pcm-playback';
import type {CinemaSoundState} from './cinema-v51-sound';
const SHA='a'.repeat(64);
class Param {
  value=1;
  cancelScheduledValues(_at:number){}
  setTargetAtTime(v:number,_at:number,_t:number){this.value=v;}
  setValueAtTime(v:number,_at:number){this.value=v;}
}
class Node {
  gain=new Param();frequency=new Param();Q=new Param();threshold=new Param();
  knee=new Param();ratio=new Param();attack=new Param();release=new Param();
  positionX=new Param();positionY=new Param();positionZ=new Param();
  playbackRate=new Param();buffer:unknown=null;onended:(()=>void)|null=null;
  type='';panningModel='';distanceModel='';refDistance=1;rolloffFactor=0;coneOuterGain=1;
  connect(target:unknown,..._ports:number[]){return target;}
  disconnect=vi.fn();
  setPosition(_x:number,_y:number,_z:number){}
  start(_when:number){}
  stop(){this.onended?.();}
}
class Context extends EventTarget {
  static last:Context|null=null;
  currentTime=1;state='suspended';closed=false;
  destination=new Node();
  constructor(_options:unknown){super();Context.last=this;}
  createGain(){return new Node();}
  createBiquadFilter(){return new Node();}
  createDynamicsCompressor(){return new Node();}
  createChannelSplitter(_n:number){return new Node();}
  createPanner(){return new Node();}
  createBuffer(_n:number,_frames:number,_rate:number){
    return {copyToChannel:(_samples:Float32Array,_channel:number)=>{}};
  }
  sources:Node[]=[];
  createBufferSource(){const node=new Node();this.sources.push(node);return node;}
  async resume(){this.state='running';}
  async close(){this.closed=true;this.state='closed';}
}
class Video extends EventTarget {
  muted=false;volume=.8;paused=false;mediaKeys=null;
  playbackRate=1;isConnected=true;currentTime=1;
}
function adts(){
  const length=7+4;
  return new Uint8Array([0xff,0xf1,0x50,0x80,(length>>3),((length&7)<<5)|31,0xfc,1,2,3,4]);
}
const packet=new Uint8Array([...adts(),...adts(),...adts()]);
let scheduled=new Map<number,FrameRequestCallback>();
let rafId=0;
function frame(){
  const callbacks=Array.from(scheduled.values());scheduled.clear();
  for(const callback of callbacks)callback(performance.now());
}
beforeEach(()=>{
  Context.last=null;scheduled=new Map();rafId=0;
  vi.stubGlobal('window',{AudioContext:Context});
  vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{
    const n=++rafId;scheduled.set(n,fn);return n;
  });
  vi.stubGlobal('cancelAnimationFrame',(n:number)=>scheduled.delete(n));
  vi.stubGlobal('AudioDecoder',class {
    static async isConfigSupported(_config:unknown){return {supported:true};}
    decodeQueueSize=0;state='configured';
    private output:(frame:never)=>void;
    constructor(init:{output:(frame:never)=>void}){this.output=init.output;}
    configure(_config:unknown){}
    decode(chunk:{timestamp:number}){
      this.output({
        timestamp:chunk.timestamp,sampleRate:44100,numberOfChannels:2,numberOfFrames:1024,
        copyTo:(data:Float32Array)=>data.fill(.11),close:()=>{},
      } as never);
    }
    async flush(){}
    close(){}
  });
  vi.stubGlobal('EncodedAudioChunk',class {
    timestamp:number;
    constructor(data:{timestamp:number}){this.timestamp=data.timestamp;}
  });
});
afterEach(()=>{scheduled.clear();vi.unstubAllGlobals();});
describe('authorized independent PCM audio output',()=>{
  it('rejects unverified source identity without changing native audio',async()=>{
    const video=new Video(),states:CinemaSoundState[]=[];
    const session=await createCinemaAuthorizedPcmSoundSession(video as never,{
      sourceSha256:SHA,expectedSourceSha256:'b'.repeat(64),presentationOffsetUs:0,
      packets:(async function*(){yield {sourceSha256:SHA,ptsUs:1000000,data:packet};})(),
    },state=>states.push(state));
    expect(session).toBeNull();
    expect(Context.last).toBeNull();
    expect(video.muted).toBe(false);
    expect(states.at(-1)?.output).toBe('native');
  });
  it('mutes native only after three scheduled nonzero decoded PCM frames and restores it on seek',async()=>{
    const video=new Video(),states:CinemaSoundState[]=[];
    const session=await createCinemaAuthorizedPcmSoundSession(video as never,{
      sourceSha256:SHA,expectedSourceSha256:SHA,presentationOffsetUs:0,
      packets:(async function*(){yield {sourceSha256:SHA,ptsUs:1000000,data:packet};})(),
    },state=>states.push(state));
    expect(session).not.toBeNull();
    session!.enable('audio',true);
    expect(video.muted).toBe(false);
    // Decoder support and async iterator dispatch both resolve in microtasks.
    for(let i=0;i<12;i++)await Promise.resolve();
    frame();
    expect(video.muted).toBe(true);
    expect(session!.state().output).toBe('decoded-pcm');
    expect(states.at(-1)?.audio).toBe(true);
    const nodes=Context.last!.sources;
    expect(nodes.length).toBe(3);
    nodes[0].onended?.();
    expect(nodes[0].disconnect).toHaveBeenCalledTimes(1);
    expect(nodes[0].onended).toBeNull();
    video.dispatchEvent(new Event('seeking'));
    expect(video.muted).toBe(false);
    expect(Context.last?.closed).toBe(true);
    for(const node of nodes){
      expect(node.disconnect).toHaveBeenCalledTimes(1);
      expect(node.onended).toBeNull();
    }
    expect(states.at(-1)?.output).toBe('native');
  });
  it('falls back on first-packet WebCodecs failure without muting native audio prematurely',async()=>{
    const video=new Video(),states:CinemaSoundState[]=[];
    let nativeDecoderClosed=false,decodeCalls=0;
    vi.stubGlobal('AudioDecoder',class {
      static async isConfigSupported(){return {supported:true};}
      decodeQueueSize=0;state='configured';
      private error:(error:Error)=>void;
      constructor(init:{error:(error:Error)=>void}){this.error=init.error;}
      configure(){}
      decode(){decodeCalls++;this.error(new Error('WebCodecs AAC failed'));}
      async flush(){}
      close(){nativeDecoderClosed=true;}
    });
    const prewarmed=new Context({});
    let safariDecodeCalls=0;
    (prewarmed as Context & {decodeAudioData:(data:ArrayBuffer)=>Promise<AudioBuffer>}).decodeAudioData=async data=>{
      safariDecodeCalls++;
      expect(data.byteLength).toBe(packet.byteLength);
      return {sampleRate:44100,length:3072,numberOfChannels:2,
        getChannelData:()=>new Float32Array(3072).fill(.1)} as unknown as AudioBuffer;
    };
    const session=await createCinemaAuthorizedPcmSoundSession(video as never,{
      sourceSha256:SHA,expectedSourceSha256:SHA,presentationOffsetUs:0,
      packets:(async function*(){yield {sourceSha256:SHA,ptsUs:1_000_000,data:packet};})(),
    },state=>states.push(state),prewarmed as never);
    expect(session).not.toBeNull();
    session!.enable('audio',true);
    for(let i=0;i<30;i++)await Promise.resolve();
    expect(decodeCalls).toBeGreaterThan(0);
    expect(nativeDecoderClosed).toBe(true);
    expect(safariDecodeCalls).toBe(1);
    expect(video.muted).toBe(false);
    frame();
    expect(video.muted).toBe(true);
    expect(states.at(-1)?.output).toBe('decoded-pcm');
    video.dispatchEvent(new Event('seeking'));
    expect(video.muted).toBe(false);
    expect(prewarmed.closed).toBe(true);
  });
  it('ignores a retired decoder failure callback after Safari fallback takes ownership',async()=>{
    const video=new Video(),states:CinemaSoundState[]=[];
    let staleError:((error:Error)=>void)|null=null;
    vi.stubGlobal('AudioDecoder',class {
      static async isConfigSupported(){return {supported:true};}
      decodeQueueSize=0;state='configured';
      constructor(init:{error:(error:Error)=>void}){staleError=init.error;}
      configure(){}
      decode(){throw new Error('first AAC packet rejected');}
      async flush(){}
      close(){}
    });
    const prewarmed=new Context({});
    (prewarmed as Context & {decodeAudioData:(data:ArrayBuffer)=>Promise<AudioBuffer>}).decodeAudioData=async()=>({
      sampleRate:44100,length:3072,numberOfChannels:2,
      getChannelData:()=>new Float32Array(3072).fill(.12),
    }) as unknown as AudioBuffer;
    const session=await createCinemaAuthorizedPcmSoundSession(video as never,{
      sourceSha256:SHA,expectedSourceSha256:SHA,presentationOffsetUs:0,
      packets:(async function*(){yield {sourceSha256:SHA,ptsUs:1_000_000,data:packet};})(),
    },state=>states.push(state),prewarmed as never);
    expect(session).not.toBeNull();
    session!.enable('audio',true);
    for(let i=0;i<30;i++)await Promise.resolve();
    expect(staleError).not.toBeNull();
    (staleError as unknown as (error:Error)=>void)(new Error('late primary decoder error'));
    frame();
    expect(session!.state().output).toBe('decoded-pcm');
    expect(states.some(s=>s.reason.includes('late primary decoder error'))).toBe(false);
    session!.stop();
    expect(video.muted).toBe(false);
  });
  it('restores native sound without switching decoders after accepted PCM output',async()=>{
    const video=new Video(),states:CinemaSoundState[]=[];
    let failDecoder:(error:Error)=>void=()=>{};
    let safariCalls=0;
    vi.stubGlobal('AudioDecoder',class {
      static async isConfigSupported(){return {supported:true};}
      decodeQueueSize=0;state='configured';
      private output:(frame:never)=>void;
      constructor(init:{output:(frame:never)=>void;error:(error:Error)=>void}){
        this.output=init.output;failDecoder=init.error;
      }
      configure(){}
      decode(chunk:{timestamp:number}){
        this.output({timestamp:chunk.timestamp,sampleRate:44100,numberOfChannels:2,
          numberOfFrames:1024,copyTo:(data:Float32Array)=>data.fill(.11),close:()=>{}} as never);
      }
      async flush(){}
      close(){}
    });
    const prewarmed=new Context({});
    (prewarmed as Context & {decodeAudioData:(data:ArrayBuffer)=>Promise<AudioBuffer>}).decodeAudioData=async()=>{
      safariCalls++;throw new Error('Unexpected decoder switch');
    };
    const session=await createCinemaAuthorizedPcmSoundSession(video as never,{
      sourceSha256:SHA,expectedSourceSha256:SHA,presentationOffsetUs:0,
      packets:(async function*(){yield {sourceSha256:SHA,ptsUs:1_000_000,data:packet};})(),
    },state=>states.push(state),prewarmed as never);
    expect(session).not.toBeNull();
    session!.enable('audio',true);
    for(let i=0;i<30;i++)await Promise.resolve();
    frame();
    expect(video.muted).toBe(true);
    failDecoder(new Error('Decoder failed after PCM output'));
    expect(video.muted).toBe(false);
    expect(prewarmed.closed).toBe(true);
    expect(safariCalls).toBe(0);
    expect(states.at(-1)?.output).toBe('native');
    expect(prewarmed.sources.every(node=>node.onended===null)).toBe(true);
  });
  it('never mutes source on a zero-only decoded PCM stream',async()=>{
    const video=new Video();
    vi.stubGlobal('AudioDecoder',class {
      static async isConfigSupported(_config:unknown){return {supported:true};}
      decodeQueueSize=0;state='configured';
      private output:(frame:never)=>void;
      constructor(init:{output:(frame:never)=>void}){this.output=init.output;}
      configure(_config:unknown){}
      decode(chunk:{timestamp:number}){
        this.output({timestamp:chunk.timestamp,sampleRate:44100,numberOfChannels:2,
          numberOfFrames:1024,copyTo:(data:Float32Array)=>data.fill(0),close:()=>{}} as never);
      }
      async flush(){}
      close(){}
    });
    const session=await createCinemaAuthorizedPcmSoundSession(video as never,{
      sourceSha256:SHA,expectedSourceSha256:SHA,presentationOffsetUs:0,
      packets:(async function*(){yield {sourceSha256:SHA,ptsUs:1000000,data:packet};})(),
    },()=>{});
    session!.enable('audio',true);
    for(let i=0;i<12;i++)await Promise.resolve();
    frame();
    expect(video.muted).toBe(false);
    session!.stop();
  });
});
