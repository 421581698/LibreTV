import {describe,expect,it} from 'vitest';
import {
  cinemaParseAdtsHeader,cinemaDemuxAdts,cinemaPcmTiming,CinemaPcmQueue,
  createCinemaAacDecoder,type CinemaPcmFrame,
} from './cinema-v51-pcm';
const SHA='a'.repeat(64);
function adts(payload:Uint8Array=new Uint8Array([1,2,3,4]),rate=4,channels=2) {
  const length=7+payload.length;
  return new Uint8Array([
    0xff,0xf1,0x40|(rate<<2)|(channels>>2),
    ((channels&3)<<6)|(length>>11),(length>>3)&255,
    ((length&7)<<5)|31,0xfc,...payload,
  ]);
}
const pcm=(ptsUs:number):CinemaPcmFrame=>({
  sourceSha256:SHA,ptsUs,sampleRate:48000,channels:2,frames:1024,
  planes:[new Float32Array(1024),new Float32Array(1024)],
});
describe('Cinema authenticated AAC / PCM transport core',()=>{
  it('parses AAC-LC ADTS format and derives successive exact sample PTS',()=>{
    const part=adts(),packet=new Uint8Array([...part,...part]);
    const out=cinemaDemuxAdts({sourceSha256:SHA,ptsUs:1234000,data:packet});
    expect(out.header).toMatchObject({profile:2,sampleRate:44100,channels:2,frameBytes:11});
    expect(Array.from(out.header.audioSpecificConfig)).toEqual([0x12,0x10]);
    expect(out.frames).toHaveLength(2);
    expect(out.frames.map(x=>x.ptsUs)).toEqual([1234000,1257220]);
    expect(Array.from(out.frames[0].data)).toEqual([1,2,3,4]);
  });
  it('refuses truncated, unsupported, untrusted or mixed-configuration samples',()=>{
    expect(()=>cinemaParseAdtsHeader(new Uint8Array([0xff,0xf1]))).toThrow();
    const invalid=adts();invalid[2]=invalid[2]&0x3f;
    expect(()=>cinemaParseAdtsHeader(invalid)).toThrow();
    expect(()=>cinemaDemuxAdts({sourceSha256:'bad',ptsUs:0,data:adts()})).toThrow();
    expect(()=>cinemaDemuxAdts({sourceSha256:SHA,ptsUs:0,
      data:new Uint8Array([...adts(),...adts(undefined,3)])})).toThrow();
  });
  it('keeps bounded source-specific PCM in PTS order and drops late data',()=>{
    const queue=new CinemaPcmQueue(SHA,2048);
    queue.enqueue(pcm(100000));queue.enqueue(pcm(130000));
    expect(()=>queue.enqueue(pcm(120000))).toThrow();
    expect(()=>queue.enqueue(pcm(150000))).toThrow('backpressure');
    const clock={sourceSha256:SHA,presentationOffsetUs:0,currentMediaTimeSeconds:()=>0};
    expect(cinemaPcmTiming(pcm(100000),clock)).toBe('ready');
    expect(queue.dequeue(clock)?.ptsUs).toBe(100000);
    expect(queue.dequeue(clock)).toBeNull();
    const late={...clock,currentMediaTimeSeconds:()=>0.5};
    expect(queue.dequeue(late)).toBeNull();
    expect(queue.queuedSamples).toBe(0);
    queue.clear();queue.enqueue(pcm(100000));queue.clear();
    expect(queue.queuedFrames).toBe(0);
  });
  it('rejects PTS identity mismatch even when buffering is permitted',()=>{
    const queue=new CinemaPcmQueue(SHA);
    queue.enqueue(pcm(100000));
    expect(()=>queue.dequeue({sourceSha256:'b'.repeat(64),presentationOffsetUs:0,
      currentMediaTimeSeconds:()=>0})).toThrow();
    expect(queue.queuedFrames).toBe(1);
  });
  it('decodes verified ADTS payloads through WebCodecs into planar PCM',async()=>{
    const decoded:CinemaPcmFrame[]=[];
    const encoded:{timestamp:number;duration:number;data:Uint8Array}[]=[];
    let closed=0;
    class FakeAudioDecoder {
      static async isConfigSupported(_config:unknown){return {supported:true};}
      decodeQueueSize=0;
      state='configured';
      private readonly output:(audio:never)=>void;
      constructor(init:{output:(audio:never)=>void}){this.output=init.output;}
      configure(_config:unknown){}
      decode(chunk:unknown){
        const data=chunk as {timestamp:number;duration:number;data:Uint8Array};
        encoded.push(data);
        this.output({
          timestamp:data.timestamp,sampleRate:44100,numberOfChannels:2,numberOfFrames:1024,
          copyTo:(dest:Float32Array,options:{planeIndex:number})=>dest.fill(options.planeIndex+.5),
          close:()=>{closed++;},
        } as never);
      }
      async flush(){}
      close(){}
    }
    const decoder=createCinemaAacDecoder(SHA,f=>decoded.push(f),()=>{},{
      AudioDecoder:FakeAudioDecoder as never,
      EncodedAudioChunk:class {timestamp:number;duration:number;data:Uint8Array;
        constructor(init:{timestamp:number;duration:number;data:Uint8Array}){
          this.timestamp=init.timestamp;this.duration=init.duration;this.data=init.data;
        }},
    });
    await decoder.push({sourceSha256:SHA,ptsUs:1000000,data:new Uint8Array([...adts(),...adts()])});
    expect(encoded).toHaveLength(2);
    expect(decoded.map(x=>x.ptsUs)).toEqual([1000000,1023220]);
    expect(decoded[0].planes[1][0]).toBe(1.5);
    expect(closed).toBe(2);
    await decoder.flush();decoder.stop();
    expect(decoder.active).toBe(false);
  });
});
