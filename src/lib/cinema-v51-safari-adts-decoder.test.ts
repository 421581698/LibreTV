import {describe,expect,it} from 'vitest';
import {createCinemaSafariAdtsDecoder} from './cinema-v51-pcm';
import type {CinemaPcmFrame} from './cinema-v51-pcm';
const SHA='a'.repeat(64);
function adts(){
  const length=11;
  return new Uint8Array([0xff,0xf1,0x50,0x80,length>>3,((length&7)<<5)|31,0xfc,1,2,3,4]);
}
function packet(frames=3,ptsUs=1_000_000){
  return {sourceSha256:SHA,ptsUs,
    data:new Uint8Array(Array.from({length:frames},()=>[...adts()]).flat())};
}
function buffer(frames:number,rate=44100,channels=2){
  return {
    sampleRate:rate,length:frames,numberOfChannels:channels,
    getChannelData:()=>new Float32Array(frames).fill(.1),
  } as unknown as AudioBuffer;
}
describe('Safari AAC decodeAudioData fallback for verified HLS Packed AAC',()=>{
  it('decodes genuine ADTS input, preserves authenticated exact PTS and emits PCM planes',async()=>{
    const sent:CinemaPcmFrame[]=[],failed:string[]=[];
    const decoder=createCinemaSafariAdtsDecoder(SHA,{
      decodeAudioData:async(data:ArrayBuffer)=>{
        expect(new Uint8Array(data).length).toBe(33);
        return buffer(3072);
      },
    } as never,frame=>sent.push(frame),s=>failed.push(s));
    await decoder.push(packet());
    expect(failed).toHaveLength(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({sourceSha256:SHA,ptsUs:1_000_000,
      sampleRate:44100,frames:3072,channels:2});
    expect(sent[0].planes[0][0]).toBeCloseTo(.1);
    decoder.stop();
  });
  it('accepts AudioContext resampling and splits long PCM into bounded source-timestamped chunks',async()=>{
    const frames=12;
    const decodedSamples=Math.round(frames*1024*48000/44100);
    const actual:CinemaPcmFrame[]=[];
    const decoder=createCinemaSafariAdtsDecoder(SHA,{
      decodeAudioData:async()=>buffer(decodedSamples,48000),
    } as never,f=>actual.push(f),()=>{});
    await decoder.push(packet(frames,2_000_000));
    expect(actual.length).toBe(2);
    expect(actual[0].frames).toBe(8192);
    expect(actual[1].frames).toBe(decodedSamples-8192);
    expect(actual[1].ptsUs).toBe(2_000_000+Math.round(8192*1e6/48000));
    decoder.stop();
  });
  it('refuses forged source, malformed ADTS or implausible AAC decode duration',async()=>{
    const failed:string[]=[];
    const decoder=createCinemaSafariAdtsDecoder(SHA,{
      decodeAudioData:async()=>buffer(200),
    } as never,()=>{},message=>failed.push(message));
    await expect(decoder.push(packet())).rejects.toThrow('mismatches');
    expect(decoder.active).toBe(false);
    expect(failed.at(-1)).toContain('mismatches');
    const forged=createCinemaSafariAdtsDecoder(SHA,{
      decodeAudioData:async()=>buffer(3072),
    } as never,()=>{},()=>{});
    await expect(forged.push({...packet(),sourceSha256:'b'.repeat(64)}))
      .rejects.toThrow('identity');
    const malformed=createCinemaSafariAdtsDecoder(SHA,{
      decodeAudioData:async()=>buffer(3072),
    } as never,()=>{},()=>{});
    await expect(malformed.push({...packet(),data:new Uint8Array([1,2,3,4])}))
      .rejects.toThrow('Invalid verified AAC');
  });
  it('rejects both gaps and overlaps between independently decoded AAC packets',async()=>{
    const delivered:CinemaPcmFrame[]=[];
    const failed:string[]=[];
    const decoder=createCinemaSafariAdtsDecoder(SHA,{
      decodeAudioData:async()=>buffer(3072),
    } as never,frame=>delivered.push(frame),message=>failed.push(message));
    await decoder.push(packet(3,1_000_000));
    const end=1_000_000+Math.round(3*1024*1e6/44100);
    await expect(decoder.push(packet(3,end+20_000)))
      .rejects.toThrow('Discontinuous AAC segment timestamps');
    expect(decoder.active).toBe(false);
    expect(delivered).toHaveLength(1);
    expect(failed).toHaveLength(1);
    const overlap=createCinemaSafariAdtsDecoder(SHA,{
      decodeAudioData:async()=>buffer(3072),
    } as never,()=>{},message=>failed.push(message));
    await overlap.push(packet(3,1_000_000));
    await expect(overlap.push(packet(3,end-20_000)))
      .rejects.toThrow('Discontinuous AAC segment timestamps');
    expect(overlap.active).toBe(false);
  });
  it('accepts sample-clock microsecond rounding at an AAC packet boundary',async()=>{
    const delivered:CinemaPcmFrame[]=[];
    const decoder=createCinemaSafariAdtsDecoder(SHA,{
      decodeAudioData:async()=>buffer(3072),
    } as never,frame=>delivered.push(frame),()=>{});
    await decoder.push(packet(3,1_000_000));
    const end=1_000_000+Math.round(3*1024*1e6/44100);
    await decoder.push(packet(3,end+1));
    expect(delivered).toHaveLength(2);
    expect(delivered[1].ptsUs).toBe(end+1);
    decoder.stop();
  });
  it('serializes concurrent Safari AAC decode calls and preserves PCM timestamp order',async()=>{
    const received:CinemaPcmFrame[]=[];
    const finishes:Array<(value:AudioBuffer)=>void>=[];
    let started=0;
    const decoder=createCinemaSafariAdtsDecoder(SHA,{
      decodeAudioData:()=>{
        started++;
        return new Promise<AudioBuffer>(resolve=>{finishes.push(resolve);});
      },
    } as never,frame=>received.push(frame),()=>{});
    const first=decoder.push(packet(3,1_000_000));
    const secondPts=1_000_000+Math.round(3*1024*1e6/44100);
    const second=decoder.push(packet(3,secondPts));
    for(let n=0;n<4;n++)await Promise.resolve();
    expect(started).toBe(1);
    finishes[0](buffer(3072));
    await first;
    for(let n=0;n<4;n++)await Promise.resolve();
    expect(started).toBe(2);
    finishes[1](buffer(3072));
    await second;
    expect(received.map(frame=>frame.ptsUs)).toEqual([1_000_000,secondPts]);
    decoder.stop();
  });
  it('refuses queued packets after the initial Safari AAC decode fails',async()=>{
    const decoded:CinemaPcmFrame[]=[],failed:string[]=[];
    let rejectInitial:(reason:Error)=>void=()=>{};
    let calls=0;
    const decoder=createCinemaSafariAdtsDecoder(SHA,{
      decodeAudioData:()=>{
        calls++;
        return new Promise<AudioBuffer>((_,reject)=>{rejectInitial=reject;});
      },
    } as never,frame=>decoded.push(frame),reason=>failed.push(reason));
    const first=decoder.push(packet());
    const second=decoder.push(packet(3,1_000_000+Math.round(3*1024*1e6/44100)));
    for(let n=0;n<4;n++)await Promise.resolve();
    rejectInitial(new Error('Safari decoder failed'));
    await expect(first).rejects.toThrow('Safari decoder failed');
    await second;
    expect(calls).toBe(1);
    expect(decoded).toHaveLength(0);
    expect(failed).toHaveLength(1);
    expect(decoder.active).toBe(false);
  });
  it('does not output stale PCM after the session is stopped while decoding',async()=>{
    let finish:(b:AudioBuffer)=>void=()=>{};
    const delivered:CinemaPcmFrame[]=[];
    const decoder=createCinemaSafariAdtsDecoder(SHA,{
      decodeAudioData:()=>new Promise<AudioBuffer>(resolve=>{finish=resolve;}),
    } as never,frame=>delivered.push(frame),()=>{});
    const work=decoder.push(packet());
    decoder.stop();
    finish(buffer(3072));
    await work;
    expect(delivered).toHaveLength(0);
  });
});
