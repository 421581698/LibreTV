import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createCinemaSoundSession,type CinemaSoundState} from './cinema-v51-sound';

class FakeParam {
  value=0;
  cancelScheduledValues(_at:number){}
  setTargetAtTime(value:number,_at:number,_time:number){this.value=value;}
  setValueAtTime(value:number,_at:number){this.value=value;}
}
class FakeNode {
  gain=new FakeParam();
  frequency=new FakeParam();
  Q=new FakeParam();
  threshold=new FakeParam();
  knee=new FakeParam();
  ratio=new FakeParam();
  attack=new FakeParam();
  release=new FakeParam();
  positionX=new FakeParam();
  positionY=new FakeParam();
  positionZ=new FakeParam();
  type='';
  panningModel='';
  distanceModel='';
  refDistance=1;
  rolloffFactor=0;
  coneOuterGain=1;
  connect(_target:unknown,..._args:number[]){return _target;}
  disconnect(){}
  setPosition(_x:number,_y:number,_z:number){}
}
class FakeAnalyser extends FakeNode {
  fftSize=1024;
  getByteTimeDomainData(bytes:Uint8Array){
    for(let i=0;i<bytes.length;i++) bytes[i]=i%2===0?96:160;
  }
}
class FakeAudioContext extends EventTarget {
  static instances:FakeAudioContext[]=[];
  currentTime=1;
  state='suspended';
  destination=new FakeNode();
  closed=false;
  constructor(_options?:unknown){super();FakeAudioContext.instances.push(this);}
  createMediaStreamSource(_stream:unknown){return new FakeNode();}
  createBiquadFilter(){return new FakeNode();}
  createDynamicsCompressor(){return new FakeNode();}
  createGain(){return new FakeNode();}
  createPanner(){return new FakeNode();}
  createChannelSplitter(_n:number){return new FakeNode();}
  createAnalyser(){return new FakeAnalyser();}
  async resume(){this.state='running';this.dispatchEvent(new Event('statechange'));}
  async close(){this.closed=true;this.state='closed';}
}
class FakeTrack extends EventTarget {
  readyState='live';
  muted=false;
  stopped=false;
  stop(){this.stopped=true;this.readyState='ended';}
}
class FakeVideo extends EventTarget {
  muted=false;
  volume=.7;
  paused=false;
  readyState=4;
  isConnected=true;
  readonly track=new FakeTrack();
  captureStream(){return {getAudioTracks:()=>[this.track],getTracks:()=>[this.track]};}
}
const frames=new Map<number,FrameRequestCallback>();
let frameIndex=0;
function nextFrame(){
  const pending=Array.from(frames.values());
  frames.clear();
  for(const callback of pending)callback(performance.now());
}
beforeEach(()=>{
  FakeAudioContext.instances=[];
  frames.clear();frameIndex=0;
  vi.stubGlobal('window',{AudioContext:FakeAudioContext});
  vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{
    const id=++frameIndex;frames.set(id,cb);return id;
  });
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
});
afterEach(()=>{frames.clear();vi.unstubAllGlobals();});
describe('Cinema V5.1 DSP and HRTF runtime interruption recovery',()=>{
  it('does not mute original video before three actual PCM checks, and restores it on stop',async()=>{
    const video=new FakeVideo(),states:CinemaSoundState[]=[];
    const session=await createCinemaSoundSession(video as never,s=>states.push(s));
    expect(session).not.toBeNull();
    session!.enable('audio',true);
    nextFrame();nextFrame();
    expect(video.muted).toBe(false);
    nextFrame();
    expect(video.muted).toBe(true);
    expect(session!.state()).toMatchObject({audio:true,spatial:false,output:'captured-dsp'});
    expect(states.at(-1)?.audio).toBe(true);
    session!.stop();
    expect(video.muted).toBe(false);
    expect(video.track.stopped).toBe(true);
    expect(FakeAudioContext.instances.at(-1)?.closed).toBe(true);
  });
  it('keeps exactly one captured DSP/HRTF route and reverts on capture track interruption',async()=>{
    const video=new FakeVideo(),states:CinemaSoundState[]=[];
    const session=await createCinemaSoundSession(video as never,s=>states.push(s));
    expect(session).not.toBeNull();
    session!.enable('audio',true);
    nextFrame();nextFrame();nextFrame();
    session!.enable('spatial',true);
    expect(session!.state()).toMatchObject({audio:true,spatial:true,output:'captured-dsp'});
    video.track.muted=true;
    video.track.dispatchEvent(new Event('mute'));
    expect(video.muted).toBe(false);
    expect(video.track.stopped).toBe(true);
    expect(FakeAudioContext.instances.at(-1)?.closed).toBe(true);
    expect(states.at(-1)).toMatchObject({audio:false,spatial:false,output:'native'});
  });
  it('recovers native sound on seek/error rather than leaving an HRTF session bound to stale media',async()=>{
    const video=new FakeVideo(),states:CinemaSoundState[]=[];
    const session=await createCinemaSoundSession(video as never,s=>states.push(s));
    expect(session).not.toBeNull();
    session!.enable('spatial',true);
    nextFrame();nextFrame();nextFrame();
    expect(video.muted).toBe(true);
    video.dispatchEvent(new Event('seeking'));
    expect(video.muted).toBe(false);
    expect(states.at(-1)?.output).toBe('native');
  });
  it('restores native audio on AudioContext suspension while HRTF is active',async()=>{
    const video=new FakeVideo(),states:CinemaSoundState[]=[];
    const session=await createCinemaSoundSession(video as never,state=>states.push(state));
    expect(session).not.toBeNull();
    session!.enable('audio',true);
    session!.enable('spatial',true);
    nextFrame();nextFrame();nextFrame();
    expect(video.muted).toBe(true);
    const context=FakeAudioContext.instances.at(-1)!;
    context.state='suspended';
    context.dispatchEvent(new Event('statechange'));
    expect(video.muted).toBe(false);
    expect(video.track.stopped).toBe(true);
    expect(context.closed).toBe(true);
    expect(states.at(-1)?.output).toBe('native');
  });
  it('restores native sound when a captured audio track ends unexpectedly',async()=>{
    const video=new FakeVideo(),states:CinemaSoundState[]=[];
    const session=await createCinemaSoundSession(video as never,state=>states.push(state));
    expect(session).not.toBeNull();
    session!.enable('spatial',true);
    nextFrame();nextFrame();nextFrame();
    expect(video.muted).toBe(true);
    video.track.readyState='ended';
    video.track.dispatchEvent(new Event('ended'));
    expect(video.muted).toBe(false);
    expect(states.at(-1)?.output).toBe('native');
  });
  it('fails safely when captureStream does not provide an eligible live PCM track',async()=>{
    const video=new FakeVideo(),states:CinemaSoundState[]=[];
    video.track.muted=true;
    const session=await createCinemaSoundSession(video as never,s=>states.push(s));
    expect(session).toBeNull();
    expect(video.muted).toBe(false);
    expect(states.at(-1)?.output).toBe('native');
    expect(video.track.stopped).toBe(true);
    expect(FakeAudioContext.instances.length).toBe(0);
  });
});
