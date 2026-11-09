import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const home = source('src/app/page.tsx');
const v4Header = source('src/components/home/V4HomepageHeader.tsx');
const v4Content = source('src/components/home/V4HomepageContent.tsx');
const v4Styles = source('src/app/v4-homepage.css');
const watch = source('src/app/watch/page.tsx');
const hero = source('src/components/friday/FridayHero.tsx');
const canvas = source('src/components/home/HomeIntentCanvas.tsx');
const orb = source('src/components/friday/FridayOrb.tsx');
const assistant = source('src/components/AIFloatingBall.tsx');
const header = source('src/components/header.tsx');
const detail = source('src/components/detail-modal.tsx');
const player = source('src/components/player-shell.tsx');
const history = source('src/components/history-panel.tsx');
const settings = source('src/components/source-manager.tsx');
const drawer = source('src/components/drawer.tsx');
const theme = source('src/components/theme.tsx');
const live = source('src/app/live/page.tsx');
const downloads = source('src/components/download-manager.tsx');
const search = source('src/components/home/useHomeSearchController.ts');
const searchHistory = source('src/components/search-history.tsx');
const styles = source('src/components/friday/FridayStyles.tsx');
const fridayConversation = source('src/components/friday/FridayConversation.tsx');
const movieAgents = source('src/lib/friday/movie-agents.ts');
const movieWorkflow = source('src/lib/friday/movie-workflow.ts');
const voiceController = source('src/components/friday/useFridayVoiceController.ts');
const browserAsr = source('src/components/friday/browserAsr.ts');

const spatialScreen = source('src/components/home/V4SpatialScreen.tsx');
const channelStyles = source('src/app/eight-screen-glass.css');
const ipadStyles = source('src/app/ipad-glass.css');
const channelHeaderStyles = source('src/app/iphone-glass.css');
const homepageHeroStyles = source('src/app/v4-homepage.css');
const featuredHero = source('src/components/home/V4HomepageHero.tsx');
const previewConfig = source('wrangler.preview.toml');
const previewWorkflow = source('.github/workflows/deploy-homepage-preview.yml');
const rootLayout = source('src/app/layout.tsx');
const glassStyles = source('src/app/eight-screen-glass.css');
const sharedHeaderStyles = source('src/app/v4-shared-header.css');
const chatSession = source('src/components/friday/useFridayChatSession.ts');
const fridayPanel = source('src/components/friday/FridayPanel.tsx');

describe('首页与播放页回归契约', () => {
  it('首页 FridayOrb 保持可见、可访问，并将点击交给唯一语音控制器', () => {
    expect(home).toContain('<V4HomepageHeader overlay={!urlQuery} />');
    expect(v4Header).toContain('<AIFloatingBall showFab inlineMode={false} />');
    expect(assistant).toContain('onClick={openAndListen}');
    expect(assistant).toContain('startListening(false)');
    expect(orb).toContain('createFridayOrb(canvasRef.current');
    expect(orb).toContain('engine.destroy()');
  });

  it('首页圆球点击贯通唯一语音控制器，并覆盖识别错误、停止和卸载清理', () => {
    expect(assistant).toContain('window.addEventListener("friday-home-orb-toggle", handleHomeOrbToggle)');
    expect(assistant).toContain('startListening(false)');
    expect(assistant).toContain('stopRecognition(true)');
    expect(voiceController).toContain('getBrowserAsrConstructor()');
    expect(voiceController).toContain('recognition.onstart');
    expect(voiceController).toContain('recognition.onresult');
    expect(voiceController).toContain('recognition.onerror');
    expect(voiceController).toContain('recognition.onend');
    expect(voiceController).toContain('mountedRef.current = false');
    expect(voiceController).toContain('stopAllVoice');
  });

  it('真实 data-movies 结果进入五 Agent 工作流，停止与重试沿用同一运行时', () => {
    expect(chatSession).toContain('part.type !== "data-movies"');
    expect(chatSession).toContain('runLibreTVMovieWorkflow');
    expect(chatSession).toContain('replayFailed: true');
    expect(chatSession).toContain('controller.abort()');
    expect(movieWorkflow).toContain('agent: "playback-agent"');
  });

  it('刷新后可从 IndexedDB 任务记录显式恢复只读工作流，副作用任务不提供恢复按钮', () => {
    expect(chatSession).toContain('retryInterruptedWorkflow');
    expect(chatSession).toContain('taskIdPrefix');
    expect(chatSession).toContain('storedCandidates');
    expect(chatSession).toContain('fridayTaskEventStore.read');
    expect(chatSession).toContain('replayFailed: true');
    expect(fridayPanel).toContain('onRetryInterruptedTask');
    expect(fridayPanel).toContain('task.error?.code === "TASK_INTERRUPTED"');
    expect(fridayPanel).toContain('!task.sideEffect');
  });

  it('播放器以 videoHeight 作为真实解码画质，并与清单探测结果区分', () => {
    expect(player).toContain('const reportVideoHeight');
    expect(player).toContain('art.video?.videoHeight');
    expect(player).toContain("art.on('video:loadedmetadata', reportVideoHeight)");
    expect(player).toContain("art.on('video:canplay', reportVideoHeight)");
    expect(watch).toContain("from: 'play'");
    expect(fridayConversation).toContain('manifest/segment');
    expect(fridayConversation).toContain('videoHeight');
    expect(watch).toContain("friday-player-quality");
    expect(chatSession).toContain("friday-player-quality");
    expect(chatSession).toContain("decodedPlaybackHeightsRef");
    expect(fridayConversation).toContain("decodedVideoHeight");
    expect(fridayConversation).toContain("播放器解码实测");
  });

  it('V4 首页接入真实推荐接口与 IndexedDB 继续观看记录', () => {
    expect(home).toContain('<V4HomepageContent onPick={openRecommendation} />');
    expect(v4Content).toContain('<RecommendSection onPick={onPick} />');
    expect(v4Content).toContain('db.history.orderBy(\'timestamp\').reverse().limit(CONTINUE_LIMIT)');
    expect(v4Content).toContain('buildWatchUrl({');
    expect(v4Content).toContain('playbackPosition / item.duration');
    expect(v4Styles).toContain('.v4-history-row');
    expect(v4Styles).not.toContain('v4-poster-skeleton');
    expect(v4Styles).not.toContain('v4-landscape-skeleton');
    expect(home).toContain('<DetailModal item={detailItem}');
  });

  it('V4 首页 Header 使用双层动态导航，首屏叠加 Hero，滚动后转为轻量悬浮栏', () => {
    expect(home).toContain('<V4HomepageHeader overlay={!urlQuery} />');
    expect(v4Header).toContain('setIsScrolled(window.scrollY > 48)');
    expect(v4Header).toContain('is-overlay');
    expect(v4Header).toContain('is-scrolled');
    expect(v4Styles).toContain('.v4-home .v4-header.is-overlay');
    expect(v4Styles).toContain('.v4-home .v4-header.is-overlay.is-scrolled');
    expect(v4Styles).toContain('.v4-home-main--cinema > .v4-hero');
    for (const label of ['首页', '电影', '电视剧', '动漫', '综艺', '海外剧', '直播']) {
      expect(v4Header).toContain(`label: '${label}'`);
    }
    expect(v4Styles).toContain('.v4-nav-link.is-active');
  });


  it('首页与全部频道共用同一套顶部导航外观和响应式结构', () => {
    expect(rootLayout).toContain("import './v4-shared-header.css';");
    expect(rootLayout.indexOf("import './v4-shared-header.css';")).toBeGreaterThan(rootLayout.indexOf("import './v4-homepage.css';"));
    for (const selector of ['.v4-header,', '.v4-home .v4-header,', '.v4-spatial-screen > .v4-header']) {
      expect(sharedHeaderStyles).toContain(selector);
    }
    expect(sharedHeaderStyles).toContain('background: rgba(10, 10, 13, .84) !important;');
    expect(sharedHeaderStyles).toContain('.v4-home .v4-header-inner');
    expect(sharedHeaderStyles).toContain('.v4-spatial-screen .v4-header-inner');
    expect(sharedHeaderStyles).toContain('@media screen and (max-width: 700px)');
    expect(sharedHeaderStyles).not.toContain('background: rgba(246, 248, 251, 0.88)');
  });

  it('V4 Header 搜索与最近搜索历史保留 URL、输入校验和回选链路', () => {
    expect(home).toContain('<V4HomepageHeader overlay={!urlQuery} />');
    expect(v4Header).toContain('<SearchHistoryDropdown');
    expect(v4Header).toContain('router.push(`/?s=${encodeURIComponent(q)}`');
    expect(v4Header).toContain('searchHistory.record(q)');
    expect(v4Header).toContain('const pickHistory = (value: string)');
    expect(search).toContain('router.push(`/?q=${encodeURIComponent(query)}`');
    expect(searchHistory).toContain('useQuery({');
    expect(searchHistory).toContain("queryKey: ['searchHistory']");
    expect(searchHistory).toContain('history.refetch()');
    expect(searchHistory).toContain('role="listbox"');
  });

  it('设置首页采用 Apple 式纵向分组列表，分类进入独立详情页并可返回', () => {
    expect(settings).toContain('const SETTINGS_SECTIONS');
    expect(settings).toContain('rounded-2xl border border-line bg-card divide-y');
    expect(settings).toContain("setActivePage(item.id)");
    expect(settings).toContain("setActivePage('index')");
    expect(settings).toContain("activePage === 'appearance'");
    expect(settings).toContain("activePage === 'vod' && <VodSourcesPanel />");
    expect(settings).toContain("activePage === 'live' && <LiveSourceManager />");
    expect(settings).toContain("type VodFilter = 'all' | 'enabled' | 'disabled' | 'sub' | 'manual'");
    expect(settings).toContain('const VOD_FILTERS');
  });

  it('顶部设置、主题、直播、下载和历史入口保持连接', () => {
    expect(header).toContain("href=\"/live\"");
    expect(header).toContain('<ThemeToggle />');
    expect(header).toContain('观看历史');
    expect(header).toContain('requestShowDownloadManager');
    expect(header).toContain('设置');
    expect(header).toContain('<SourceManagerDrawer');
    expect(header).toContain('<HistoryPanel');
    expect(theme).toContain("function persistTheme(choice: ThemeChoice)");
    expect(theme).toContain("window.localStorage.setItem(STORAGE_KEY, choice)");
    expect(live).toContain('<V4HomepageHeader');
    expect(downloads).toContain("window.addEventListener(ADD_TASK_EVENT, onAdd)");
  });

  it('影片详情请求成功后通过标准 watch URL 进入播放页', () => {
    expect(detail).toContain('.detail(item.vodId, source, controller.signal)');
    expect(detail).toContain('.then((result) => {');
    expect(detail).toContain('buildWatchUrl({');
    expect(detail).toContain('router.push(');
    expect(detail).toContain('sourceUrl: item.sourceUrl');
  });

  it('播放页装载播放器、换源弹窗、进度恢复和下载入口', () => {
    expect(watch).toContain('dynamic(() => import(\'@/components/player-shell\')');
    expect(watch).toContain('<PlayerShell');
    expect(watch).toContain('<SwitchSourceModal');
    expect(watch).toContain('getRestorePosition={getRestorePosition}');
    expect(watch).toContain('onTimeUpdate={handleProgress}');
    expect(watch).toContain('enqueueDownload({');
    expect(watch).toContain('setSwitchOpen(true)');
  });

  it('换源会校验候选资源并切换到目标源的 watch URL', () => {
    const switchSource = source('src/components/switch-source.tsx');
    expect(switchSource).toContain('const switchTo = (c: Candidate)');
    expect(switchSource).toContain('if (!c.episodes)');
    expect(switchSource).toContain('buildWatchUrl({');
    expect(switchSource).toContain('sourceKey: c.source.key');
    expect(switchSource).toContain('router.push(');
  });

  it('点播播放器保留播放、进度、音量、全屏与 HLS 恢复配置', () => {
    expect(player).toContain('volume: 0.8');
    expect(player).toContain('fullscreen: true');
    expect(player).toContain('fullscreenWeb: true');
    expect(player).toContain('playbackRate: true');
    expect(player).toContain('art.on(\'video:ratechange\'');
    expect(player).toContain('art.on(\'video:loadedmetadata\'');
    expect(player).toContain('onTimeUpdate');
    expect(player).toContain('setupHls(video, mediaUrl, true)');
    expect(player).toContain('artRef.current.currentTime = saved');
    expect(player).toContain('artRef.current?.pause()');
  });

  it('播放页保留独立圆球入口，但不挂载会遮挡播放器的全局浮球', () => {
    expect(watch).toContain('AIFloatingBall');
    expect(watch).toContain('showFab={false}');
    expect(watch).toContain('FridayPlayerAssistantButton');
    expect(watch).toContain('friday-home-orb-toggle');
    expect(watch).not.toContain("from '@/components/header'");
    expect(styles).toContain('z-index: 2147483647');
    expect(styles).toContain('pointer-events: none');
  });

  it('观看历史可恢复播放，播放页提供明确的回首页与返回兜底', () => {
    expect(history).toContain('buildWatchUrl({');
    expect(history).toContain('const href = buildWatchUrl({');
    expect(history).toContain('href={href}');
    expect(watch).toContain('aria-label="回首页"');
    expect(watch).toContain('href="/"');
    expect(watch).toContain('router.back()');
    expect(watch).toContain("router.push('/')");
  });
  it('shows evidence-ranked playback recommendations and routes the exact candidate through the existing detail modal', () => {
    expect(movieWorkflow).toContain('playback: `${prefix}.playback`');
    expect(movieWorkflow).toContain('agent: "playback-agent"');
    expect(movieAgents).toContain('id: "playback-agent"');
    expect(movieAgents).toContain('"decoded-playback" as const');
    expect(movieAgents).toContain('"source-probe" as const');
    expect(movieAgents).toContain('assessmentEvidenceRank');
    expect(movieAgents).toContain('requiresUserConfirmation: true');
    expect(fridayConversation).toContain('workflow.playbackRecommendations');
    expect(fridayConversation).toContain('movies.find((item) => `${item.sourceKey}:${item.vodId}` === recommendation.candidateId)');
    expect(fridayConversation).toContain('onOpenMovie(movie)');
  });

  it('starts homepage voice recognition directly from the orb gesture without a wake-audio fetch', () => {
    expect(assistant).toContain('window.addEventListener("friday-home-orb-toggle", handleHomeOrbToggle)');
    expect(assistant).toContain('startListening(false)');
    expect(assistant).toContain('setVoiceSession(true)');
    expect(assistant).toContain('stopRecognition(true)');
    expect(assistant).not.toContain('homeWakeAudioRef');
    expect(assistant).not.toContain('homeWakeUrlRef');
  });


  it('V3 首页采用 Jarvis 式单圆球入口：回复与语音状态回到圆球，不挂载独立 AI 面板', () => {
    expect(header).toContain('<AIFloatingBall showFab={showFridayFab} inlineMode />');
    expect(watch).toContain('showFab={false} inlineMode');
    expect(assistant).toContain('if (inlineMode) {');
    expect(assistant).toContain('if (!showFab) return null;');
    expect(assistant).toContain('onClick={openAndListen}');
    expect(assistant).toContain('friday-home-assistant-response');
    expect(hero).toContain('friday-home-assistant-response');
    expect(hero).toContain('friday-orb-response');
    expect(hero).toContain('friday-home-orb-toggle');
  });

  it('首页圆球订阅真实语音状态和音量事件，而不是永久停留在默认空闲态', () => {
    expect(assistant).toContain('friday-home-voice-state');
    expect(assistant).toContain('friday-audio-level');
    expect(hero).toContain("window.addEventListener('friday-home-voice-state', onVoiceState)");
    expect(hero).toContain("window.addEventListener('friday-audio-level', onAudioLevel)");
    expect(hero).toContain('setRuntimeVoiceState(next[normalized])');
    expect(hero).toContain('setRuntimeAudioLevel(Math.max(0, Math.min(1, value)))');
    expect(canvas).toContain('voiceState, audioLevel');
  });

  it('设置中可选择界面语言、助手角色和语音风格，顶部搜索默认收起', () => {
    expect(settings).toContain("{ id: 'language', label: '语言设置', detail: '界面语言与显示偏好'");
    expect(settings).toContain('function LanguageSettingsPanel()');
    expect(settings).toContain('label="界面语言"');
    expect(settings).toContain('label="助手角色"');
    expect(settings).toContain('label="启用唤醒词确认"');
    expect(header).toContain('home-v2-mobile-search-toggle');
    expect(header).toContain('home-v2-header-search-slot');
    expect(header).toContain('is-open');
  });

  it('播放实测证据任务中断后可从独立 checkpoint 安全恢复', () => {
    expect(chatSession).toContain('taskId.endsWith(".playback-evidence")');
    expect(chatSession).toContain('createPlaybackEvidenceAgent()');
    expect(chatSession).toContain('replayFailed: true');
  });

  it('默认清晰度设置持久化并限制 HLS 自适应档位', () => {
    expect(settings).toContain('label="默认清晰度"');
    expect(settings).toContain('libretv-quality-preference');
    expect(player).toContain('applyHlsQualityPreference(hls)');
    expect(player).toContain('autoLevelCapping');
    expect(player).toContain('libretv-quality-preference-change');
  });

  it('Friday 语音识别语言设置实际写入浏览器 ASR 实例', () => {
    expect(settings).toContain('label="语音识别语言"');
    expect(settings).toContain('friday-asr-language');
    expect(voiceController).toContain('preferredRecognitionLanguage');
    expect(voiceController).toContain('recognition.lang = preferredRecognitionLanguage');
    expect(browserAsr).toContain('window.webkitSpeechRecognition');
  });

  it('iPad 品牌图标固定尺寸，设置按钮直接打开设置抽屉', () => {
    expect(glassStyles).toContain('.v4-brand-mark');
    expect(glassStyles).toContain('width: 24px !important');
    expect(v4Header).toContain('onClick={() => setSettingsOpen(true)}');
    expect(v4Header).not.toContain("else router.push('/settings')");
  });

  it('浅色、深色与系统主题均有显式选择，并提供浅色毛玻璃表面', () => {
    expect(theme).toContain("{ value: 'light', label: '浅色' }");
    expect(theme).toContain("{ value: 'dark', label: '深色' }");
    expect(theme).toContain("{ value: 'system', label: '跟随系统' }");
    expect(theme).toContain('function readStoredTheme()');
    expect(theme).toContain('media.addListener(onChange)');
    expect(theme).toContain('persistTheme(t)');
    expect(settings).toContain('浅色、深色与系统外观');
    expect(settings).toContain('<ThemeToggle />');
    expect(settings).toContain("activePage === 'appearance'");
    expect(settings).toContain('浅色、深色，或跟随设备系统设置');
    expect(glassStyles).toContain('html:not(.dark)');
    expect(glassStyles).toContain('linear-gradient(145deg,#f7f8fa 0%,#e9edf2 100%)');
  });


  it('V4 空间频道与首页共用根布局样式，客户端路由切换不会卸载频道 CSS', () => {
    expect(rootLayout).toContain("import './v4-homepage.css'");
    expect(home).not.toContain("import './v4-homepage.css'");
    expect(channelStyles).toContain('.v4-spatial-screen');
    expect(channelStyles).toContain('.v4-spatial-main');
    expect(homepageHeroStyles).toContain('.v4-header-inner');
    expect(spatialScreen).toContain('<V4HomepageHeader />');
  });

  it('电影与动漫频道不预留不存在的 Banner 空间，导航保持文档流并兼容 Safari', () => {
    expect(spatialScreen).toContain('<V4HomepageHeader />');
    expect(spatialScreen).toContain('<main className="v4-spatial-main">');
    expect(spatialScreen).not.toContain('<V4HomepageHero');
    expect(channelStyles).toContain('.v4-spatial-screen > .v4-header');
    expect(channelStyles).toContain('position: -webkit-sticky');
    expect(channelStyles).toContain('padding-block-start: clamp(20px, 2.5vw, 32px)');
    expect(channelStyles).toContain('@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))');
    expect(channelHeaderStyles).toContain('background: rgba(246, 248, 251, 0.88)');
    expect(channelHeaderStyles).toContain('background: rgba(35,45,60,.09)');
  });

  it('首页精选 Banner 始终使用渐变遮罩与白色文案，并保留无数据占位高度', () => {
    expect(featuredHero).toContain('<div className="v4-hero-veil"');
    expect(featuredHero).toContain('v4-hero-empty');
    expect(homepageHeroStyles).toContain('.v4-home .v4-hero-veil');
    expect(homepageHeroStyles).toContain('rgba(4, 8, 15, .94)');
    expect(homepageHeroStyles).toContain('-webkit-text-fill-color: #fff');
  });


  it('Preview 保持公开访问，功能分支推送后先通过检查再部署', () => {
    expect(previewConfig).toContain('AUTH_DISABLED = "true"');
    expect(previewWorkflow).toContain('workflow_dispatch:');
    expect(previewWorkflow).toContain('  push:');
    expect(previewWorkflow).toContain('feature/libretv-eight-screen-glass-2026-11-09');
    expect(previewWorkflow).toContain('run: npm test -- --reporter=dot');
    expect(previewWorkflow).toContain('Deploy isolated public preview Worker');
    expect(previewWorkflow).not.toContain('password protection');
  });

  it('设置页快捷入口会打开指定的真实设置面板', () => {
    expect(spatialScreen).toContain("localStorage.setItem('libretv-settings-open-page', page)");
    expect(spatialScreen).toContain("title: '外观模式', description: '浅色、深色与跟随系统主题', page: 'appearance'");
    expect(spatialScreen).toContain("title: '封面图加载', description: '海报图片代理与加载偏好', page: 'image'");
    expect(spatialScreen).toContain("title: '直播设置', description: '管理直播源与频道', page: 'live'");
    expect(spatialScreen).toContain("title: '资源订阅', description: '管理点播与直播资源订阅', page: 'subs'");
    expect(spatialScreen).toContain("title: '本机缓存', description: '查看和管理本机视频缓存', page: 'cache'");
    expect(settings).toContain("localStorage.getItem(SETTINGS_OPEN_PAGE_KEY)");
    expect(settings).toContain('setActivePage(nextPage)');
    expect(settings).toContain('removeItem(SETTINGS_OPEN_PAGE_KEY)');
  });

  it('移动端七项底部导航可横向滚动，不压缩或换行', () => {
    expect(channelStyles).toContain('.v4-mobile-tabs {');
    expect(channelStyles).toContain('overflow-x: auto !important');
    expect(channelStyles).toContain('white-space: nowrap');
    expect(channelStyles).toContain('flex: 0 0 auto !important');
  });

  it('页面允许用户缩放，避免移动端强制禁止放大', () => {
    expect(rootLayout).not.toContain('maximumScale: 1');
    expect(rootLayout).not.toContain('userScalable: false');
  });


  it('iPad 横屏资源页只对资源内容区应用双栏布局，不把页面标题塞进网格', () => {
    expect(spatialScreen).toContain('className="v4-resources-layout space-y-5"');
    expect(ipadStyles).toContain('.v4-spatial-screen[data-screen="resources"] .v4-resources-layout');
    expect(ipadStyles).not.toContain('.v4-spatial-screen[data-screen="resources"] .v4-spatial-main > div');
    expect(ipadStyles).toContain('.v4-spatial-screen[data-screen="movies"] .v4-spatial-panel > .grid.grid-cols-3');
    expect(ipadStyles.match(/\.v4-spatial-screen\[data-screen="movies"\] \.v4-spatial-panel > \.grid\.grid-cols-3/g)).toHaveLength(2);
  });


  it('无 vodId 的直连视频也能保存、恢复和清理播放进度', () => {
    expect(watch).toContain('const progressId = vodId || currentUrl');
    expect(watch).toContain('progressKeyOf(sourceKey, progressId, currentIndex)');
    expect(watch).toContain('saveProgress(\n        sourceKey,\n        progressId');
    expect(watch).toContain('clearProgress(sourceKey, progressId, currentIndex)');
  });


  it('精选轮播数据缩减时仍有有效选中项，加载失败可重试', () => {
    expect(featuredHero).toContain('activeSlide % slides.length');
    expect(featuredHero).toContain('aria-pressed={normalizedActiveSlide === index}');
    expect(featuredHero).toContain('featuredQuery.refetch()');
  });


  it('iOS Safari 模态抽屉锁定背景滚动并在关闭后恢复页面位置', () => {
    expect(drawer).toContain("body.style.position = 'fixed'");
    expect(drawer).toContain('body.style.top = `-${scrollY}px`');
    expect(drawer).toContain('window.scrollTo(0, scrollY)');
    expect(drawer).toContain('if (!mounted || !modal) return;');
  });


  it('紧凑桌面窗口宽度下 Header 三列布局不会挤出视口', () => {
    expect(homepageHeroStyles).toContain('@media screen and (min-width: 1101px) and (max-width: 1180px)');
    expect(homepageHeroStyles).toContain('grid-template-columns: minmax(150px, .7fr) auto minmax(300px, .9fr)');
  });
  it('iPad 13 英寸横屏宽视口仍命中平板专属布局', () => {
    expect(ipadStyles).toContain('max-width: 1440px');
    expect(ipadStyles).toContain('(any-pointer: coarse)');
    expect(ipadStyles).toContain('orientation: landscape');
    expect(rootLayout).toContain("import './ipad-glass.css'");
  });



  it('iPad 适配覆盖 1440px 宽屏触控设备，并分别定义横竖屏布局', () => {
    expect(ipadStyles).toContain('(min-width: 701px) and (max-width: 1440px) and (any-pointer: coarse)');
    expect(ipadStyles).toContain('(max-width: 1440px) and (any-pointer: coarse) and (orientation: portrait)');
    expect(ipadStyles).toContain('(min-width: 1024px) and (max-width: 1440px) and (any-pointer: coarse) and (orientation: landscape)');
    expect(rootLayout).toContain("width: 'device-width'");
    expect(rootLayout).not.toContain('maximumScale: 1');
  });

});
