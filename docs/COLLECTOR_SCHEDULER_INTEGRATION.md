# Collector ↔ Crawler Scheduler 接入说明（功能分支）

分支：`feat/collector-crawler-scheduler-integration`
来源基线：`421581698/LibreTV` @ `7a44d02`（PR #96 / `feature/me-intelligent-collector-entry`）
本分支**不修改 main、不合并 PR、不部署生产**。

## 1. 做了什么

在既有两层结构之上补了一层**调度编排**，把 Collector 的任务链路串成闭环：

```
Resource Studio / 前端
  → POST /api/resource-collector/scheduler {action:'submit'}   提交 discover 任务
  → GET  /api/resource-collector/scheduler?action=status&jobId 查询持久化任务状态
  → GET  /api/resource-collector/scheduler?action=events&jobId 读取持久化事件流
  → POST /api/resource-collector/scheduler {action:'receive', jobId}
        → collectorRequest 读结果 → registerValidatedCmsSource 只做结构/公开性验证
        → 返回通过验证的候选源 → 浏览器 Zustand 去重 → addCustomApi → localStorage
```

新增/改动文件：
- `src/lib/collector-scheduler.ts` — 编排层（提交/状态/事件/结果接收与候选验证）
- `src/lib/collector-scheduler.test.ts` — 集成测试（全 mock，零真实采集）
- `src/app/api/resource-collector/scheduler/route.ts` — 编排 API 路由（含私域守卫；不写服务端 Zustand）
- `src/components/resource-studio/IntelligentCollectorPanel.tsx` — 发现任务 UI；在浏览器端去重并持久化有效源
- `.env.example` — 补充 `SCRAPLING_API_BASE` / `SCRAPLING_API_TOKEN` 说明

复用的现有组件（未改写）：
- `src/lib/resource-collector-client.ts` 的 `collectorRequest`：HTTPS-only、无查询参数、非 IP 字面量的 base 白名单；Bearer 仅服务端注入；拒绝重定向。
- `src/lib/resource-collector-workflow.ts` 的 `registerValidatedCmsSource`：仅接收 `cms-api-candidate`、要求 `cms_shape && reachable && access_state=PUBLIC`、对 `customAPIs + envSources` 去重后 `addCustomApi`。

## 2. 安全属性（已落实并测试）

| 要求 | 实现 |
|---|---|
| 地址与 Token 走安全环境变量 | `SCRAPLING_API_BASE` / `SCRAPLING_API_TOKEN` 仅服务端读取；未写死在代码；`.env.example` 仅占位符 |
| Token 不入库代码、不进日志 | 编排层不含任何 token 字面量；Bearer 由 `collectorRequest` 在 fetch 头注入；测试断言入库源不含 token |
| 任务提交/状态/事件/结果 | 全部经编排层，复用服务端 Bearer 代理 |
| 结果校验与本地入库 | 服务端 `ingestJobResult` 复用 `registerValidatedCmsSource` 做 CMS 结构/公开性校验；候选源返回浏览器后，再对当前 `customAPIs + envSources` 去重并调用 `addCustomApi` 写入 localStorage |
| SSRF 防护 | 沿用 `collectorRequest` 的 HTTPS/无 query/非 IP/无凭据 base 校验；入库侧沿用 `public_https_url` 与 CMS 结构校验 |
| 出口 fail-closed 不绕过 | 仅 `status ∈ {succeeded,completed,done}` 的任务结果可入库；fail-closed/dead-letter 任务 `considered=0`，直接跳过；编排层不新增任何 fetch，无法驱动未设门禁的采集端点 |
| 防护路由 | 新路由启用 `guardPrivateFeatureRequest` |

## 3. 测试结果

```
npx vitest run src/lib/collector-scheduler.test.ts \
  src/lib/resource-collector-client.test.ts \
  src/lib/resource-collector-workflow.test.ts
  → 3 files, 21 tests passed

npx vitest run（全量）
  → 95 files, 1081 tests passed

npx tsc --noEmit   → 通过
npx eslint（改动文件）→ 通过
```

集成测试全部使用 `vi.stubGlobal('fetch', mock)`，**不触发任何真实外部采集**；覆盖：提交参数与 Bearer 注入、状态/事件读取、非法 jobId 拒绝、成功任务的选择性入库、fail-closed 任务不入库、去重、结果接收闭环与 token 不泄漏。

## 4. 接入配置（部署时由运维注入，不在代码内）

```bash
# 必须是公网 HTTPS 源站（无查询参数、无路径、非 IP）
SCRAPLING_API_BASE=https://<your-collector-host>
SCRAPLING_API_TOKEN=<server-only-random-token>
```

> Token 通过安全密钥渠道交付，不写入前端、日志或 Git。Collector 侧出口门禁
> `SCRAPLING_EGRESS_FIREWALL_CONFIRMED` 保持在 Collector 服务端，前端/编排层不设置、不绕过；
> 未配置主机级出口防火墙时，采集类任务自然 fail-closed，符合预期。

## 5. 已知边界
- 本接入只编排**已存在**的 Collector API；不实现新的爬虫，也不打开真实采集。
- 自定义点播源属于浏览器用户数据；服务端只返回通过校验的候选，不尝试写服务端内存态 Zustand。用户需在 Resource Studio 点击「接收并保存有效源」，写入当前浏览器 localStorage。
- 真实第三方采集仍受 Collector 侧主机级出口防火墙门禁约束，需在受控环境验证后才能开启。
- E2B/沙盒地址为临时入口，非永久生产地址。
