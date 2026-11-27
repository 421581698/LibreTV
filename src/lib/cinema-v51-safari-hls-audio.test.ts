import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createCinemaSoundSession,type CinemaSoundState} from './cinema-v51-sound';

class Param {
  value=1;
  cancelScheduledValues(_at:number){}
  setTargetAtTime(value:number,_at:number,_tau:number){this.value=value;}
  setValueAtTime(value:number,_at:number){this.value=value;}
}
class Node {
  gain=new Param();frequency=new Param();Q=new Param();threshold=new Param();
  knee=new Param();ratio=new Param();attack=new Param();release=new Param();
  positionX=new Param();positionY=new Param();positionZ=new Param();
  type='';panningModel='';distanceModel='';refDistance=1;rolloffFactor=0;coneOuterGain=1;
  connect(node:unknown,..._output:number[]){return node;}
  disconnect(){}
  setPosition(_x:number,_y:number,_z:number){}
}
class Analyser extends Node {
  fftSize=1024;
  signal=true;
  getByteTimeDomainData(bytes:Uint8Array){
    bytes.fill(128);
    if(this.signal)for(let i=0;i<bytes.length;i++)bytes[i]=i%2===0?96:160;
  }
}
class Context extends EventTarget {
  static last:Context|null=null;
  static created=0;
  state='suspended';currentTime=2;destination=new Node();closed=false;
  analyser=new Analyser();mediaElements:Mirror[]=[];
  constructor(_opts:unknown){super();Context.last=this;Context.created++;}
  createMediaElementSource(element:Mirror){this.mediaElements.push(element);return new Node();}
  createGain(){return new Node();}
  createBiquadFilter(){return new Node();}
  createDynamicsCompressor(){return new Node();}
  createPanner(){return new Node();}
  createChannelSplitter(_n:number){return new Node();}
  createAnalyser(){return this.analyser;}
  async resume(){this.state='running';}
  async close(){this.state='closed';this.closed=true;}
}
class Mirror extends EventTarget {
  src='';crossOrigin='';preload='';playbackRate=1;currentTime=4;
  readyState=4;paused=true;playCount=0;stopped=false;
  async play(){this.playCount++;this.paused=false;}
  pause(){this.paused=true;}
  removeAttribute(name:string){if(name==='src')this.src='';}
  load(){this.stopped=true;}
}
class NativeHlsVideo extends EventTarget {
  muted=false;volume=.7;paused=false;readyState=4;isConnected=true;
  currentSrc='https://preview.example/media/clear.m3u8';
  currentTime=4;playbackRate=1;duration=42;seekable={length:1};
  mediaKeys:MediaKeys|null=null;
}
let frames=new Map<number,FrameRequestCallback>();
let nextId=0;
function advance(){const calls=[...frames.values()];frames.clear();for(const f of calls)f(performance.now());}
beforeEach(()=>{
  frames=new Map();nextId=0;Context.last=null;Context.created=0;
  vi.stubGlobal('window',{AudioContext:Context,location:{href:'https://preview.example/ipad-edition'}});
  vi.stubGlobal('document',{createElement:(tag:string)=>{
    if(tag!=='audio')throw Error('Unexpected new DOM element');
    return new Mirror();
  }});
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{
    const id=++nextId;frames.set(id,callback);return id;
  });
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
});
afterEach(()=>{vi.unstubAllGlobals();frames.clear();});
describe('Safari native clear HLS audio mirror → real Web Audio PCM routing',()=>{
  it('enables Audio Pro only after observed non-silent HLS PCM, then restores native on seek',async()=>{
    const video=new NativeHlsVideo(),states:CinemaSoundState[]=[];
    const session=await createCinemaSoundSession(video as never,state=>states.push(state));
    expect(session).not.toBeNull();
    expect(Context.last?.mediaElements).toHaveLength(1);
    expect(Context.last?.mediaElements[0].src).toBe(video.currentSrc);
    expect(Context.last?.mediaElements[0].crossOrigin).toBe('anonymous');
    session!.enable('audio',true);
    advance();advance();
    expect(video.muted).toBe(false);
    expect(states.some(state=>state.audio)).toBe(false);
    advance();
    expect(video.muted).toBe(true);
    expect(states.at(-1)).toMatchObject({audio:true,output:'captured-dsp'});
    video.dispatchEvent(new Event('seeking'));
    expect(video.muted).toBe(false);
    expect(Context.last?.closed).toBe(true);
    expect(Context.last?.mediaElements[0].stopped).toBe(true);
    expect(states.at(-1)?.output).toBe('native');
  });
  it('Spatial Pro uses the same verified mirror PCM and never emits an activation for silence',async()=>{
    const video=new NativeHlsVideo(),states:CinemaSoundState[]=[];
    const session=await createCinemaSoundSession(video as never,state=>states.push(state));
    expect(session).not.toBeNull();
    Context.last!.analyser.signal=false;
    session!.enable('spatial',true);
    for(let i=0;i<6;i++)advance();
    expect(video.muted).toBe(false);
    expect(states.some(state=>state.spatial)).toBe(false);
    Context.last!.analyser.signal=true;
    advance();advance();advance();
    expect(video.muted).toBe(true);
    expect(states.at(-1)).toMatchObject({spatial:true,output:'captured-dsp'});
    session!.stop();
    expect(video.muted).toBe(false);
  });
  it('rejects protected or unknown-length playlists and preserves native audio',async()=>{
    const video=new NativeHlsVideo(),states:CinemaSoundState[]=[];
    video.mediaKeys={} as MediaKeys;
    expect(await createCinemaSoundSession(video as never,s=>states.push(s))).toBeNull();
    expect(Context.last).toBeNull();
    expect(video.muted).toBe(false);
    video.mediaKeys=null;video.duration=Infinity;
    expect(await createCinemaSoundSession(video as never,s=>states.push(s))).toBeNull();
    expect(states.at(-1)?.output).toBe('native');
  });
  it('accepts finite VOD even while Safari reports no seekable range',async()=>{
    const video=new NativeHlsVideo(),states:CinemaSoundState[]=[];
    video.seekable={length:0};
    const session=await createCinemaSoundSession(video as never,s=>states.push(s));
    expect(session).not.toBeNull();
    session!.enable('audio',true);
    advance();advance();advance();
    expect(states.at(-1)?.output).toBe('captured-dsp');
    expect(video.muted).toBe(true);
    session!.stop();
    expect(video.muted).toBe(false);
  });
  it('reuses prewarmed user-gesture AudioContext for Safari mirror',async()=>{
    const video=new NativeHlsVideo(),states:CinemaSoundState[]=[];
    const warmed=new Context({});
    await warmed.resume();
    const session=await createCinemaSoundSession(video as never,s=>states.push(s),warmed as never);
    expect(session).not.toBeNull();
    expect(Context.created).toBe(1);
    expect(Context.last).toBe(warmed);
    session!.enable('spatial',true);
    advance();advance();advance();
    expect(states.at(-1)?.spatial).toBe(true);
    session!.stop();
    expect(warmed.closed).toBe(true);
    expect(video.muted).toBe(false);
  });
  it('does not claim success when the CORS-restricted audio graph emits zero PCM',async()=>{
    const video=new NativeHlsVideo(),states:CinemaSoundState[]=[];
    const session=await createCinemaSoundSession(video as never,s=>states.push(s));
    expect(session).not.toBeNull();
    Context.last!.analyser.signal=false;
    session!.enable('audio',true);
    for(let i=0;i<5;i++)advance();
    expect(video.muted).toBe(false);
    expect(states.some(s=>s.output==='captured-dsp')).toBe(false);
    session!.stop();
    expect(video.muted).toBe(false);
  });
});
