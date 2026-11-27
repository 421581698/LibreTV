import {describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {cinemaReadPackedAacTimestamp,cinemaVerifiedHlsAacPackets,cinemaAuthorizedHlsAacSource} from './cinema-v51-hls-aac';
const SHA='a'.repeat(64);
function adts(){
  const length=11;
  return new Uint8Array([0xff,0xf1,0x50,0x80,length>>3,((length&7)<<5)|31,0xfc,1,2,3,4]);
}
function packed(pts90k:number) {
  const owner=new TextEncoder().encode('com.apple.streaming.transportStreamTimestamp');
  const raw=new Uint8Array(8);
  let pts=BigInt(pts90k);
  for(let i=7;i>=0;i--){raw[i]=Number(pts&255n);pts>>=8n;}
  const payload=new Uint8Array([...owner,0,...raw]);
  const length=payload.length;
  const frame=new Uint8Array([80,82,73,86,length>>>24,(length>>>16)&255,(length>>>8)&255,
    length&255,0,0,...payload]);
  const tagLength=frame.length;
  const id3=new Uint8Array([73,68,51,3,0,0,
    (tagLength>>>21)&127,(tagLength>>>14)&127,(tagLength>>>7)&127,tagLength&127,
    ...frame,...adts()]);
  return id3;
}
async function collect(data:Uint8Array,pts90k:number,expectedSha?:string){
  const digest=createHash('sha256').update(data).digest('hex');
  const segments=(async function*(){yield {sourceSha256:SHA,expectedSha256:expectedSha??digest,data};})();
  const packets=[];
  for await(const packet of cinemaVerifiedHlsAacPackets({
    sourceSha256:SHA,expectedSourceSha256:SHA,origin90k:pts90k,
    mediaOriginUs:500000,segments,
  }))packets.push(packet);
  return packets;
}
describe('verified HLS Packed AAC adapter',()=>{
  it('parses Apple PRIV PTS and strips only the authenticated ID3 envelope',async()=>{
    const segment=packed(90000);
    expect(cinemaReadPackedAacTimestamp(segment).pts90k).toBe(90000);
    const packets=await collect(segment,90000);
    expect(packets).toHaveLength(1);
    expect(packets[0].ptsUs).toBe(500000);
    expect(Array.from(packets[0].data)).toEqual(Array.from(adts()));
  });
  it('refuses edited bytes with stale content hashes before any AAC decode',async()=>{
    await expect(collect(packed(90000),90000,'f'.repeat(64))).rejects.toThrow('digest');
  });
  it('refuses ID3 without the required timestamp and unknown transport formats',()=>{
    const wrong=packed(90000);
    wrong[10]=0x54;
    expect(()=>cinemaReadPackedAacTimestamp(wrong)).toThrow('Missing Apple');
    expect(()=>cinemaReadPackedAacTimestamp(adts())).toThrow('ID3');
  });
  it('rejects segment timestamp reversal or discontinuity',async()=>{
    const segments=(async function*(){
      for(const pts of [90000,180000,90000]){
        const data=packed(pts);
        yield {sourceSha256:SHA,expectedSha256:createHash('sha256').update(data).digest('hex'),data};
      }
    })();
    const run=async()=>{
      for await(const _ of cinemaVerifiedHlsAacPackets({
        sourceSha256:SHA,expectedSourceSha256:SHA,origin90k:90000,mediaOriginUs:0,segments,
      })){}
    };
    await expect(run()).rejects.toThrow('continuity');
  });
});

describe('Safari verified HLS AAC -> shared PCM engine binding',()=>{
  it('carries the exact authenticated media identity, ID3 PTS and video clock mapping',async()=>{
    const start90k=90000;
    const data=packed(start90k);
    const expectedSha256=createHash('sha256').update(data).digest('hex');
    const track={
      sourceSha256:SHA,expectedSourceSha256:SHA,origin90k:start90k,
      mediaOriginUs:4500000,
      segments:(async function*(){yield {sourceSha256:SHA,expectedSha256,data};})(),
    };
    const source=cinemaAuthorizedHlsAacSource(track,4500000);
    expect(source.sourceSha256).toBe(SHA);
    expect(source.presentationOffsetUs).toBe(4500000);
    const packets=[];
    for await(const packet of source.packets)packets.push(packet);
    expect(packets).toHaveLength(1);
    expect(packets[0].ptsUs).toBe(4500000);
    expect(Array.from(packets[0].data)).toEqual(Array.from(adts()));
  });
  it('rejects a forged media identity or an unknown A/V offset before decoder startup',()=>{
    const base={
      sourceSha256:SHA,expectedSourceSha256:'b'.repeat(64),
      origin90k:90000,mediaOriginUs:0,
      segments:(async function*(){})(),
    };
    expect(()=>cinemaAuthorizedHlsAacSource(base,0)).toThrow('authenticated');
    expect(()=>cinemaAuthorizedHlsAacSource({...base,expectedSourceSha256:SHA},NaN))
      .toThrow('authenticated');
  });
});
