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
