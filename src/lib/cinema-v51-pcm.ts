/**
 * Cinema PCM V5.1 Pro: explicitly authorized clear AAC/ADTS -> WebCodecs PCM.
 *
 * This is a transport-neutral decoder, not an HLS credential bypass.
 * Demux callers must independently prove source identity, provide an exact
 * 90kHz/container to microseconds presentation mapping, and exclude DRM.
 * Never infer PTS from arrival time or guess an audio source from a CMS URL.
 */
export interface CinemaPcmPacket {
  sourceSha256:string;
  ptsUs:number;
  data:Uint8Array;
}
export interface CinemaPcmFrame {
  sourceSha256:string;
  ptsUs:number;
  sampleRate:number;
  channels:number;
  frames:number;
  planes:Float32Array[];
}
export interface CinemaAdtsHeader {
  sampleRate:number;
  channels:number;
  profile:number;
  samplesPerFrame:number;
  headerBytes:number;
  frameBytes:number;
  audioSpecificConfig:Uint8Array;
}
const RATES=[96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350] as const;
const VALID_HASH=/^[0-9a-f]{64}$/i;
const MAX_FRAME_BYTES=8191;
const MAX_PACKET_BYTES=512*1024;
export function cinemaParseAdtsHeader(data:Uint8Array,offset=0):CinemaAdtsHeader {
  if(!(data instanceof Uint8Array)||!Number.isSafeInteger(offset)||offset<0||offset+7>data.length)
    throw new Error('Incomplete AAC ADTS header');
  const b0=data[offset],b1=data[offset+1],b2=data[offset+2],b3=data[offset+3],b4=data[offset+4],b5=data[offset+5],b6=data[offset+6];
  if(b0!==0xff||(b1&0xf6)!==0xf0||(b2&0xc0)!==0x40)
    throw new Error('Unsupported AAC ADTS framing');
  const profile=((b2>>6)&3)+1;
  const rateIndex=(b2>>2)&0x0f;
  const channels=((b2&1)<<2)|(b3>>6);
  const length=((b3&3)<<11)|(b4<<3)|(b5>>5);
  const headerBytes=(b1&1)?7:9;
  const blocks=b6&3;
  if(profile!==2||rateIndex>=RATES.length||channels<1||channels>6||blocks!==0||
    length<headerBytes+1||length>MAX_FRAME_BYTES||offset+length>data.length)
    throw new Error('Unsupported or truncated AAC-LC frame');
  if(headerBytes===9 && offset+9>data.length)throw new Error('Missing ADTS CRC');
  return {
    sampleRate:RATES[rateIndex],channels,profile,samplesPerFrame:1024,
    headerBytes,frameBytes:length,
    audioSpecificConfig:new Uint8Array([(profile<<3)|(rateIndex>>1),((rateIndex&1)<<7)|(channels<<3)]),
  };
}
export function cinemaDemuxAdts(
  packet:CinemaPcmPacket,
):{header:CinemaAdtsHeader;frames:{ptsUs:number;durationUs:number;data:Uint8Array}[]} {
  if(!VALID_HASH.test(packet.sourceSha256)||!Number.isSafeInteger(packet.ptsUs)||packet.ptsUs<0||
     !(packet.data instanceof Uint8Array)||packet.data.length<8||packet.data.length>MAX_PACKET_BYTES)
    throw new Error('Invalid verified AAC input');
  let offset=0;
  let header:CinemaAdtsHeader|null=null;
  let sampleOffset=0;
  const frames:{ptsUs:number;durationUs:number;data:Uint8Array}[]=[];
  while(offset<packet.data.length) {
    const current=cinemaParseAdtsHeader(packet.data,offset);
    if(header && (header.sampleRate!==current.sampleRate||header.channels!==current.channels))
      throw new Error('AAC format changed without decoder reset');
    header=current;
    const ptsUs=packet.ptsUs+Math.round(sampleOffset*1e6/current.sampleRate);
    const durationUs=Math.round(1024*1e6/current.sampleRate);
    if(!Number.isSafeInteger(ptsUs))throw new Error('AAC timestamp overflow');
    frames.push({ptsUs,durationUs,
      data:packet.data.slice(offset+current.headerBytes,offset+current.frameBytes)});
    sampleOffset+=1024;
    offset+=current.frameBytes;
    if(frames.length>64)throw new Error('Too many AAC frames in one packet');
  }
  if(!header||frames.length===0)throw new Error('No AAC frames');
  return {header,frames};
}
export interface CinemaPcmClock {
  sourceSha256:string;
  currentMediaTimeSeconds():number;
  presentationOffsetUs:number;
}
export type CinemaPcmTiming='ready'|'early'|'late'|'invalid';
/** Presentation clock calculation, independent of packet arrival and wall time. */
export function cinemaPcmTiming(frame:CinemaPcmFrame,clock:CinemaPcmClock):CinemaPcmTiming {
  if(!VALID_HASH.test(clock.sourceSha256)||frame.sourceSha256.toLowerCase()!==clock.sourceSha256.toLowerCase()||
     !Number.isSafeInteger(frame.ptsUs)||frame.ptsUs<0||
     !Number.isSafeInteger(clock.presentationOffsetUs)||!Number.isFinite(clock.currentMediaTimeSeconds()))
    return 'invalid';
  const delta=frame.ptsUs-(Math.round(clock.currentMediaTimeSeconds()*1e6)+clock.presentationOffsetUs);
  if(delta>120000)return 'early';
  if(delta < -120000)return 'late';
  return 'ready';
}
export class CinemaPcmQueue {
  private frames:CinemaPcmFrame[]=[];
  private length=0;
  private lastPts=-1;
  constructor(readonly sourceSha256:string,readonly capacitySamples=96000) {
    if(!VALID_HASH.test(sourceSha256)||!Number.isSafeInteger(capacitySamples)||
       capacitySamples<1024||capacitySamples>384000)throw new Error('Invalid PCM queue identity/capacity');
  }
  enqueue(frame:CinemaPcmFrame):void {
    if(frame.sourceSha256.toLowerCase()!==this.sourceSha256.toLowerCase()||
      !Number.isSafeInteger(frame.ptsUs)||frame.ptsUs<=this.lastPts||
      !Number.isSafeInteger(frame.frames)||frame.frames<1||frame.frames>8192||
      !Number.isSafeInteger(frame.sampleRate)||frame.sampleRate<8000||frame.sampleRate>192000||
      !Number.isSafeInteger(frame.channels)||frame.channels<1||frame.channels>8||
      frame.planes.length!==frame.channels||frame.planes.some(p=>!(p instanceof Float32Array)||p.length!==frame.frames))
      throw new Error('Invalid or out-of-order decoded PCM');
    if(this.length+frame.frames>this.capacitySamples)throw new Error('PCM queue backpressure');
    this.frames.push(frame);this.length+=frame.frames;this.lastPts=frame.ptsUs;
  }
  peek():CinemaPcmFrame|null {return this.frames[0]??null;}
  dequeue(clock:CinemaPcmClock):CinemaPcmFrame|null {
    while(this.frames.length) {
      const state=cinemaPcmTiming(this.frames[0],clock);
      if(state==='invalid')throw new Error('PCM presentation identity mismatch');
      if(state==='early')return null;
      const frame=this.frames.shift()!;
      this.length-=frame.frames;
      if(state==='ready')return frame;
    }
    return null;
  }
  clear(){this.frames=[];this.length=0;this.lastPts=-1;}
  get queuedSamples(){return this.length;}
  get queuedFrames(){return this.frames.length;}
}
interface DecodedAudioFrame {
  timestamp:number;
  sampleRate:number;
  numberOfChannels:number;
  numberOfFrames:number;
  copyTo(destination:BufferSource,options:{planeIndex:number;format:'f32-planar'}):void;
  close():void;
}
interface DecoderInstance {
  decodeQueueSize:number;
  state:string;
  configure(config:unknown):void;
  decode(chunk:unknown):void;
  flush():Promise<void>;
  close():void;
}
export interface CinemaAudioDecodeHost {
  AudioDecoder:{
    new(init:{output:(audio:DecodedAudioFrame)=>void;error:(e:Error)=>void}):DecoderInstance;
    isConfigSupported(config:unknown):Promise<{supported:boolean}>;
  };
  EncodedAudioChunk:{new(init:{type:'key';timestamp:number;duration:number;data:BufferSource}):unknown};
}
export function cinemaAudioWebCodecsAvailable():boolean {
  return typeof globalThis!=='undefined'&&'AudioDecoder' in globalThis&&'EncodedAudioChunk' in globalThis;
}
export function createCinemaAacDecoder(
  sourceSha256:string,
  onFrame:(frame:CinemaPcmFrame)=>void,
  onFailure:(message:string)=>void,
  providedHost?:CinemaAudioDecodeHost,
) {
  if(!VALID_HASH.test(sourceSha256))throw new Error('Unverified AAC source identity');
  const host=providedHost??(cinemaAudioWebCodecsAvailable()?globalThis as unknown as CinemaAudioDecodeHost:null);
  let decoder:DecoderInstance|null=null;
  let active=true;
  let format:string|null=null;
  let lastPts=-1;
  const stop=()=>{
    active=false;
    try{decoder?.close();}catch{/* close is best effort */}
    decoder=null;
  };
  const fail=(message:string)=>{if(active){stop();onFailure(message);}};
  return {
    async push(packet:CinemaPcmPacket):Promise<void>{
      if(!active)throw new Error('AAC decoder stopped');
      if(!host)throw new Error('AudioDecoder WebCodecs unavailable');
      try {
        if(packet.sourceSha256.toLowerCase()!==sourceSha256.toLowerCase())
          throw new Error('AAC packet does not match the verified source');
        const {header,frames}=cinemaDemuxAdts(packet);
        const formatKey=header.sampleRate+':'+header.channels;
        if(format && format!==formatKey)throw new Error('AAC configuration changed');
        if(!decoder){
          const config={codec:'mp4a.40.2',sampleRate:header.sampleRate,
            numberOfChannels:header.channels,description:header.audioSpecificConfig};
          const support=await host.AudioDecoder.isConfigSupported(config);
          if(!active)return;
          if(!support.supported)throw new Error('AAC-LC WebCodecs unsupported');
          decoder=new host.AudioDecoder({
            output:(audio)=>{
              try{
                if(!active)return;
                const {timestamp,sampleRate,numberOfChannels,numberOfFrames}=audio;
                if(!Number.isSafeInteger(timestamp)||timestamp<0||numberOfChannels<1||
                   numberOfChannels>8||numberOfFrames<1||numberOfFrames>8192)
                  throw new Error('Invalid PCM decoder output');
                const planes=Array.from({length:numberOfChannels},(_,planeIndex)=>{
                  const values=new Float32Array(numberOfFrames);
                  audio.copyTo(values,{planeIndex,format:'f32-planar'});
                  return values;
                });
                onFrame({sourceSha256,ptsUs:timestamp,sampleRate,channels:numberOfChannels,
                  frames:numberOfFrames,planes});
              }catch(error){fail(error instanceof Error?error.message:'PCM copy failed');}
              finally{audio.close();}
            },
            error:(error)=>fail(error.message),
          });
          decoder.configure(config);
          format=formatKey;
        }
        for(const frame of frames) {
          if(!active)return;
          if(frame.ptsUs<=lastPts)throw new Error('Out-of-order AAC PTS');
          // HLS Packed AAC yields multiple chunks per segment. Let the
          // asynchronous native decoder drain instead of failing the first
          // long rendition whenever nine frames are briefly in flight.
          for(let waits=0;decoder.decodeQueueSize>6;waits++){
            if(!active)return;
            if(waits>=80)throw new Error('AudioDecoder queue backpressure');
            await new Promise<void>(resolve=>setTimeout(resolve,5));
          }
          lastPts=frame.ptsUs;
          const exact=frame.data.slice();
          decoder.decode(new host.EncodedAudioChunk({type:'key',timestamp:frame.ptsUs,
            duration:frame.durationUs,data:exact}));
        }
      }catch(error){
        fail(error instanceof Error?error.message:'AAC decode failure');
        throw error;
      }
    },
    async flush(){if(active)await decoder?.flush();},
    stop,
    get active(){return active;},
  };
}

/**
 * Safari fallback for clear ADTS when WebCodecs AudioDecoder is absent.
 * decodeAudioData still performs actual AAC decoding inside Web Audio.
 * AAC priming/resampling and duration are checked; unverifiable output
 * fails closed instead of estimating a new clock or muting native playback.
 */
export function createCinemaSafariAdtsDecoder(
  sourceSha256:string,
  context:Pick<AudioContext,'decodeAudioData'>,
  onFrame:(frame:CinemaPcmFrame)=>void,
  onFailure:(message:string)=>void,
) {
  if(!VALID_HASH.test(sourceSha256))throw new Error('Unverified Safari ADTS source');
  let active=true;
  let previousEndUs=-1;
  let format:string|null=null;
  const stop=()=>{active=false;};
  const fail=(reason:string)=>{if(active){stop();onFailure(reason);}};
  return {
    async push(packet:CinemaPcmPacket):Promise<void> {
      if(!active)throw new Error('Safari ADTS decoder stopped');
      try {
        if(packet.sourceSha256.toLowerCase()!==sourceSha256.toLowerCase())
          throw new Error('AAC source identity mismatch');
        const {header,frames}=cinemaDemuxAdts(packet);
        const key=header.sampleRate+':'+header.channels;
        if(format&&format!==key)throw new Error('AAC track format changed');
        format=key;
        // A packet must start at the end of the previous decoded ADTS group.
        // Do not silently concatenate gaps or overlap; both corrupt A/V sync.
        // Allow only microsecond rounding drift from the AAC sample clock.
        if(previousEndUs>=0&&Math.abs(packet.ptsUs-previousEndUs)>1000)
          throw new Error('Discontinuous AAC segment timestamps');
        const encoded=packet.data.slice();
        const decoded=await context.decodeAudioData(encoded.buffer);
        if(!active)return;
        if(decoded.numberOfChannels!==header.channels||
           !Number.isSafeInteger(decoded.sampleRate)||decoded.sampleRate<8000||
           decoded.sampleRate>192000||decoded.length<=0)
          throw new Error('Invalid Safari AAC decoded format');
        const expected=Math.round(frames.length*1024*decoded.sampleRate/header.sampleRate);
        // Refuse encoder priming/padding beyond 2ms: otherwise successive
        // segment buffers overlap and can produce audible double sound.
        const primingTolerance=Math.ceil(decoded.sampleRate*.002);
        if(Math.abs(decoded.length-expected)>primingTolerance)
          throw new Error('Safari AAC decoded frame count mismatches ADTS timeline');
        const channels=Array.from({length:decoded.numberOfChannels},(_,ch)=>decoded.getChannelData(ch));
        for(let start=0;start<decoded.length;start+=8192){
          if(!active)return;
          const end=Math.min(start+8192,decoded.length);
          const ptsUs=packet.ptsUs+Math.round(start*1e6/decoded.sampleRate);
          if(!Number.isSafeInteger(ptsUs))throw new Error('AAC frame timestamp overflow');
          onFrame({sourceSha256,ptsUs,sampleRate:decoded.sampleRate,
            channels:decoded.numberOfChannels,frames:end-start,
            planes:channels.map(plane=>new Float32Array(plane.slice(start,end)))});
        }
        previousEndUs=packet.ptsUs+Math.round(frames.length*1024*1e6/header.sampleRate);
      } catch(error) {
        fail(error instanceof Error?error.message:'Safari AAC decode failed');
        throw error;
      }
    },
    async flush():Promise<void>{},
    stop,
    get active(){return active;},
  };
}
