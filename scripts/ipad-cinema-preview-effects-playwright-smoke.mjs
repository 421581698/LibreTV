#!/usr/bin/env node
/**
 * Real mounted Preview player E2E with clear browser-encoded video/audio.
 * Independently exercise three genuine enhancement buttons and startup overlays.
 * Synthetic source is DRM-free; physical Safari/HDR/speaker acceptance remains pending.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';

const require = createRequire(process.env.RUNNER_TEMP + '/ipad-audit/package.json');
const { chromium } = require('playwright');
const base = 'https://libretv-ipad-edition-preview.bggdbh.workers.dev';
const provider = 'https://preview.invalid/api.php/provide/vod';
const episodes = [
  'https://media.preview.invalid/fixture-0.webm',
  'https://media.preview.invalid/fixture-1.webm',
];
const sample = Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAI3EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggIh7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDNXQYxMYXZmNjEuNy4xMDNEiYhAn0AAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIFGPifZdEc9ecgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QdzWUA4JCwgRC6gRCagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYxLjcuMTAzc3PWY8CLY8WIFGPifZdEc9dnyKFFo4dFTkNPREVSRIeUTGF2YzYxLjE5LjEwMSBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAyLjAwMDAwMDAwMAAfQ7Z1+eeBAKOjgQAAgBACAJ0BKhAAEAAARwiFhYiZhIgCAgAMDWAA/v+rUICjmYEB9ACxAQABEBAAGAAwP/QMAAAA/v+rUICjmYED6ACxAQABEBAAGAAwP/QMAAAA/v+rUICjmYEF3ACxAQABEBAAGAAwP/QMAAAA/v+rUIAcU7trkbuPs4EAt4r3gQHxggGj8IED', 'base64');
const browser = await chromium.launch({ headless:true,args:['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({
  viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true,
});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let lookupCount = 0;
let notifySecondLookup;
const secondLookupStarted = new Promise(resolve => { notifySecondLookup = resolve; });
try {
  await page.route('**/api/status', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      passwordRequired: false, verified: true, version: 'ipad-cms-gate-fixture',
      defaultSources: [], defaultLiveSources: [], defaultSubscriptions: [],
      defaultRecommendSource: null, defaultImageMode: 'direct',
    }),
  }));
  await page.route('**/api/detail?*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      episodes,
      episodeItems: episodes.map((url, index) => ({
        title: '第 ' + (index + 1) + ' 集', url, duration: '00:02',
      })),
      videoInfo: {
        title: 'Cinema CMS 绑定测试', typeName: '电视剧',
        sourceKey: 'friday-cms', sourceName: 'Preview Fixture', sourceUrl: provider,
      },
    }),
  }));
  await page.route('**/api/dolby-vision/cms-binding?*', async route => {
    lookupCount++;
    const index = new URL(route.request().url()).searchParams.get('episodeIndex');
    if (index === '1') {
      notifySecondLookup();
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
    await route.fulfill({
      status: 404, contentType: 'application/json', body: '{"error":"unbound"}',
    }).catch(() => {});
  });
  await page.route('https://media.preview.invalid/**', route =>
    route.fulfill({ status: 200, contentType: 'video/webm', body: sample })
  );
  const params = new URLSearchParams({
    source: 'friday-cms', id: 'ipad-cms-gate-fixture', index: '0',
    title: 'Cinema CMS 绑定测试', sourceUrl: provider,
  });
  const response = await page.goto(base + '/ipad-edition/watch?' + params, {
    waitUntil: 'domcontentloaded', timeout: 60000,
  });
  if (!response?.ok()) throw new Error('Cinema route HTTP ' + response?.status());

  await page.locator('.netflix-player-frame video').waitFor({state:'attached',timeout:30000});
  // Record an actual, decodable colored video and audible oscillator into WebM.
  // Exercise the deployed player with actual browser decoding, never a mocked
  // DSP state callback or an animation-only testing hook.
  const clip=await page.evaluate(async()=>{
    const video=document.querySelector('.netflix-player-frame video');
    if(!video)throw Error('Cinema video missing');
    const mime='video/webm;codecs=vp8,opus';
    if(!MediaRecorder.isTypeSupported(mime))throw Error('VP8/Opus not available');
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas unavailable');
    const audioCtx=new AudioContext();await audioCtx.resume();
    const osc=audioCtx.createOscillator();const gain=audioCtx.createGain();
    gain.gain.value=.24;osc.frequency.value=440;
    const dest=audioCtx.createMediaStreamDestination();
    osc.connect(gain);gain.connect(dest);
    const stream=new MediaStream([...canvas.captureStream(25).getVideoTracks(),...dest.stream.getAudioTracks()]);
    const blocks=[];const recorder=new MediaRecorder(stream,{mimeType:mime});
    recorder.ondataavailable=e=>{if(e.data.size)blocks.push(e.data)};
    let frame=0;const paint=()=>{frame++;ctx.fillStyle=frame%30<15?'#f8b45a':'#145eae';ctx.fillRect(0,0,320,180);
      ctx.fillStyle='#ffffff';ctx.fillRect((frame*4)%280,55,36,55);};
    paint();const tick=setInterval(paint,40);osc.start();recorder.start();
    await new Promise((resolve,reject)=>{
      recorder.onerror=e=>reject(e.error||new Error('WebM fixture recording failed'));
      setTimeout(()=>{if(recorder.state!=='inactive')recorder.stop()},12500);
      recorder.onstop=resolve;
    });
    clearInterval(tick);osc.stop();stream.getTracks().forEach(t=>t.stop());await audioCtx.close();
    const blob=new Blob(blocks,{type:mime});if(blob.size<2000)throw Error('Invalid browser media fixture');
    const url=URL.createObjectURL(blob);
    video.pause();video.removeAttribute('src');video.src=url;video.loop=true;video.muted=false;video.volume=.6;
    await video.play();if(!video.videoWidth)await new Promise(resolve=>video.addEventListener('loadeddata',resolve,{once:true}));
    return {width:video.videoWidth,height:video.videoHeight,seconds:video.duration,bytes:blob.size,readyState:video.readyState};
  });
  if(clip.width<200||clip.seconds<9)throw Error('Browser fixture failed to decode: '+JSON.stringify(clip));
  const openAudio=page.getByRole('button',{name:'音频与字幕'});
  await openAudio.evaluate(button=>button.click());
  const panel=page.locator('.cinema-v4-dolby-panel');
  await panel.waitFor({state:'visible',timeout:10000});
  const cards=panel.locator('.cinema-v4-dolby-card');
  if(await cards.count()!==3)throw Error('Missing Cinema Vision/Audio/Spatial cards');
  await fs.mkdir('artifacts/ipad-visual-audit/cinema-effects',{recursive:true});
  const observations=[];
  const overlay=page.getByTestId('cinema-startup-animation');
  for(const [kind,card,title] of [
    ['vision',0,'CINEMA VISION'],['audio',1,'CINEMA AUDIO'],['spatial',2,'CINEMA SPATIAL']
  ]){
    await cards.nth(card).evaluate(button=>button.click());
    await overlay.waitFor({state:'visible',timeout:10000});
    const result=await overlay.evaluate(node=>{
      const host=node.closest('.relative.w-full.h-full');
      const video=host?.querySelector('video');
      const rect=node.getBoundingClientRect();
      return {kind:node.dataset.cinemaStartup,route:node.dataset.cinemaStartupRoute,
        text:node.textContent||'',pointerEvents:getComputedStyle(node).pointerEvents,
        visible:rect.width>0&&rect.height>0,
        canvasVisible:[...(host?.querySelectorAll('canvas[data-cinema-hdr-gpu]')||[])].some(el=>getComputedStyle(el).display!=='none'&&el.width>0&&el.height>0),
        videoMuted:video?.muted,videoWidth:video?.videoWidth,
      };
    });
    if(result.kind!==kind||result.route!=='enhanced'||!result.text.includes(title)||
       result.pointerEvents!=='none'||!result.visible)
      throw Error('Startup DOM does not confirm live processing: '+JSON.stringify(result));
    if(kind==='vision'&&!result.canvasVisible)
      throw Error('Vision startup without visible GPU video output');
    if(kind!=='vision'&&!result.videoMuted)
      throw Error('Audio startup without real PCM takeover/muted original audio');
    const active=await cards.nth(card).getAttribute('aria-pressed');
    if(active!=='true')throw Error('Cinema card not active after real processing: '+kind);
    await page.screenshot({path:'artifacts/ipad-visual-audit/cinema-effects/'+kind+'-active.png'});
    observations.push(result);
    await overlay.waitFor({state:'detached',timeout:6000});
  }
  await page.evaluate(()=>document.querySelector('.netflix-player-frame video')?.dispatchEvent(new Event('seeking')));
  await page.waitForTimeout(200);
  const restored=await page.locator('.netflix-player-frame video').evaluate(video=>!video.muted);
  if(!restored)throw Error('Cinema audio was not restored after stream seek');
  if(errors.length)throw Error('Preview had runtime exceptions: '+errors.join(' | '));
  await fs.writeFile('artifacts/ipad-visual-audit/cinema-effects/report.json',JSON.stringify({
    result:'PASS',mode:'Preview Chromium with browser-recorded clear VP8/Opus',
    media:clip,observations,nativeFallbackRestored:restored,
    dolbyLicensed:'NOT CLAIMED',physicalIpadSafari:'NOT TESTED',
    realCMSVideoSource:'NOT TESTED',physicalHdrOutput:'NOT TESTED'
  },null,2));
  console.log('PASS Preview E2E Cinema three live processing routes and startup overlays:',JSON.stringify({clip,observations,restored}));
} catch(error) {
  console.error(error instanceof Error?error.stack:String(error));
  process.exitCode=1;
} finally {
  await browser.close();
}
