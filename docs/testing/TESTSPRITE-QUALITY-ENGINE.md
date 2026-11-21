# LibreTV Quality Engine：TestSprite CLI 测试标准

> 状态：已批准的测试体系方案 / 待独立分支试点  
> 决策日期：2026-11-21  
> 默认原则：后续 LibreTV 功能测试以 TestSprite CLI 为 AI 端到端测试入口，并与 Playwright、单元/集成测试及真实 iPhone/iPad Safari 验收组合使用。

## 1. 目标

建立一套可持续积累测试用例、自动发现回归问题、保留失败证据并阻止不合格变更进入生产的统一质量体系，命名为 **LibreTV Quality Engine**。

质量引擎需要覆盖：
- PR 与独立 Preview 的自动化验收；
- 关键用户路径的端到端交互测试；
- 播放器、搜索、导航、资源与 Friday 等模块的回归；
- 测试失败时收集步骤、截图、日志、错误信息和可复现线索；
- 将失败诊断交给开发 Agent 辅助修复，再由原测试及回归套件重新验证；
- 将自动化结果与真实设备验收分开记录，避免把模拟器或云端浏览器结果误报为真机通过。

## 2. 工具职责与组合

| 工具 | 主要职责 | 不负责的事项 |
|---|---|---|
| **TestSprite CLI** | AI 辅助理解需求、生成/维护端到端测试计划、执行测试、整理失败证据与诊断 | 不作为唯一测试来源；不替代真实设备验收 |
| **Playwright** | 可重复、确定性的浏览器自动化；关键流程、断言、截图、trace 与回归脚本 | 不承担所有 AI 需求分析工作 |
| **Vitest / 现有单元测试** | 纯函数、状态机、组件逻辑、API/业务规则和边界条件 | 不替代完整用户旅程测试 |
| **集成/API 测试** | 服务接口、数据流、媒体资源、任务与模块间契约 | 不证明真实浏览器的音视频体验 |
| **真实 iPhone/iPad Safari** | WebKit、触控、安全区域、系统音视频解码、权限、前后台和设备特有行为 | 不由云端 Chromium 或桌面模拟结果代替 |

**组合原则：** TestSprite + Playwright + 单元/集成测试 + 真机 Safari。各层互补，不以单一工具取代已有测试。

## 3. 统一测试架构

```text
PR / Feature Branch / Preview
            |
            v
   LibreTV Quality Engine
            |
   +--------+---------+----------------+
   |                  |                |
   v                  v                v
TestSprite CLI    Playwright     Unit / Integration
AI E2E plans      deterministic  Vitest / API / media
   |                  |                |
   +------------------+----------------+
                      |
                      v
             Real-device acceptance
                 iPhone / iPad
                      |
                      v
              Unified quality report
   steps / assertions / screenshots / logs / traces
            root-cause hints / regression status
```

统一报告至少记录：提交 SHA、分支、Preview URL、测试工具及版本、浏览器/设备环境、测试用例、每步结果、失败截图/trace/日志、缺陷等级、复现步骤、修复提交和复测结果。

## 4. LibreTV 测试覆盖范围

### 4.1 Cinema / 播放器
- 页面与播放器挂载、视频元素和媒体源加载；
- 播放、暂停、继续、进度拖动、快进/快退；
- 控制栏显示/隐藏、点击区域、触控命中与状态同步；
- fMP4、HLS、MSE、编解码能力和首帧；
- 缓冲、卡顿、超时、切源、错误恢复和播放权交接；
- 字幕选择、加载、显示、同步及持久化（按功能实际启用情况）；
- 横竖屏、全屏、画中画及安全区域（按平台支持情况）。

### 4.2 iPhone / iPad 双线路
- 将 iPhone 线路和 iPad 线路作为独立验收目标，不假定两者 UI 或交互相同；
- 导航栏显示、布局断点、滚动、弹层、搜索、返回和手势；
- 播放界面按钮、控制栏、进度条、音量/亮度手势及触控反馈；
- iOS Safari 的自动播放限制、用户手势、权限、前后台切换；
- iPad 横屏/竖屏与多尺寸适配；
- 自动化测试可覆盖通用交互，设备独有行为必须安排真实设备验收。

### 4.3 搜索与内容
- 搜索输入、键盘提交、清空、取消、结果加载和错误状态；
- 推荐内容、海报、详情、播放源切换；
- 空态、加载态、弱网、超时和异常数据处理。

### 4.4 Friday 与语音
- 入口可见性、点击、打开/关闭、状态切换；
- IDLE / LISTENING / THINKING / SPEAKING 状态展示；
- ASR 开始/停止、权限拒绝、连续对话、打断和清理；
- TTS 播放、停止、语言选择与播放中断；
- 任务运行、事件记录、失败恢复及结果展示。
- 语音权限、WebKit 行为和真实麦克风/扬声器链路需真机验收。

### 4.5 液态玻璃与其他界面
- 组件可交互性、点击穿透、滚动、弹层层级；
- 明暗主题、响应式布局、性能退化和 reduced-motion；
- 管理台、资源采集等用户可见操作流程。

## 5. 标准工作流

1. **需求整理：** 明确用户路径、前置条件、预期结果、设备差异和风险等级。
2. **测试计划：** 使用 TestSprite 生成/更新 AI 测试计划；人工检查关键断言，禁止把模糊描述直接当作验收标准。
3. **确定性用例：** 将稳定、重复执行的关键路径沉淀为 Playwright 脚本；业务规则继续保留单元/集成测试。
4. **独立 Preview：** 仅对 Feature Branch / PR Preview 执行端到端测试，测试数据与环境必须隔离。
5. **自动执行：** 运行单元/集成、Playwright 和 TestSprite 测试，保存日志、截图、trace 和报告。
6. **失败诊断：** 区分产品缺陷、测试脚本缺陷、环境/网络问题、第三方资源问题；不把环境失败误报为产品通过。
7. **修复与复测：** Agent 可以提出或实施经授权的修复；必须重新运行失败用例、相关回归套件和必要的全量检查。
8. **真机验收：** 对 iPhone 与 iPad 分别执行设备清单，记录设备型号、iOS/iPadOS、Safari 版本、网络、操作步骤和证据。
9. **发布门禁：** CI 通过、Preview 验收通过、必要真机验收通过后，才进入人工批准的合并/发布流程。

## 6. CI 与 PR 门禁

建议 CI 检查分层：
- **Gate A — 静态与单元：** lint、typecheck、unit tests；
- **Gate B — 集成：** API、媒体管线、任务/数据契约测试；
- **Gate C — 浏览器确定性回归：** Playwright；
- **Gate D — AI 端到端：** TestSprite CLI；
- **Gate E — 设备验收：** iPhone/iPad Safari，按变更风险要求执行并单独签署结果。

阻断规则：
- 必需 Gate 失败则 PR 不得视为通过；
- TestSprite 生成的测试必须经过审阅，避免不稳定或错误断言成为阻断条件；
- 外部服务不可用时标记为 blocked/environment failure，不得伪装成 success；
- 真机未执行时明确标注“未验收”，不可用桌面模拟或云端浏览器替代；
- 不允许自动批准 PR、自动合并或自动部署生产。

## 7. TestSprite CLI 试点与操作

先在独立 Feature Branch / Preview 做兼容性审计和试点，不立即改变所有现有 CI。

开发环境安装（官方 CLI 当前要求 Node.js 20.19+、22.13+ 或 24+）：

```bash
npm install -g @testsprite/testsprite-cli
testsprite --version
testsprite setup
testsprite doctor
testsprite auth status
```

首次建立 LibreTV 前端项目（只在尚无对应项目时执行）：

```bash
testsprite project create --type frontend --name "LibreTV"
# 将返回的项目 ID 保存为 TESTSPRITE_PROJECT_ID
testsprite project env create "$TESTSPRITE_PROJECT_ID" --name default --url "https://<verified-preview-or-staging-url>"
```

当前 CLI 0.17 的计划与执行流程：

```bash
# 让 AI 提出覆盖计划，先审阅步骤
testsprite plan "Verify LibreTV homepage, search entry, navigation and primary user journeys" --project "$TESTSPRITE_PROJECT_ID" --steps

# 审阅建议后应用（会将通过审阅的用例写入项目）
testsprite apply --output json

# 查看现有测试并运行整个项目套件
testsprite test list --project "$TESTSPRITE_PROJECT_ID"
testsprite run --project "$TESTSPRITE_PROJECT_ID" --wait

# 获取失败详情和证据
testsprite result get <RESULT_ID> --out ".testsprite/results/<RESULT_ID>"
```

GitHub Actions 使用官方 CI 门禁命令：

```bash
testsprite ci run \
  --project "$TESTSPRITE_PROJECT_ID" \
  --wait-for-status "$TESTSPRITE_PREVIEW_STATUS_NAME" \
  --target-url-template "$TESTSPRITE_PREVIEW_URL_TEMPLATE" \
  --fail-on-skipped \
  --summary-file testsprite-summary.json
```

仓库变量与密钥：
- Repository variable `TESTSPRITE_PROJECT_ID`：TestSprite 项目 ID；
- Repository variable `TESTSPRITE_PREVIEW_URL_TEMPLATE`：PR Preview URL 模板，使用 `{pr}`、`{pr-number}`、`{branch-slug}`、`{sha}` 或 `{short-sha}` 占位符；
- Repository secret `TESTSPRITE_API_KEY`：TestSprite API Key，只能放在 GitHub Secrets。

当前工作流在 `TESTSPRITE_PROJECT_ID` 与 `TESTSPRITE_PREVIEW_URL_TEMPLATE` 齐备且 PR 非 Draft 时启动 TestSprite 云端门禁；先轮询对应 PR Preview 的 HTTP 可达性，再启动 `testsprite ci run`。缺少配置时会明确报告“未配置/未运行”，不会将其伪装成通过。TestSprite 项目还必须有可用的默认环境和至少一条已应用的测试用例。CLI 0.17 的命令和选项以官方文档为准。

凭据要求：
- API Key 只存储在本地安全环境或 GitHub Actions Secrets；
- 不写入仓库、日志、测试报告或截图；
- CI 仅授予完成测试所需的最小权限；
- 不在生产环境执行破坏性测试或使用真实用户数据；
- 在接入前确认 TestSprite 当前套餐、用量、数据处理和隐私条款符合项目要求。

## 8. 分阶段落地

### Phase 0 — 兼容性审计
- 检查项目 Node.js、包管理器、现有 Playwright/Vitest 配置和 GitHub Actions；
- 核对 TestSprite CLI 当前版本、命令、认证、额度和 CI 支持；
- 明确 Preview URL 注入、测试账号/数据、报告保留方式；
- 不修改 main，不部署生产。

### Phase 1 — Cinema V2.3 试点
优先覆盖播放入口、首帧、播放/暂停、控制栏、seek、切源、错误恢复、搜索到播放的主链路。对 iPhone 与 iPad 的差异用独立用例表达。

### Phase 2 — 扩展关键用户路径
扩展搜索、导航、详情、推荐、Friday、液态玻璃和资源管理界面；把稳定用例固化为 Playwright 回归套件。

### Phase 3 — 统一质量门禁
接入 PR Preview 自动触发、失败证据归档、质量报告和门禁；为真机验收保留独立状态与人工签署。

### Phase 4 — 持续维护
按缺陷与功能变更更新用例；定期清理 flaky tests；记录测试覆盖与逃逸缺陷；每次工具升级先在试点分支验证。

## 9. 安全与项目边界

- 默认所有改动在独立 Feature Branch 和 Preview 中进行；
- **main 与生产环境保持不变**，除非用户明确授权；
- 不自动合并 PR、不自动批准、不自动发布生产；
- 不将密钥、个人数据、真实账号或敏感媒体地址发送给未经批准的外部测试服务；
- 测试环境使用合成数据、专用账号和最小权限；
- 对第三方媒体源的测试遵守访问限制、速率限制和服务条款；
- 保留现有可重复测试，不因引入 TestSprite 而删除 Playwright、Vitest 或真机验收。

## 10. 默认执行政策（后续测试）

从本方案批准起，LibreTV 后续测试默认遵循：
1. 新增/修改用户可见功能时，评估并优先补充 TestSprite 端到端测试；
2. 稳定关键路径同步保留 Playwright 确定性回归；
3. 业务逻辑与状态机继续使用单元/集成测试；
4. 涉及 iOS/iPadOS、媒体解码、触控、语音权限等设备行为时，单独安排真实 iPhone/iPad Safari 验收；
5. 报告必须区分自动化通过、真机通过、未执行和环境阻塞；
6. 不因 TestSprite 接入而改变 main/生产发布授权边界。

## 11. 官方资源

- GitHub：<https://github.com/TestSprite/testsprite-cli>
- 官方网站：<https://www.testsprite.com/>
- CLI 文档：<https://github.com/TestSprite/testsprite-cli/blob/main/DOCUMENTATION.md>

> 本文是 LibreTV 的测试策略与落地规范，不代表 TestSprite 已经安装、已接入 CI 或已完成真机验收。上述状态必须以实际试点结果为准。

## 12. 当前仓库接入状态（2026-11-21）

本分支已增加以下基础设施：
- `.github/workflows/quality-engine.yml`：PR 质量工作流，执行 lint、typecheck、Vitest、生产构建和 Chromium 浏览器 smoke，并上传证据；
- `scripts/quality-engine-smoke.mjs`：桌面 Chromium 与 iPhone/iPad 尺寸视口模拟测试，记录页面错误、HTTP 状态和截图；
- `quality-engine/device-registry.json`：真实设备兼容性登记表，初始为空，等待人工真机验收记录；
- `npm run quality:verify` 与 `npm run quality:smoke`：统一入口；
- `.gitignore`：忽略本地 TestSprite 与质量测试产物。

**明确的验收边界：** Chromium 移动视口只属于响应式模拟测试，不代表 iPhone/iPad Safari 真机通过。真实设备登记表只有在人工提供设备型号、系统/浏览器版本、提交 SHA、Preview 地址、测试步骤和证据后才可增加通过记录。TestSprite 云端门禁需要用户在 GitHub 仓库配置上述变量和 API Key；没有这些凭据时不会启动真实云端测试。

**当前状态不是最终验收通过：** 工作流提交后仍需等待 GitHub Actions 执行，并处理实际出现的失败；本会话无法代替物理 iPhone/iPad 操作或设置用户的 TestSprite API Key。
