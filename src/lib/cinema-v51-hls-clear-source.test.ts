import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {webcrypto,createHash} from 'node:crypto';
import {cinemaDiscoverClearVodHlsAac} from './cinema-v51-hls-clear-source';
const ORIGIN='https://media.example.test';
const MASTER=`#EXTM3U
#EXT-X-VERSION:6
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="English",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=640000,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="aac"
video.m3u8
`;
const START='2026-11-27T12:00:00.000Z';
function media(name:string,start=START,added=''){
  return `#EXTM3U
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-TARGETDURATION:2
${added}
#EXT-X-PROGRAM-DATE-TIME:${start}
#EXTINF:2.000,
${name}
#EXT-X-ENDLIST
`;
}
function adts(){
  const n=11;
  return [0xff,0xf1,0x50,0x80,n>>3,((n&7)<<5)|31,0xfc,1,2,3,4];
}
function packed(pts90k:number){
  const owner=new TextEncoder().encode('com.apple.streaming.transportStreamTimestamp');
  const bytes=new Uint8Array(8);let pts=BigInt(pts90k);
  for(let i=7;i>=0;i--){bytes[i]=Number(pts&255n);pts>>=8n;}
  const payload=[...owner,0,...bytes];
  const frame=[80,82,73,86,0,0,0,payload.length,0,0,...payload];
  return new Uint8Array([73,68,51,3,0,0,0,0,0,frame.length,...frame,
    ...Array.from({length:8},()=>adts()).flat()]);
}
class Video {
  currentTime=.4;duration=2;mediaKeys:MediaKeys|null=null;
  seekable={length:1,start:(_n:number)=>0};
}
let replies=new Map<string,Uint8Array>();
let requests:string[]=[];
function installFetch(){
  vi.stubGlobal('fetch',vi.fn(async(input:string)=>{
    requests.push(input);
    const bytes=replies.get(input);
    if(!bytes)return new Response('Not Found',{status:404});
    return new Response(new Uint8Array(bytes).buffer,{status:200,
      headers:{'content-type':input.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'audio/aac'}});
  }));
}
beforeEach(()=>{
  requests=[];
  replies=new Map([
    [ORIGIN+'/master.m3u8',new TextEncoder().encode(MASTER)],
    [ORIGIN+'/audio.m3u8',new TextEncoder().encode(media('audio0.aac'))],
    [ORIGIN+'/video.m3u8',new TextEncoder().encode(media('video0.ts'))],
    [ORIGIN+'/audio0.aac',packed(90000)],
  ]);
  vi.stubGlobal('crypto',webcrypto);
  installFetch();
});
afterEach(()=>vi.unstubAllGlobals());
describe('Safari native HLS clear independent audio source discovery',()=>{
  it('follows a matching AAC rendition, validates VOD clock and yields actual parsed ADTS',async()=>{
    const source=await cinemaDiscoverClearVodHlsAac(
      new Video() as never,ORIGIN+'/master.m3u8',new AbortController().signal);
    expect(source.presentationOffsetUs).toBe(0);
    expect(source.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(source.expectedSourceSha256).toBe(source.sourceSha256);
    const result=[];
    for await(const packet of source.packets)result.push(packet);
    expect(result).toHaveLength(1);
    expect(result[0].ptsUs).toBe(0);
    expect(result[0].data.length).toBe(8*adts().length);
    expect(requests).toEqual([
      ORIGIN+'/master.m3u8',ORIGIN+'/audio.m3u8',ORIGIN+'/video.m3u8',ORIGIN+'/audio0.aac',
    ]);
  });
  it('rejects misaligned audio/video playlist clocks before attempting PCM takeover',async()=>{
    replies.set(ORIGIN+'/video.m3u8',
      new TextEncoder().encode(media('video0.ts','2026-11-27T12:00:00.200Z')));
    await expect(cinemaDiscoverClearVodHlsAac(
      new Video() as never,ORIGIN+'/master.m3u8',new AbortController().signal))
      .rejects.toThrow('origin');
  });
  it('rejects encrypted audio, unauthorized URLs and DRM without fetching media',async()=>{
    replies.set(ORIGIN+'/audio.m3u8',
      new TextEncoder().encode(media('audio0.aac',START,
        '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"')));
    await expect(cinemaDiscoverClearVodHlsAac(
      new Video() as never,ORIGIN+'/master.m3u8',new AbortController().signal))
      .rejects.toThrow('clear');
    requests=[];
    await expect(cinemaDiscoverClearVodHlsAac(
      new Video() as never,'http://media.example.test/master.m3u8',
      new AbortController().signal)).rejects.toThrow('Unsafe');
    const protectedVideo=new Video();protectedVideo.mediaKeys={} as MediaKeys;
    await expect(cinemaDiscoverClearVodHlsAac(
      protectedVideo as never,ORIGIN+'/master.m3u8',new AbortController().signal))
      .rejects.toThrow('authorized');
    expect(requests).toHaveLength(0);
  });
  it('never confuses a browser-computed session hash with an external media signature',async()=>{
    const source=await cinemaDiscoverClearVodHlsAac(
      new Video() as never,ORIGIN+'/master.m3u8',new AbortController().signal);
    const expected=createHash('sha256').update(ORIGIN+'/master.m3u8'+'\n'+MASTER+'\n'+
      ORIGIN+'/video.m3u8'+'\n'+media('video0.ts')+'\n'+
      ORIGIN+'/audio.m3u8'+'\n'+media('audio0.aac')).digest('hex');
    expect(source.sourceSha256).toBe(expected);
  });
});
