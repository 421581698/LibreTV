import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const home = source('src/app/page.tsx');
const watch = source('src/app/watch/page.tsx');
const hero = source('src/components/friday/FridayHero.tsx');
const canvas = source('src/components/home/HomeIntentCanvas.tsx');
const orb = source('src/components/friday/FridayOrb.tsx');
const assistant = source('src/components/AIFloatingBall.tsx');
const spatialFridayEntry = source('src/components/spatial-os-v4/friday/SpatialFridayEntry.tsx');
const header = source('src/components/header.tsx');
const detail = source('src/components/detail-modal.tsx');
const player = source('src/components/player-shell.tsx');
const history = source('src/components/history-panel.tsx');
const settings = source('src/components/source-manager.tsx');
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
const chatSession = source('src/components/friday/useFridayChatSession.ts');
const fridayPanel = source('src/components/friday/FridayPanel.tsx');

describe('首页与播放页回归契约', () => {
  it('首页 FridayOrb 保持可见、可访问，并将点击交给唯一语音控制器', () => {
    expect(home).toContain('<HomeIntentCanvas');
    expect(home).toContain('{!isV2 ? (');
    expect(home).toContain('<SpatialAppShell');
    expect(home).toContain('fridayEntry={<SpatialFridayEntry />}');
    expect(home).toContain("activeSpace === 'cinematic' ? mainContent");
    expect(hero).toContain('<FridayOrb');
    expect(hero).toContain('friday-home-orb-toggle');
    expect(hero).toContain('aria-label={labels[voiceState]}');
    expect(orb).toContain('createFridayOrb(canvasRef.current');
    expect(orb).toContain('engine.destroy()');
    expect(assistant).toContain('window.addEventListener("friday-home-orb-toggle", handleHomeOrbToggle)');
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

  it('今日热门海报通过精确片名匹配打开原详情弹窗，不误开第一个结果', () => {
    expect(home).toContain('<HomeRecommendationSection');
    expect(home).toContain('onPick={openRecommendation}');
    expect(home).toContain('api.search(movie.title, selectedSources, yellowFilter)');
    expect(home).toContain('normalizeTitle(entry.name) === normalizedTitle');
    expect(home).toContain('setDetailItem(matched)');
    expect(home).toContain('不再用“第一个搜索结果”兜底');
    expect(home).toContain('<DetailModal item={detailItem}');
  });

  it('搜索与最近搜索历史保留 URL、输入校验和回选链路', () => {
    expect(home).toContain('<HomeSearchSection');
    expect(search).toContain('router.push(`/?q=${encodeURIComponent(query)}`');
    expect(search).toContain('searchHistory.record(query)');
    expect(search).toContain('const pickHistory = (text: string)');
    expect(search).toContain('runSearch(text)');
    expect(searchHistory).toContain('useQuery({');
    expect(searchHistory).toContain("queryKey: ['searchHistory']");
    expect(searchHistory).toContain('history.refetch()');
    expect(searchHistory).toContain('role="listbox"');
  });

  it('分类与筛选入口仍由设置抽屉的分组导航和点播源过滤器提供', () => {
    expect(settings).toContain("ariaLabel=\"设置分类\"");
    expect(settings).toContain("const PRIMARY_TABS");
    expect(settings).toContain("type VodFilter = 'all' | 'enabled' | 'disabled' | 'sub' | 'manual'");
    expect(settings).toContain('const VOD_FILTERS');
    expect(settings).toContain("current === 'vod' && <VodSourcesPanel />");
    expect(settings).toContain("current === 'live' && <LiveSourceManager />");
  });

  it('顶部设置、主题、直播、下载和历史入口保持连接', () => {
    expect(header).toContain("href=\"/live\"");
    expect(header).toContain('<ThemeToggle />');
    expect(header).toContain('观看历史');
    expect(header).toContain('requestShowDownloadManager');
    expect(header).toContain('设置');
    expect(header).toContain('<SourceManagerDrawer');
    expect(header).toContain('<HistoryPanel');
    expect(theme).toContain("localStorage.setItem(STORAGE_KEY, t)");
    expect(live).toContain('<Header');
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

  it('V4 Friday 入口订阅现有 reducer、Agent 阶段和音量事件，而不是维护第二套生命周期', () => {
    expect(assistant).toContain('friday-home-runtime-state');
    expect(assistant).toContain('machineState.voice');
    expect(assistant).toContain('machineState.agent');
    expect(assistant).toContain('friday-audio-level');
    expect(spatialFridayEntry).toContain("window.addEventListener('friday-home-runtime-state', onRuntimeState)");
    expect(spatialFridayEntry).toContain("window.addEventListener('friday-audio-level', onAudioLevel)");
    expect(spatialFridayEntry).toContain('getFridaySpatialVisualState');
    expect(spatialFridayEntry).toContain("detail: { agent: '");
  });

  it('设置中可选择界面语言、助手角色和语音风格，顶部搜索默认收起', () => {
    expect(settings).toContain("{ id: 'language', label: '语言设置' }");
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

});
