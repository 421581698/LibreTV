import {describe,expect,it,vi} from 'vitest';
import {createCinemaLiveVideoDecoder,type CinemaCompressedSample} from './cinema-v51-live-decoder';
const source='c'.repeat(64);
const packet=(ptsUs:number,key:boolean,sourceSha256=source)=>({
  sourceSha256,ptsUs,durationUs:33333,key,data:new Uint8Array([0,0,0,1,0x26,0x01]),
});
function harness(chunks:CinemaCompressedSample[]=[packet(1000000,true),packet(1033333,false)]) {
  const created:{config?:unknown;chunks:unknown[];closed:boolean}={chunks:[],closed:false};
  let output:(frame:unknown)=>void=()=>{};
  const FakeDecoder=class {
    state='configured';decodeQueueSize=0;
    static async isConfigSupported(){return {supported:true};}
    constructor(init:{output:(frame:unknown)=>void}){output=init.output;}
    configure(config:unknown){created.config=config;}
    decode(chunk:unknown){created.chunks.push(chunk);output({timestamp:1000000,close:vi.fn()});}
    async flush(){}
    close(){created.closed=true;}
  };
  const host={
    VideoDecoder:FakeDecoder,
    EncodedVideoChunk:class {
      constructor(public readonly info:{timestamp:number;data:ArrayBuffer;type:string}){}
    },
  };
  const track={
    sourceSha256:source,codec:'hvc1.2.4.L153.B0',codedWidth:640,codedHeight:360,
    packets:(async function*(){for(const chunk of chunks)yield chunk;})(),
  };
  return {created,host,track};
}
describe('Cinema V5.1 WebCodecs compressed packet decoder',()=>{
 it('configures actual decoder, queues packet PTS and forwards decoded frames',async()=>{
  const t=harness();
  const output:unknown[]=[],errors:string[]=[];
  const runtime=createCinemaLiveVideoDecoder(t.track,t.host as never);
  await runtime.start(frame=>output.push(frame),reason=>errors.push(reason));
  expect(errors).toEqual([]);
  expect(t.created.config).toEqual(expect.objectContaining({
    codec:'hvc1.2.4.L153.B0',codedWidth:640,codedHeight:360,
  }));
  expect(t.created.chunks).toHaveLength(2);
  expect(t.created.chunks[0]).toEqual(expect.objectContaining({
    info:expect.objectContaining({timestamp:1000000,type:'key'}),
  }));
  expect(output).toHaveLength(2);
  runtime.stop();
  expect(t.created.closed).toBe(true);
 });
 it('fails closed for nonkey first frame, cross-source packet, or repeated timestamp',async()=>{
  for(const chunks of [
    [packet(1000000,false)],
    [packet(1000000,true,'a'.repeat(64))],
    [packet(1000000,true),packet(1000000,false)],
  ]){
    const t=harness(chunks);
    const errors:string[]=[];
    await createCinemaLiveVideoDecoder(t.track,t.host as never).start(()=>{},reason=>errors.push(reason));
    expect(errors).toHaveLength(1);
    expect(t.created.closed).toBe(true);
  }
 });
 it('accepts HEVC B-frame composition reordering when decode DTS strictly increases',async()=>{
  const reordered=[
    {...packet(1000000,true),dtsUs:0},
    {...packet(1066666,false),dtsUs:33333},
    {...packet(1033333,false),dtsUs:66666},
  ];
  const t=harness(reordered),errors:string[]=[];
  await createCinemaLiveVideoDecoder(t.track,t.host as never)
    .start(()=>{},reason=>errors.push(reason));
  expect(errors).toEqual([]);
  expect(t.created.chunks).toHaveLength(3);
  expect(t.created.chunks.map(c=>(c as {info:{timestamp:number}}).info.timestamp))
    .toEqual([1000000,1066666,1033333]);
 });
 it('rejects duplicate or decreasing decode timestamps even when composition PTS differs',async()=>{
  for(const dts of [33333,20000]){
    const t=harness([
      {...packet(1000000,true),dtsUs:33333},
      {...packet(1033333,false),dtsUs:dts},
    ]);
    const errors:string[]=[];
    await createCinemaLiveVideoDecoder(t.track,t.host as never)
      .start(()=>{},reason=>errors.push(reason));
    expect(errors).toHaveLength(1);
  }
 });
 it('does not fake support without a VideoDecoder API',async()=>{
  const t=harness();
  const errors:string[]=[];
  await createCinemaLiveVideoDecoder(t.track,{} as never).start(()=>{},reason=>errors.push(reason));
  expect(errors).toHaveLength(1);
 });
});
