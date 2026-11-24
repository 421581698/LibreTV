# Cinema Engine P0 — 播放器接入分析（PR #99）

> 状态：分析与设计方案，**尚未修改任何播放代码**。目标是把已写入的四个 P0 模块
> 接到真实播放链路。第一阶段严格只读诊断：不自动切源、不自动降画质、不重启播放器。
> 边界：不新建分支、不改 main、不合并、不部署生产。继续在
> `feature/libretv-ipad-edition-product` 上进行。

## 1. 已核实的现有播放架构（事实）

核对基准：分支 `feature/libretv-ipad-edition-product`，HEAD `3713401`。

### 1.1 主播放链路

- **主播放器** `src/components/player-shell.tsx`（1882 行）：ArtPlayer + hls.js，
  唯一持有 `hlsRef: useRef<Hls | null>`（L216），HLS 实例在 `setupHls()` 中创建
  （L712 `new Hls(buildHlsConfig())`）并 `loadSource` / `attachMedia`（L793-794）。
- **页面层** `src/app/watch/page.tsx` 渲染 `PlayerShell`；
  `src/app/ipad-edition/watch/page.tsx` 只有 8 行，**直接复用 `WatchPage`**，
  因此 iPad Edition 与主站共用同一条播放与遥测链路，无需单独接线。
- **直播播放器** `src/components/live-player.tsx` 有独立的 `new Hls`（L164），
  本次 P0 范围先不覆盖直播路径。
- **原生 HLS 分支**：当 `!hls`（iOS Safari 无 MSE）时走 `video.src = mediaUrl`
  原生播放（L785-792），此分支没有 hls.js 事件，是可读诊断必须覆盖的另一条路径。

### 1.2 现成的遥测出口（关键）

- `PlayerShellProps.onPlaybackSample?: (sample: PlaybackSample) => void`（L167）。
- 仅在 `watch/page.tsx:915` 接线到
  `useAppStore.getState().recordPlaybackSample(sample)`。
- `flushPlaybackMetrics()`（L323-345）在换集 / ended / 卸载时上报，
  字段含 `startupMs / throughputKbps / mediaBitrateKbps / selectedRendition* /
  height / stalls / fatalErrors / recoveries / playedSeconds`。
- 结论：**已有一条贯通播放器 → 页面 → store 的只读遥测通道**，
  新模块的结果应作为同一通道的扩展字段上报，而不是另建通道。

### 1.3 现有的卡顿与缓冲观测

- `art.on('video:waiting')`（L1405）：`metrics.stalls += 1`，并已有一个
  **12 秒后主动调用 `onRequestSwitchSource('视频持续缓冲超过 12 秒')`** 的逻辑
  （L1409-1423）。
- `art.on('video:playing')`（L1427）、`video:timeupdate`（L1323）、
  `video:error`（L1297）、`FRAG_LOADED`（L810）、`FRAG_BUFFERED`（L888）等事件齐备。
- `video:waiting` 只统计次数，没有基于 `buffered` / `readyState` / `networkState`
  的结构化健康度判定，也没有掉帧数据。

### 1.4 音轨现状（重要缺口）

- 对 `player-shell.tsx` 全文检索 `audioTracks / audio track / 音轨 / audioTrackList`
  **无任何命中**。
- hls.js 事件监听里没有 `AUDIO_TRACKS_UPDATED`，播放器当前不读取实际音轨列表。
- 因此 `audio-inspector` 若要接真实音轨，必须新增 hls.js 的 audio track 事件接入；
  这属于**新增能力**，不是替换现有实现，不存在重复开发。

### 1.5 四个 P0 模块的导出接口（已核实）

| 模块 | 主要导出 | 输入 |
| --- | --- | --- |
| `format-detector.ts` | `detectMediaFormat(input: MediaFormatInput): MediaFormatReport` | `url / mimeType / codecs / hlsChannels / audioCodec` |
| `audio-inspector.ts` | `inspectHlsAudioTrack(track: HlsAudioTrackLike)`、`parseHlsAudioRenditions(manifest)` | hls.js audio track 对象或 m3u8 文本 |
| `capability-manager.ts` | `inspectAudioCapabilities(env)`、`assessCodecCapability(...)` | UA、`canPlayType`、AudioContext / MSE / MediaCapabilities 可用性 |
| `playback-stability.ts` | `evaluatePlaybackHealth(metrics, policy)`、`getBufferedAheadSeconds(...)`、`getPlaybackRetryDelayMs(...)` | `nowMs / lastProgressAtMs / bufferedAheadSeconds / readyState / networkState / online / paused / ended / droppedFrames` |

## 2. 各模块的具体接入位置（方案建议，非已实施）

### 2.1 format-detector — 在哪识别容器 / 编码 / 杜比

- **位置**：`setupHls(video, mediaUrl, allowProxyFallback)` 入口处（L~690 之前），
  以及原生 HLS 分支（L785）同样调用一次，保证两条路径都覆盖。
- **输入来源**：`mediaUrl`（url）、`propsRef.current.mediaType`（已知格式提示）、
  hls.js `MANIFEST_PARSED` 后可读 `hls.audioTracks` 的 `audioCodec`，
  HLS `CHANNELS` 声明可从 manifest 解析或 audio track 的 `channels` 取得。
- **接入方式**：纯函数调用得到 `MediaFormatReport`，结果存 ref、
  通过扩展 `onPlaybackSample` 的字段上报；`notes` 供诊断面板只读展示。
- **不做什么**：不切换播放路径、不选源、不因为 `dolbyFamily` 显示 Atmos 标志。

### 2.2 audio-inspector — 如何读取真实音轨 / 声道

- **位置**：`MANIFEST_PARSED` 处理器（L796）内新增
  `hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, ...)` 与 `AUDIO_TRACK_SWITCHED`。
- **输入来源**：hls.js `hls.audioTracks: AudioTrack[]`，其 `id / name / groupId /
  channels / audioCodec / default / autoselect` 与 `HlsAudioTrackLike` 字段对应。
- **接入方式**：每条音轨调用 `inspectHlsAudioTrack()`，得到 `channelCount / layout /
  codec / hasJocMarker`，存 ref 并随遥测上报。原生 HLS 路径无法读取 hls.js 音轨，
  明确记为 unknown，绝不臆测。
- **不做什么**：不自动切换音轨；`layout === 'unknown'` 时如实上报，不标成 5.1。

### 2.3 capability-manager — 如何识别 iPhone / iPad / Safari 能力

- **位置**：播放器挂载 `useEffect`（L1002）创建时调用一次，结果存 ref。
- **输入来源**：`navigator.userAgent`、
  `typeof AudioContext !== 'undefined'`、
  `MediaSource.isTypeSupported`、
  `navigator.mediaCapabilities?.decodingInfo`、
  `HTMLMediaElement.prototype.canPlayType`。
- **接入方式**：`inspectAudioCapabilities(env)` 得 `AudioCapabilityProfile`；
  对 detected codec 调 `assessCodecCapability()` 得 `CodecCapabilityAssessment`。
- **必须守住的事实**：`nativeDolbyDecode` 与 `bitstreamPassthrough` 恒为
  `'unknown'`，`safeDefault` 恒为 `'native-media-playback'`。
  即使 Safari `canPlayType('audio/ec-3')` 返回非空，也只能记为
  `can-play-hint`，**不能据此宣称原生 Atmos 解码**。

### 2.4 playback-stability — 如何监测缓冲 / 卡顿 / 掉帧 / 网络

- **位置**：在 `video:waiting` / `video:playing` / `video:timeupdate` /
  `FRAG_BUFFERED` 事件里采集数据，用一个轻量定时器（如每 1s）
  调用 `evaluatePlaybackHealth(metrics, policy)`。
- **输入来源**：
  - `bufferedAheadSeconds`：`getBufferedAheadSeconds(video.buffered, video.currentTime)`；
  - `lastProgressAtMs`：`video:timeupdate` 里 `currentTime` 有进展时更新时间戳；
  - `readyState / networkState / paused / ended`：直接读 video 元素；
  - `online`：`navigator.onLine`；
  - `droppedFrames / totalFrames`：WebCodecs 不可用时明确传 null，
    不以 0 冒充"无掉帧"。
- **接入方式**：`PlaybackStabilityReport` 存 ref，随 `flushPlaybackMetrics`
  上报 health / stallDurationMs / droppedFrameRatio / recommendations。
- **第一阶段红线**：`shouldShowBuffering` 仅供 UI 只读提示；
  **`shouldOfferRetry` 不得触发任何自动动作**。

### 2.5 与现有 12 秒自动切源逻辑的关系（需决策）

现有 `video:waiting` 里的 12 秒 `onRequestSwitchSource` 是**既有行为**，
不属于本次新增。第一阶段"不自动切源"有两种解释：

- **A（推荐，最小变更）**：本次接入不触碰该既有逻辑，
  新模块只做只读诊断并上报；既有 12 秒切源保持原样。
  需要在 PR 评论里说明"第一阶段的只读约束仅指新增模块"。
- **B（严格解释）**：若要求播放器整体第一阶段无自动切源，
  则需对该既有逻辑加 feature flag 或改为只上报不调用，
  这属于改变既有行为，风险更高，需单独确认。

本方案默认 A；若你选 B，我会单独出一个变更点清单再动手。

## 3. "测试正常" ≠ "接入真实链路" 的验证计划

你特别强调的这一点，落到可执行的验收项：

| 验证项 | 方法 | 通过的判据 |
| --- | --- | --- |
| 真实 HLS 音轨被读取 | Preview 上播放一条含多 audio rendition 的 m3u8，检查遥测样本 | `audioTracks` 非空且 `layout/codec` 来自 track 真实字段，不是 fixture |
| 格式识别来自真实 URL / manifest | 用真实流 URL，核对 `container / audioCodec / hasJocMarker` | 与 m3u8 声明一致；JOC 仅提示不误报 Atmos |
| Safari 能力识别 | iPhone / iPad Safari 打开 Preview，检查 profile | `browserFamily='safari'`，`nativeDolbyDecode='unknown'` |
| 稳定性监测来自真实事件 | 人为限速制造 buffering，检查 `stallDurationMs / health` | health 随真实 `buffered/readyState` 变化，非固定值 |
| 遥测确实流出播放器 | 在 store / 日志里看到新字段 | `onPlaybackSample` 样本包含新字段且 sourceKey/resourceKey 正确 |
| 只读约束 | 复现缓冲 / 解码失败 | 新模块不触发切源 / 降档 / 重启（既有 12s 逻辑按决策 A 保留） |

CI / 单元测试只能保证模块逻辑正确；上述项必须在真实播放链路和真机上完成，
不能用测试代替。

## 4. 建议的落地顺序（每次一个可回滚提交）

1. 扩展 `PlaybackSample` 类型与 store 字段，先让"数据出口"就位（纯类型 + 透传）。
2. `format-detector` + `capability-manager` 接入 `setupHls` / 挂载点（只读上报）。
3. `audio-inspector` 接入 `AUDIO_TRACKS_UPDATED`（只读上报）。
4. `playback-stability` 接入事件采集 + 定时评估（只读上报，不接 UI 自动动作）。
5. 逐提交跑 Vitest / TypeScript / ESLint / 生产构建，逐提交上 Preview 人工核对遥测字段。

每一步都不改 main、不合并、不部署生产；保持 PR #99 Draft。

## 5. 本方案未做的事

- 未修改任何播放器源码；`player-shell.tsx` 与 `watch/page.tsx` 保持原样。
- 未接入 OpenJOC / WASM / HRTF（P2 范围）。
- 未宣称任何原生 Atmos 解码或位流直通能力。
- 未触碰 Cloudflare 红项（独立问题，等 Dashboard 日志）。
