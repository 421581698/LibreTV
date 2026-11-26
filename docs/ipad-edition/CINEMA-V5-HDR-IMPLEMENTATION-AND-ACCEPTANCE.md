# Cinema Vision V5 — HDR 技术实现与验收契约（PR #99）

本批次仅修改 PR #99 产品分支。**不改变现有三张卡片的布局与视觉样式**；不修改 main，不合并，不部署生产。原生 Dolby/HDR、软件画质增强、浏览器能力声明及设备真实输出必须严格分开。

## 13 项功能覆盖与真实边界

| # | 项目 | 当前代码实现 / 路径 | 仍需验证或尚未实现 |
|---|---|---|---|
| 1 | HDR10 | HLS PQ + 编码声明的 Safari 原生 HLS 候选路径 | PQ 不能单独证明 HDR10；真实 HDR 输出需要设备实测 |
| 2 | HDR10+ | 原始 HDR HLS 流保留给 Safari 原生解码，不丢弃动态元数据 | ST 2094-40 / T.35 动态元数据尚未独立验证；不得显示“已解码 HDR10+” |
| 3 | HLG | HLS VIDEO-RANGE=HLG 与 AV1 CICP=18 的标识和原生候选 | HLG 屏幕真实亮度和转换结果仍需真机 |
| 4 | Dolby Vision | 继续使用已有可信 Dolby codec / RPU 证据及 Safari 原生路由 | 仅有声明/RPU 不等于 Dolby Vision 实际输出 |
| 5 | SDR → HDR | WebGPU → WebGL 的自主 SDR 动态画质增强，真处理帧后启用 | **不生成 PQ/HLG 信号，不是原生 HDR 升级**；真实 SDR→HDR 显示输出尚未实现 |
| 6 | HDR → SDR | 依赖系统原生 HDR 内容播放时的色彩管理及 SDR 显示兼容路径 | 尚无独立逐帧 PQ/HLG→SDR 转换器；不可将系统兼容性冒称自行实现 |
| 7 | Dynamic Tone Mapping | SDR GPU shader 逐帧四点亮度估计、曝光/阴影/高光曲线 | 非认证动态 HDR tone mapping；需实源画面主观和客观对比 |
| 8 | Wide Color Gamut | AV1 CICP 的 BT.2020/P3 检测；WebGPU 优先尝试 Display-P3 画布；显示色域提示 | BT.2020 输出、不同浏览器的色彩空间转换需设备测量 |
| 9 | 10-bit Processing | AV1 位深声明、HEVC Main10 profile 能力识别；GPU 浮点 shader 处理中间值 | 上传的浏览器纹理及实际画布位深不保证 10-bit；原生 10-bit 输出尚未证明 |
| 10 | Adaptive Contrast | SDR shader 亮度自适应、局部曲线增强 | 需实测暗/亮场伪影及帧时间 |
| 11 | Highlight Recovery | SDR 高光曲线优化，降低可见高光过曝倾向 | 不能恢复源片已裁剪丢失的高光细节 |
| 12 | Shadow Enhancement | SDR shadow lift 与对比调整 | 需验证色阶断层/噪点放大 |
| 13 | GPU Acceleration | 优先 WebGPU；初始化不可用回退 WebGL2 / WebGL1；动态分辨率与限帧 | iPad Safari 设备与具体视频源兼容性未验收 |

## 代码入口

- `src/lib/cinema-hdr.ts`：HLS 变体、AV1 CICP、HDR 分类、Safari 原生候选、色域能力提示。
- `src/lib/cinema-hdr-gpu.ts`：WebGL SDR shader、逐帧亮度/色彩处理、性能限幅和失败恢复。
- `src/lib/cinema-hdr-webgpu.ts`：WebGPU 外部视频纹理绘制、Display-P3 画布尝试、WebGL 降级。
- `src/lib/cinema-hdr-geometry.ts`：cover/contain/scale-down 几何校正。
- `src/components/player-shell.tsx`：原播放器 HLS 路由、原有画质卡片接入、帧进展确认。
- `src/lib/cinema-hdr*.test.ts`：格式识别、能力边界与画面比例回归。

## 技术保护要求

1. **HDR 原生路径第一原则**：已知 PQ/HLG/Dolby 片源不强制经过 SDR Canvas，避免动态范围损失；原生 HDR 解码失败可回退既有 hls.js 路径。
2. **不伪造能力**：`VIDEO-RANGE=PQ`、`canPlayType()`、`matchMedia('(dynamic-range: high)')`、AV1 Main10 profile 都不是实际 HDR10+/Dolby/HDR 10-bit 输出证据。
3. **受保护/CORS 视频**：若 GPU 无权读取当前视频帧，立即撤下画布并保留原始播放，不关闭音轨或字幕。
4. **画面比例**：WebGL/WebGPU 画布使用源视频的 contain / cover 裁切参数，不能挤压画面；字幕激活时暂停覆盖以保护字幕可见性。
5. **性能保护**：画布最多约 30 FPS，输入源按不超过 1280 像素长边处理，持续慢帧再降为 960/640。
6. **交互边界**：不调整原有三卡视觉、尺寸、顺序、文案；卡片金色表示媒体处理成功或原生路径观察到实际视频帧，**不等于 Dolby/10-bit/HDR 硬件输出认证**。
7. **测试**：TypeScript、ESLint、Vitest、HLS Browser/External Smoke、Resource Playback、Preview 视觉回归及真实 iPad Safari。没有真机测量结果前真实 HDR/Dolby 输出都标记“未验证”。

## 真实设备验收（仍待执行）

使用已授权的 SDR、HDR10、HLG、HDR10+、Dolby Vision、AV1 Main10 / P3 视频素材，分别在 HDR iPad 屏幕、普通 SDR 屏幕、外接显示器等组合进行：

- 播放画质的亮度/色域/高光对比、是否出现双重 tone mapping 或色偏；
- 视频暂停、seek、切源、转屏、分屏、全屏、字幕与音轨切换后实际效果；
- 电量、GPU 压力、帧率、发热、长播放的内存和故障恢复；
- HDR10+ 动态元数据路径、Dolby Vision 的硬件输出需可信设备证据，不以 UI 或 CI 替代。

**结论：当前代码包含 HDR 路由与 SDR GPU 增强的工作实现，但 13 项“全部真实 HDR 输出通过验收”不能据此宣称完成。**
