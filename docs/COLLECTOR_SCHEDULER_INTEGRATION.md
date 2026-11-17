# Collector ↔ Crawler 接入说明（功能分支）

分支：`feat/collector-crawler-scheduler-integration`
来源基线：`421581698/LibreTV` @ `7a44d02`（PR #96 / `feature/me-intelligent-collector-entry`）
本分支**不修改 main、不合并 PR、不部署生产**。

## 1. 与现有 Collector API 对齐

本接入严格使用 `services/scrapling-collector/app.py` 已实现的 API，不假设额外的异步 jobs/events 服务：

```
Resource Studio
  → POST /api/resource-collector/scheduler {action:'discover'}
      → Collector GET /v1/discover（FMHY 公开目录发现）
  → 用户筛选站点并点击「采集此站点」
      → POST /api/resource-collector/scheduler {action:'crawl', url, mode, limit}
      → Collector POST /v1/crawl（同步执行，返回 task_id / status / candidates）
  → GET /api/resource-collector/scheduler?action=status&taskId=...
      → Collector GET /v1/tasks?limit=100，按 task_id 读取持久化任务
  → POST /api/resource-collector/scheduler {action:'receive', taskId}
      → Collector GET /v1/tasks/{task_id}/candidates
      → 对 CMS 候选逐一调用 POST /v1/candidates/{candidate_id}/validate
      → 仅 completed 任务且 CMS 结构、可达性、PUBLIC 访问验证通过才返回候选
      → 浏览器对 customAPIs + envSources 去重并调用 addCustomApi 写入 localStorage
```

Collector 当前没有 `/v1/tasks/submit`、`/v1/jobs/{id}` 或持久化 events API；本分支不再调用这些不存在的端点，也不伪造事件流。Collector 的 `/v1/crawl` 是同步调用，任务结果另行持久化到其任务表。

## 2. 文件变更

- `src/lib/collector-scheduler.ts` — 现有 discover/crawl/tasks/candidates/validate API 的服务端编排与 CMS 验证
- `src/lib/collector-scheduler.test.ts` — 使用 mock fetch 验证真实 API 路径、请求体、任务状态与验证门禁
- `src/app/api/resource-collector/scheduler/route.ts` — 编排 API 路由，启用私域守卫；不写服务端 Zustand
- `src/components/resource-studio/IntelligentCollectorPanel.tsx` — 目录发现、站点筛选、单站采集、状态刷新、接收有效 CMS 源
- `.github/workflows/resource-playback-verification.yml` — 为调度 API、测试和 Resource Studio UI 增加 PR 路径触发
- `.env.example` — 补充 `SCRAPLING_API_BASE` / `SCRAPLING_API_TOKEN` 说明

## 3. 安全边界

| 要求 | 实现 |
|---|---|
| 服务端凭据 | `SCRAPLING_API_BASE` / `SCRAPLING_API_TOKEN` 仅由 `collectorRequest` 在服务端读取；浏览器不能读取或注入服务端 Token |
| 安全代理 | HTTPS-only、无查询参数/路径前缀、非 IP 字面量的 Collector base 校验；拒绝重定向 |
| 出口门禁 | `/v1/discover`、`/v1/crawl`、`/v1/candidates/{id}/validate` 均由 Collector 自身实施出口门禁；本分支不修改、不绕过门禁 |
| 候选类型 | 仅 `cms-api-candidate` 可成为点播源；direct-media / player 候选不会写入 CMS API 列表 |
| 验证要求 | 必须 `cms_shape=true`、`reachable=true`、`access_state=PUBLIC` |
| 任务状态 | 仅 `completed` 任务允许接收；partial/failed/interrupted/running 均不入库 |
| 本地持久化 | 服务端只返回验证通过的候选；浏览器端对当前自定义源和预置源去重，再使用既有 Zustand `addCustomApi` 写入当前浏览器 localStorage |
| 私域路由 | 新路由启用 `guardPrivateFeatureRequest` |

## 4. 测试边界

测试全部使用 `vi.stubGlobal('fetch', mock)`，不会触发真实第三方采集。覆盖：
- `/v1/discover` 目录发现代理；
- `/v1/crawl` 请求路径与参数；
- `/v1/tasks` 持久化任务状态读取；
- `/v1/tasks/{id}/candidates` 与 `/v1/candidates/{id}/validate` 的顺序；
- 非 completed 任务拒绝接收；
- CMS 结构与 PUBLIC 访问校验；
- 与已有源 URL 去重；
- 无效任务 ID 与空采集 URL 拒绝。

测试通过不代表真实 Collector 服务可达，也不代表第三方采集已经成功。真实调用必须在 Collector 出口防火墙门禁配置正确的环境中单独验收。

## 5. 配置

```bash
# 必须是公网 HTTPS 源站（无查询参数、无路径、非 IP）
SCRAPLING_API_BASE=https://<your-collector-host>
SCRAPLING_API_TOKEN=<server-only-random-token>
```

Token 通过安全密钥渠道交付，不写入前端、日志或 Git。Collector 侧 `SCRAPLING_EGRESS_FIREWALL_CONFIRMED` 保持在 Collector 服务端；未配置主机级出口防火墙时，discover/crawl/validate 按设计 fail-closed。

## 6. 已知边界

- 本接入只编排当前已存在的 Collector API；不新增后台队列、任务事件流或独立调度服务。
- `/v1/crawl` 为同步调用；Resource Studio 一次发起一个站点任务，不声称存在异步任务提交队列。
- Collector 的任务列表接口只返回最近最多 100 条；超出范围的历史任务可能无法通过此桥接读取。
- E2B/沙盒地址为临时入口，非永久生产地址。
