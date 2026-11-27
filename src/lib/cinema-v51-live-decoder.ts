import type {CinemaDemuxedDecoder} from './cinema-v51-decoder-adapter';

/**
 * Authorized, DRM-free demuxers produce compressed, timestamped packets.
 * Unlike a <video> readback, this is a genuine WebCodecs VideoDecoder path.
 * The HLS/MP4 demuxer MUST independently authenticate source identity and
 * emit exact PTS values after edit-list / HLS discontinuity normalization.
 */
export interface CinemaCompressedSample {
  sourceSha256:string;
  ptsUs:number;
  /** Composition timestamp may move backwards for HEVC B pictures. */
  dtsUs?:number;
  durationUs:number;
  key:boolean;
  data:Uint8Array;
}
export interface CinemaEncodedTrack {
  sourceSha256:string;
  codec:string;
  codedWidth:number;
  codedHeight:number;
  /** Demuxed HEVC/AV1/H264 decoder description (e.g. hvcC/av1C). */
  description?:Uint8Array;
  packets:AsyncIterable<CinemaCompressedSample>;
}
interface CinemaEncodedChunkApi {
  new(init:{type:'key'|'delta';timestamp:number;duration:number;data:BufferSource}):unknown;
}
interface CinemaVideoDecoderApi {
  new(init:{output:(frame:unknown)=>void;error:(error:Error)=>void}):CinemaDecoderInstance;
  isConfigSupported(config:unknown):Promise<{supported:boolean;config?:unknown}>;
}
interface CinemaDecoderInstance {
  state:string;
  decodeQueueSize:number;
  configure(config:unknown):void;
  decode(chunk:unknown):void;
  flush():Promise<void>;
  close():void;
}
export interface CinemaWebCodecsHost {
  VideoDecoder:CinemaVideoDecoderApi;
  EncodedVideoChunk:CinemaEncodedChunkApi;
}
export function cinemaWebCodecsAvailable():boolean {
  return typeof globalThis!=='undefined' &&
    'VideoDecoder' in globalThis && 'EncodedVideoChunk' in globalThis;
}
/**
 * Explicit packet/provider lifecycle. It is deliberately not enabled by
 * default in the normal Safari playback path: no verified 10-bit HLS demux
 * or DRM capability is presumed for arbitrary third-party streaming URLs.
 */
export function createCinemaLiveVideoDecoder(
  track:CinemaEncodedTrack,
  host:CinemaWebCodecsHost|null=null,
):CinemaDemuxedDecoder {
  let stopped=false;
  let instance:CinemaDecoderInstance|null=null;
  const sourceHash=/^[a-f0-9]{64}$/i;
  const api: CinemaWebCodecsHost|null=host??(
    cinemaWebCodecsAvailable()
      ? globalThis as unknown as CinemaWebCodecsHost : null);
  return {
    async start(onFrame,onError) {
      if(stopped)return;
      if(!api||!sourceHash.test(track.sourceSha256)||
        !/^[a-zA-Z0-9._-]{3,80}$/.test(track.codec)||
        !Number.isSafeInteger(track.codedWidth)||!Number.isSafeInteger(track.codedHeight)||
        track.codedWidth<2||track.codedHeight<2||
        track.codedWidth*track.codedHeight>1920*1080) {
        onError('Authenticated WebCodecs 10-bit source unavailable');
        return;
      }
      const config={
        codec:track.codec,codedWidth:track.codedWidth,codedHeight:track.codedHeight,
        ...(track.description?{description:track.description}:{}),
        hardwareAcceleration:'prefer-hardware',
        optimizeForLatency:true,
      };
      try {
        const support=await api.VideoDecoder.isConfigSupported(config);
        if(stopped)return;
        if(!support.supported)throw new Error('This WebCodecs codec is not supported');
        instance=new api.VideoDecoder({
          output:(frame)=> {
            if(stopped){(frame as {close():void}).close();return;}
            onFrame(frame as Parameters<typeof onFrame>[0]);
          },
          error:(error)=>{
            if(stopped)return;
            stopped=true;
            try {instance?.close();} catch {/* already closed */}
            onError(error.message);
          },
        });
        instance.configure(config);
        let lastDts=-1,seenKey=false,count=0;
        for await(const packet of track.packets) {
          if(stopped)return;
          if(packet.sourceSha256!==track.sourceSha256||
            !Number.isSafeInteger(packet.ptsUs)||packet.ptsUs<0||
            !Number.isSafeInteger(packet.dtsUs??packet.ptsUs)||(packet.dtsUs??packet.ptsUs)<0||
            (packet.dtsUs??packet.ptsUs)<=lastDts||
            !Number.isSafeInteger(packet.durationUs)||packet.durationUs<=0||
            !(packet.data instanceof Uint8Array)||packet.data.byteLength===0||
            packet.data.byteLength>8*1024*1024) {
            throw new Error('Invalid, untrusted or out-of-order encoded video packet');
          }
          if(!seenKey&&!packet.key)throw new Error('HLS segment starts without decoder keyframe');
          if(packet.key)seenKey=true;
          lastDts=packet.dtsUs??packet.ptsUs;
          count++;
          if(count>2_000_000)throw new Error('Encoded frame count exceeds bound');
          // Avoid unlimited decoder queue memory and abort on source replacement.
          for(let checks=0;instance.decodeQueueSize>4;checks++){
            if(stopped)return;
            if(checks>400)throw new Error('VideoDecoder backpressure timeout');
            await new Promise<void>(resolve=>setTimeout(resolve,5));
          }
          const exactBytes=new ArrayBuffer(packet.data.byteLength);
          new Uint8Array(exactBytes).set(packet.data);
          instance.decode(new api.EncodedVideoChunk({
            type:packet.key?'key':'delta',
            timestamp:packet.ptsUs,duration:packet.durationUs,data:exactBytes,
          }));
        }
        if(!stopped)await instance.flush();
      } catch (error) {
        if(!stopped){
          stopped=true;
          try {instance?.close();} catch {/* closed */}
          onError(error instanceof Error?error.message:'WebCodecs decoder failure');
        }
      } finally {
        // A naturally exhausted packet iterator must not pin the hardware
        // decoder indefinitely. This is a terminal, non-restartable session.
        try {instance?.close();} catch {/* already closed */}
        instance=null;
        stopped=true;
      }
    },
    stop() {
      if(stopped)return;
      stopped=true;
      try{instance?.close();}catch{/* already stopped */}
    },
  };
}
