/**
 * Optional user-selected, clear VOD HLS audio-only AAC resolver.
 *
 * Unlike arbitrary CMS URLs, this operates only on a HTTPS/CORS-readable
 * HLS master with a distinct AAC audio rendition and matching PROGRAM-DATE-
 * TIME origins for its video and audio media playlists. The media user's
 * current playback selection grants local processing, not DRM access.
 *
 * The hashes bind this browser session's fetched bytes; they do NOT
 * constitute a provider-signed provenance attestation. Never advertise
 * this path as certified Dolby decoding or guaranteed native Safari output.
 * Muxed TS, CMAF/fMP4, AES, SAMPLE-AES and manifests without an exact A/V
 * alignment are intentionally left to the original Safari audio output.
 */
import {cinemaReadPackedAacTimestamp,cinemaAuthorizedHlsAacSource,
  type CinemaVerifiedHlsAacSegment,type CinemaVerifiedHlsAacTrack} from './cinema-v51-hls-aac';
import type {CinemaAuthorizedAacSource} from './cinema-v51-pcm-playback';

interface MediaSegment {url:string;seconds:number;startsAt:number}
interface Playlist {segments:MediaSegment[];startDateMs:number;duration:number}
const MAX_MANIFEST=131072,MAX_SEGMENT=524288,MAX_SEGMENTS=1500;
const HLS_MIME='application/vnd.apple.mpegurl';
function checkedUri(input:string,base?:string):string {
  const uri=new URL(input,base);
  if(uri.protocol!=='https:'||uri.username||uri.password)throw new Error('Unsafe HLS URL');
  const host=uri.hostname.toLowerCase();
  if(host==='localhost'||host==='127.0.0.1'||host==='[::1]'||
     /^(?:10|127|169\.254|192\.168|172\.(?:1[6-9]|2[0-9]|3[01]))\./.test(host)||
     host.endsWith('.local')||host.endsWith('.internal'))
    throw new Error('Private HLS URL is not a verified clear-media origin');
  return uri.href;
}
async function readBytes(url:string,signal:AbortSignal,max:number):Promise<Uint8Array> {
  const response=await fetch(url,{mode:'cors',credentials:'omit',redirect:'error',
    cache:'no-store',signal,headers:{Accept:'*/*'}});
  if(!response.ok)throw new Error('HLS source refused an authorized CORS read');
  const contentLength=Number(response.headers.get('content-length'));
  if(Number.isFinite(contentLength)&&contentLength>max)
    throw new Error('HLS response exceeds bounded segment size');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length>max||bytes.length===0)throw new Error('Invalid bounded HLS response');
  return bytes;
}
async function readText(url:string,signal:AbortSignal):Promise<string> {
  const bytes=await readBytes(url,signal,MAX_MANIFEST);
  const value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(!value.startsWith('#EXTM3U'))throw new Error('Not a valid HLS playlist');
  return value;
}
function attrs(value:string):Record<string,string>{
  const out:Record<string,string>={};
  for(const m of value.matchAll(/([A-Z0-9-]+)=("([^"]*)"|[^,]+)/g))
    out[m[1]]=(m[3]??m[2]).replace(/^"|"$/g,'');
  return out;
}
function parseMedia(text:string,url:string):Playlist {
  if(!/^#EXT-X-PLAYLIST-TYPE:VOD\s*$/m.test(text)||
     !/^#EXT-X-ENDLIST\s*$/m.test(text)||
     /^#EXT-X-(?:KEY|SESSION-KEY|MAP|DISCONTINUITY|BYTERANGE|PART|SKIP|START|I-FRAMES-ONLY)/m.test(text))
    throw new Error('Only clear, complete VOD HLS playlists with explicit clock are supported');
  const segments:MediaSegment[]=[];
  let pending:number|null=null,firstDate=NaN,total=0;
  for(const raw of text.split(/\r?\n/)){
    const line=raw.trim();
    if(line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')){
      if(segments.length===0&&pending===null){
        const date=Date.parse(line.slice('#EXT-X-PROGRAM-DATE-TIME:'.length));
        if(!Number.isFinite(date))throw new Error('Invalid HLS media clock');
        firstDate=date;
      }
    }else if(line.startsWith('#EXTINF:')){
      const seconds=Number(line.slice(8).split(',')[0]);
      if(!Number.isFinite(seconds)||seconds<=0||seconds>8)
        throw new Error('Unsupported HLS audio/video segment duration');
      pending=seconds;
    }else if(line&&!line.startsWith('#')){
      if(pending===null||!Number.isFinite(firstDate))throw new Error('Missing segment duration or start clock');
      segments.push({url:checkedUri(line,url),seconds:pending,startsAt:total});
      total+=pending;pending=null;
      if(segments.length>MAX_SEGMENTS||total>6*3600)throw new Error('HLS VOD length limit');
    }
  }
  if(!segments.length||pending!==null||!Number.isFinite(firstDate))throw new Error('Incomplete HLS media playlist');
  return {segments,startDateMs:firstDate,duration:total};
}
function selectMedia(master:string,url:string):{audio:string;video:string} {
  const lines=master.split(/\r?\n/).map(s=>s.trim());
  const declared=lines.filter(s=>s.startsWith('#EXT-X-MEDIA:'))
    .map(s=>attrs(s.slice('#EXT-X-MEDIA:'.length)))
    .filter(a=>a.TYPE==='AUDIO'&&a.URI&&a['GROUP-ID']);
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(!line.startsWith('#EXT-X-STREAM-INF:'))continue;
    const properties=attrs(line.slice('#EXT-X-STREAM-INF:'.length));
    if(!properties.AUDIO)continue;
    const codecs=(properties.CODECS??'').toLowerCase();
    if(codecs&&(!codecs.includes('mp4a.40.2')||/ec-3|ac-3|ac-4|alac|opus|mp4a.40.5/.test(codecs)))
      continue;
    const video=lines.slice(i+1).find(s=>s&&!s.startsWith('#'));
    if(!video)continue;
    const matched=declared.filter(a=>a['GROUP-ID']===properties.AUDIO);
    const audio=matched.find(a=>a.DEFAULT==='YES')??matched[0];
    if(audio)return {audio:checkedUri(audio.URI,url),video:checkedUri(video,url)};
  }
  throw new Error('No separate clear AAC audio rendition is declared');
}
async function digest(bytes:Uint8Array):Promise<string>{
  if(typeof crypto==='undefined'||!crypto.subtle)throw new Error('HLS source digest unavailable');
  const copy=new Uint8Array(bytes.length);copy.set(bytes);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',copy.buffer)))
    .map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function cinemaDiscoverClearVodHlsAac(
  video:HTMLVideoElement,sourceUrl:string,signal:AbortSignal,
):Promise<CinemaAuthorizedAacSource> {
  const url=checkedUri(sourceUrl);
  if(!/\.m3u8$/i.test(new URL(url).pathname)||video.mediaKeys||
     video.seekable.length===0||video.duration<=0||!Number.isFinite(video.duration)||
     video.seekable.start(0)>.05)
    throw new Error('No authorized seekable clear native HLS VOD');
  const master=await readText(url,signal);
  if(/^#EXT-X-(?:KEY|SESSION-KEY)/m.test(master))throw new Error('Protected HLS cannot enter DSP');
  const media=selectMedia(master,url);
  const [audioText,videoText]=await Promise.all([
    readText(media.audio,signal),readText(media.video,signal),
  ]);
  const audio=parseMedia(audioText,media.audio);
  const picture=parseMedia(videoText,media.video);
  if(Math.abs(audio.startDateMs-picture.startDateMs)>20||
     Math.abs(audio.duration-picture.duration)>.4||
     Math.abs(video.duration-picture.duration)>1)
    throw new Error('Native Safari HLS A/V origin is not safely aligned');
  const first=await readBytes(audio.segments[0].url,signal,MAX_SEGMENT);
  const origin90k=cinemaReadPackedAacTimestamp(first).pts90k;
  // This digest identifies the exact manifest graph selected by the user
  // within this browser session. It does not imply a publisher signature.
  const sourceSha256=await digest(new TextEncoder().encode(
    url+'\n'+master+'\n'+media.video+'\n'+videoText+'\n'+media.audio+'\n'+audioText));
  const segments=(async function*():AsyncGenerator<CinemaVerifiedHlsAacSegment>{
    // Begin at the segment immediately preceding the current playhead.
    // Missing early data is never filled using invented timestamps.
    const time=video.currentTime;
    const chosen=audio.segments.findIndex(item=>item.startsAt+item.seconds>=time-.12);
    if(chosen<0)throw new Error('Audio playhead outside verified HLS playlist');
    const begin=Math.max(0,chosen-1);
    for(let index=begin;index<audio.segments.length;index++){
      if(signal.aborted)throw new Error('HLS source has been changed');
      const item=audio.segments[index];
      const bytes=index===0?first:await readBytes(item.url,signal,MAX_SEGMENT);
      const ts=cinemaReadPackedAacTimestamp(bytes).pts90k;
      const delta=(ts-origin90k+2**33)%(2**33);
      const segmentSeconds=delta/90000;
      if(delta>=2**32||Math.abs(segmentSeconds-item.startsAt)>.12)
        throw new Error('Packed AAC ID3 PTS and HLS VOD timeline disagree');
      yield {sourceSha256,expectedSha256:await digest(bytes),data:bytes};
    }
  })();
  const track:CinemaVerifiedHlsAacTrack={
    sourceSha256,expectedSourceSha256:sourceSha256,
    origin90k,mediaOriginUs:0,segments,
  };
  return cinemaAuthorizedHlsAacSource(track,0);
}
