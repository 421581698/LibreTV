import Hls, { Events } from 'hls.js';
import { ExperimentalAudioSession } from './experimental-audio-session';
import { ExperimentalHlsAudioInput } from './experimental-hls-audio-input';
import { OpenJocExperimentalDecoder, type OpenJocAbi } from './openjoc-experimental-decoder';
import { ExperimentalPcmOutput } from './experimental-pcm-output';

/** Opt-in integration for a verified clear, single-track TS rendition.
 * ABI, running AudioContext and media timeline must be supplied by an
 * authorized caller. Never downloads or enables an experimental decoder.
 */
export function bindExperimentalHlsAudio(options: {
  hls: Hls;
  video: HTMLVideoElement;
  abi: OpenJocAbi;
  context: AudioContext;
  origin90k: number;
  isCurrent: () => boolean;
}): () => void {
  const { hls, video, abi, context, origin90k, isCurrent } = options;
  if (context.state !== 'running' || video.paused || video.muted ||
      !Number.isSafeInteger(origin90k) || origin90k < 0 || !isCurrent()) {
    throw new Error('Experimental audio prerequisites not met');
  }
  const session = new ExperimentalAudioSession(video);
  const input = new ExperimentalHlsAudioInput(session);
  const generation = input.begin();
  const decoder = new OpenJocExperimentalDecoder(abi);
  const output = new ExperimentalPcmOutput(context, context.destination);
  if (!session.arm(decoder, output)) {
    decoder.close();
    throw new Error('Experimental audio activation rejected');
  }
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    hls.off(Hls.Events.FRAG_LOADED, onFragment);
    hls.off(Hls.Events.AUDIO_TRACK_SWITCHING, close);
    hls.off(Hls.Events.DESTROYING, close);
    for (const event of ['pause', 'seeking', 'ratechange', 'emptied', 'error', 'waiting']) video.removeEventListener(event, close);
    session.close();
  };
  const onFragment = (_event: Events.FRAG_LOADED, raw: unknown) => {
    if (closed) return;
    if (!isCurrent()) { close(); return; }
    const data = raw as { frag?: { type?: string; sn?: number | string; cc?: number; level?: number; decryptdata?: { encrypted?: boolean } | null }; payload?: ArrayBuffer };
    const frag = data.frag;
    if (!frag || frag.type !== 'audio') return;
    if (frag.decryptdata?.encrypted || typeof frag.sn !== 'number' ||
        !Number.isSafeInteger(frag.sn) || !(data.payload instanceof ArrayBuffer)) { close(); return; }
    if (!input.push(generation, `${frag.cc}:${frag.level}:${frag.sn}`, new Uint8Array(data.payload), origin90k)) close();
  };
  hls.on(Hls.Events.FRAG_LOADED, onFragment);
  hls.on(Hls.Events.AUDIO_TRACK_SWITCHING, close);
  hls.on(Hls.Events.DESTROYING, close);
  for (const event of ['pause', 'seeking', 'ratechange', 'emptied', 'error', 'waiting']) video.addEventListener(event, close);
  return close;
}
