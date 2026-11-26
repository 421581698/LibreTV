/**
 * Verified clear HLS Packed Audio (AAC/ADTS) adapter.
 *
 * The segment's full immutable SHA-256 is checked BEFORE parsing. Its PTS
 * comes from the RFC 8216 ID3 PRIV 90kHz clock, never from download timing.
 * For audio-only Packed AAC, not TS/fMP4/encrypted/LL-HLS or arbitrary CMS.
 * The segment byte provider and 90kHz video origin must be separately trusted.
 */
import type {CinemaPcmPacket} from './cinema-v51-pcm';
import {cinemaDemuxAdts} from './cinema-v51-pcm';
export interface CinemaVerifiedHlsAacSegment {
  sourceSha256:string;
  /** Content-addressed identity supplied by an authenticated asset graph. */
  expectedSha256:string;
  data:Uint8Array;
}
export interface CinemaVerifiedHlsAacTrack {
  sourceSha256:string;
  expectedSourceSha256:string;
  /** Independently validated common video/audio 90kHz origin. */
  origin90k:number;
  /** Exact media-clock PTS at origin, from the authenticated timeline. */
  mediaOriginUs:number;
  segments:AsyncIterable<CinemaVerifiedHlsAacSegment>;
}
const HEX=/^[0-9a-f]{64}$/i;
function synchsafe(bytes:Uint8Array,index:number):number {
  if(index+4>bytes.length)throw new Error('Truncated ID3 synchsafe length');
  const [a,b,c,d]=[bytes[index],bytes[index+1],bytes[index+2],bytes[index+3]];
  if((a|b|c|d)&0x80)throw new Error('Invalid ID3 synchsafe length');
  return (a<<21)|(b<<14)|(c<<7)|d;
}
function u32(bytes:Uint8Array,index:number):number {
  if(index+4>bytes.length)throw new Error('Truncated ID3 frame length');
  return bytes[index]*2**24+bytes[index+1]*65536+bytes[index+2]*256+bytes[index+3];
}
function ascii(bytes:Uint8Array,start:number,end:number):string {
  let str='';
  for(let i=start;i<end;i++){
    if(bytes[i]>0x7f)throw new Error('Invalid ID3 PRIV owner');
    str+=String.fromCharCode(bytes[i]);
  }
  return str;
}
const PRIV_OWNER='com.apple.streaming.transportStreamTimestamp';
export function cinemaReadPackedAacTimestamp(data:Uint8Array):{pts90k:number;audioOffset:number} {
  if(!(data instanceof Uint8Array)||data.byteLength<26||data.byteLength>512*1024||
    data[0]!==0x49||data[1]!==0x44||data[2]!==0x33||![3,4].includes(data[3])||
    data[4]!==0||data[5]!==0)
    throw new Error('HLS Packed AAC requires a standard uncompressed ID3 header');
  const tagLength=synchsafe(data,6);
  const end=10+tagLength;
  if(end>data.byteLength||tagLength>16*1024||end>=data.byteLength)
    throw new Error('Invalid bounded ID3 tag');
  let offset=10,pts:number|null=null;
  while(offset+10<=end){
    const type=ascii(data,offset,offset+4);
    if(type==='\x00\x00\x00\x00')break;
    const size=data[3]===4?synchsafe(data,offset+4):u32(data,offset+4);
    const flags=(data[offset+8]<<8)|data[offset+9];
    if(!/^[A-Z0-9]{4}$/.test(type)||flags!==0||size<0||
       offset+10+size>end)throw new Error('Malformed or unsupported ID3 frame');
    const start=offset+10;
    if(type==='PRIV'){
      let zero=start;
      while(zero<start+size&&data[zero]!==0)zero++;
      if(zero>=start+size)throw new Error('Unterminated ID3 private owner');
      if(ascii(data,start,zero)===PRIV_OWNER) {
        if(pts!==null||start+size-(zero+1)!==8)throw new Error('Ambiguous HLS private timestamp');
        let raw=0n;
        for(let i=zero+1;i<start+size;i++)raw=(raw<<8n)|BigInt(data[i]);
        if((raw>>33n)!==0n)throw new Error('Invalid 33-bit HLS timestamp');
        pts=Number(raw);
      }
    }
    offset+=10+size;
  }
  if(pts===null)throw new Error('Missing Apple Packed Audio transport timestamp');
  if(data[end]!==0xff)throw new Error('ID3 is not followed by clear ADTS frames');
  return {pts90k:pts,audioOffset:end};
}
async function sha256(data:Uint8Array):Promise<string> {
  if(typeof crypto==='undefined'||!crypto.subtle)
    throw new Error('Browser SHA-256 verification unavailable');
  const bytes=new Uint8Array(data.length);bytes.set(data);
  const hash=await crypto.subtle.digest('SHA-256',bytes.buffer);
  return Array.from(new Uint8Array(hash)).map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
/** A source-bound packet iterator suitable for the Cinema WebCodecs AAC decoder. */
export async function* cinemaVerifiedHlsAacPackets(
  track:CinemaVerifiedHlsAacTrack,
):AsyncGenerator<CinemaPcmPacket> {
  if(!HEX.test(track.sourceSha256)||track.sourceSha256.toLowerCase()!==
      track.expectedSourceSha256.toLowerCase()||
     !Number.isSafeInteger(track.origin90k)||track.origin90k<0||track.origin90k>=2**33||
     !Number.isSafeInteger(track.mediaOriginUs)||track.mediaOriginUs<0)
    throw new Error('Unverified HLS Packed AAC identity or time origin');
  let lastPts=-1,count=0;
  for await(const segment of track.segments){
    if(++count>20000)throw new Error('Too many AAC segments');
    if(segment.sourceSha256.toLowerCase()!==track.sourceSha256.toLowerCase()||
       !HEX.test(segment.expectedSha256)||!(segment.data instanceof Uint8Array)||
       segment.data.length>512*1024||segment.data.length<26)
      throw new Error('Unverified or oversized HLS AAC segment');
    if(await sha256(segment.data)!==segment.expectedSha256.toLowerCase())
      throw new Error('HLS AAC segment bytes do not match trusted digest');
    const {pts90k,audioOffset}=cinemaReadPackedAacTimestamp(segment.data);
    const delta=(pts90k-track.origin90k+2**33)%(2**33);
    if(delta>=2**32)throw new Error('HLS timestamp predates trusted origin');
    const ptsUs=track.mediaOriginUs+Math.round(delta*1e6/90000);
    if(!Number.isSafeInteger(ptsUs)||ptsUs<=lastPts||
       (lastPts>=0&&ptsUs-lastPts>30e6))
      throw new Error('Invalid HLS audio segment timestamp continuity');
    const packet={sourceSha256:track.sourceSha256,ptsUs,data:segment.data.slice(audioOffset)};
    const decoded=cinemaDemuxAdts(packet);
    const endUs=decoded.frames.at(-1)!.ptsUs+decoded.frames.at(-1)!.durationUs;
    if(!Number.isSafeInteger(endUs))throw new Error('AAC timestamp overflow');
    lastPts=ptsUs;
    yield packet;
  }
}
