#!/usr/bin/env node
/**
 * Chromium + Playwright real Web Audio / captured PCM regression, plus a
 * deliberate Safari-WebKit fail-closed path. These headless browsers are
 * NOT physical iPad Safari devices or spatial speaker measurements.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {transform} from 'esbuild';
import {chromium,webkit} from 'playwright';

const compiled=await transform(readFileSync(resolve('src/lib/cinema-v51-sound.ts'),'utf8'),{
  loader:'ts',format:'iife',globalName:'CinemaV51',target:'es2022',
});
const launchOptions={
  headless:true,args:['--autoplay-policy=no-user-gesture-required'],
};
async function verifyChromium(){
  const browser=await chromium.launch({...launchOptions,channel:'chrome'});
  try{
    const page=await browser.newPage();
    await page.setContent('<!doctype html><meta charset="utf-8"><button id="run">Run PCM DSP</button><video playsinline preload="auto"></video>');
    await page.addScriptTag({content:compiled.code});
    const result=await page.evaluate(async()=>{
      const video=document.querySelector('video');
      if(!video||!window.CinemaV51)throw new Error('Web Audio browser fixture unavailable');
      if(!window.MediaRecorder||!window.AudioContext||!HTMLVideoElement.prototype.captureStream)
        return {captureSupported:false,reason:'Unsupported media capture'};
      const audio=new AudioContext();
      await audio.resume();
      const oscillator=audio.createOscillator();
      const volume=audio.createGain();
      volume.gain.value=.23;
      const destination=audio.createMediaStreamDestination();
      oscillator.frequency.value=440;
      oscillator.connect(volume);volume.connect(destination);
      const canvas=document.createElement('canvas');
      canvas.width=128;canvas.height=72;
      const context=canvas.getContext('2d');
      let count=0;
      const timer=setInterval(()=>{
        if(context){
          context.fillStyle=count++%2?'#f00':'#00f';
          context.fillRect(0,0,canvas.width,canvas.height);
        }
      },33);
      const recorded=new MediaStream([
        ...canvas.captureStream(30).getVideoTracks(),
        ...destination.stream.getAudioTracks(),
      ]);
      const mime='video/webm;codecs=vp8,opus';
      if(!MediaRecorder.isTypeSupported(mime)){
        clearInterval(timer);recorded.getTracks().forEach(t=>t.stop());
        await audio.close();
        return {captureSupported:false,reason:'Missing WebM Opus recording fixture'};
      }
      const buffers=[];
      const recorder=new MediaRecorder(recorded,{mimeType:mime});
      recorder.ondataavailable=event=>{if(event.data.size)buffers.push(event.data);};
      oscillator.start();
      await new Promise((resolve,reject)=>{
        recorder.onerror=event=>reject(event.error||new Error('Recorder failed'));
        recorder.onstop=resolve;
        recorder.start();
        setTimeout(()=>recorder.stop(),1000);
      });
      oscillator.stop();
      clearInterval(timer);
      recorded.getTracks().forEach(t=>t.stop());
      await audio.close();
      const url=URL.createObjectURL(new Blob(buffers,{type:mime}));
      video.src=url;
      video.loop=true;
      video.volume=.6;
      await video.play();
      await new Promise(resolve=>setTimeout(resolve,200));
      const states=[];
      const session=await window.CinemaV51.createCinemaSoundSession(video,state=>states.push(state));
      if(!session) {
        URL.revokeObjectURL(url);
        return {captureSupported:true,dspActive:false,reason:states.at(-1)?.reason||'No captured session'};
      }
      session.enable('audio',true);
      for(let i=0;i<55&&!session.state().audio;i++)await new Promise(resolve=>setTimeout(resolve,90));
      const audioActive=session.state().audio;
      session.enable('spatial',true);
      await new Promise(resolve=>setTimeout(resolve,120));
      const spatialActive=session.state().spatial;
      const mutedDuringDsp=video.muted;
      video.dispatchEvent(new Event('seeking'));
      await new Promise(resolve=>setTimeout(resolve,60));
      const restored=!video.muted;
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      return {captureSupported:true,dspActive:audioActive,hrtfActive:spatialActive,
        mutedDuringDsp,restored,
        fallbackObserved:states.some(state=>state.output==='native'&&state.reason.includes('恢复原生音频')),
        states:states.map(s=>s.output+':'+s.reason)};
    });
    console.log('Chrome Web Audio DSP result:',JSON.stringify(result));
    if(result.captureSupported){
      if(!result.dspActive||!result.hrtfActive||!result.mutedDuringDsp||
        !result.restored||!result.fallbackObserved){
        throw new Error('Captured PCM DSP/HRTF browser routing or native fallback failed');
      }
      console.log('PASS Chromium real PCM EQ/compression, HRTF graph, source/seek native fallback');
    } else {
      throw new Error('Chrome fixture lacks media capture; cannot validate requested DSP/HRTF');
    }
  }finally{await browser.close();}
}
async function verifyWebKitFallback(){
  const browser=await webkit.launch({headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent('<!doctype html><video muted playsinline></video>');
    await page.addScriptTag({content:compiled.code});
    const result=await page.evaluate(async()=>{
      const video=document.querySelector('video');
      const states=[];
      const session=await window.CinemaV51.createCinemaSoundSession(video,state=>states.push(state));
      return {sessionCreated:Boolean(session),state:states.at(-1)};
    });
    if(result.sessionCreated||result.state?.output!=='native')
      throw new Error('WebKit muted content must never create an intrusive WebAudio session');
    console.log('PASS WebKit native audio preserved when audio capture is not authorized');
  }finally{await browser.close();}
}
await verifyChromium();
await verifyWebKitFallback();

/** Real encoded AAC fixture, not a mocked decoder or a real-device claim. */
async function verifyRealAac(){
  const {execFileSync}=await import('node:child_process');
  const {build}=await import('esbuild');
  const bytes=execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i',
    'sine=frequency=440:sample_rate=44100:duration=0.5','-ac','2','-c:a','aac','-b:a','128k','-f','adts','pipe:1']);
  const bundle=await build({entryPoints:['src/lib/cinema-v51-pcm.ts'],bundle:true,write:false,
    format:'iife',globalName:'CinemaPCM',platform:'browser'});
  const browser=await chromium.launch({...launchOptions,channel:'chrome'});
  try{
    const page=await browser.newPage();
    await page.route('https://cinema-test.invalid/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>AAC regression</title>'}));
    await page.goto('https://cinema-test.invalid/');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const evidence=await page.evaluate(async(raw)=>{
      const sha='a'.repeat(64),data=new Uint8Array(raw),frames=[],errors=[];
      const decoder=window.CinemaPCM.createCinemaAacDecoder(sha,f=>frames.push(f),e=>errors.push(e));
      const packet={sourceSha256:sha,ptsUs:1000000,data};
      const expected=window.CinemaPCM.cinemaDemuxAdts(packet).frames;
      try{await decoder.push(packet);await decoder.flush();}finally{decoder.stop();}
      if(errors.length||frames.length!==expected.length)throw new Error('AAC decode output count mismatch: '+errors.join(';'));
      let energy=0,count=0;
      frames.forEach((frame,i)=>{
        // Native WebCodecs may truncate fractional microseconds while ADTS
        // demux rounds them. Allow only one microsecond of quantization.
        if(!Number.isSafeInteger(frame.ptsUs)||Math.abs(frame.ptsUs-expected[i].ptsUs)>1||
          (i>0&&frame.ptsUs<=frames[i-1].ptsUs)||frame.sampleRate!==44100||frame.channels!==2||frame.frames!==1024)
          throw new Error('Unexpected AAC PCM format or PTS: '+JSON.stringify({index:i,actual:{ptsUs:frame.ptsUs,sampleRate:frame.sampleRate,channels:frame.channels,frames:frame.frames},expected:{ptsUs:expected[i].ptsUs,sampleRate:44100,channels:2,frames:1024}}));
        for(const plane of frame.planes)for(const sample of plane){
          if(!Number.isFinite(sample))throw new Error('Non-finite AAC PCM');
          energy+=sample*sample;count++;
        }
      });
      const rms=Math.sqrt(energy/count);
      if(!(rms>.005&&rms<.5))throw new Error('AAC PCM signal outside fixture bounds: '+rms);
      return {codec:'AAC-LC',decoder:'WebCodecs',frames:frames.length,sampleRate:44100,channels:2,rms,
        firstPtsUs:frames[0].ptsUs,lastPtsUs:frames.at(-1).ptsUs};
    },Array.from(bytes));
    console.log('Real encoded AAC PCM evidence:',JSON.stringify(evidence));
  }finally{await browser.close();}
}
await verifyRealAac();
