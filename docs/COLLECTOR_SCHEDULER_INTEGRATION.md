# Collector ↔ Resource Studio 接入说明（功能分支）

分支：`feat/collector-crawler-scheduler-integration`
基线：PR #96 / `feature/me-intelligent-collector-entry`
本分支不修改 `main`、不合并 PR、不部署生产。

## 1. 实际调用链

```
Resource Studio
  → POST /api/resource-collector/scheduler {action:'discover'}
      → Collector GET /v1/discover
  → 用户选择站点并点击「采集此站点」
      → POST /api/resource-collector/scheduler {action:'crawl', ...}
      → Collector POST /v1/tasks/submit
      → SQLite collector_jobs 持久化排队
      → scrapling-worker claim job 并执行 worker.py
      → worker 调用 crawl_site，写入旧任务表与候选表
      → worker 将结果写回 collector_jobs
  → GET /api/resource-collector/scheduler?action=status&taskId=...
      → Collector GET /v1/jobs/{job_id}
      → succeeded 映射为 Resource Studio 的 completed
  → POST /api/resource-collector/scheduler {action:'receive', taskId}
      → 从 job.result.task_id 解析底层 crawl task ID
      → GET /v1/tasks/{crawl_task_id}/candidates
      → POST /v1/candidates/{candidate_id}/validate
      → 仅公开可访问且 CMS 结构有效的候选返回前端
      → 浏览器对现有源去重并通过 addCustomApi 写入
```

Collector 的持久化队列 API 位于 `registry_queue.py`，包括 `POST /v1/tasks/submit`、`GET /v1/jobs/{id}`、retry/cancel；执行器位于 `worker.py`。队列 job 状态使用 `queued/running/succeeded/partial/failed`，旧 crawl task 状态与其不同。桥接层负责将两种 ID 和状态正确转换。

## 2. 本次修复

- Resource Studio crawl 从阻塞式 `POST /v1/crawl` 改为持久化 `POST /v1/tasks/submit`。
- 状态查询从扫描最近 100 条旧 tasks 改为精确读取 `GET /v1/jobs/{job_id}`。
- 接收结果时从 job.result 解析底层 crawl task ID，再读取候选并逐个验证。
- 将 Worker 的 `succeeded` 映射为 UI 的 `completed`，兼容 `partial`。
- Render 单 Collector 容器同时运行 API 与队列 Worker，共享同一挂载 SQLite 文件；Docker Compose 仍可使用独立 worker 服务。
- UI 明确显示“已排队”，不再误报同步采集已完成。

## 3. 安全边界

- Collector Token 仅在服务端代理注入。
- HTTPS Collector 源站校验与禁止重定向保持启用。
- Collector 出口防火墙仍由 Collector 自身强制执行；没有真实防火墙时保持 fail-closed。
- 只接收 `cms-api-candidate`，并要求 CMS 结构、可达性和 `PUBLIC` 访问状态验证通过。
- 资源源写入沿用浏览器端现有 Zustand/localStorage，不改现有存储格式。

## 4. 测试边界

自动化测试验证队列提交、job 精确状态读取、Worker 状态映射、底层 crawl task ID 解析、候选验证和去重。Mock 测试不等于真实公网采集验收。

## 5. 配置

Collector 服务端需要配置 `SCRAPLING_API_TOKEN`、`SCRAPLING_DB_PATH` 和主机级出口防火墙。LibreTV 服务端需要配置：

```bash
SCRAPLING_API_BASE=https://<collector-host>
SCRAPLING_API_TOKEN=<same-server-side-token>
```

Render 的 PR #96 Blueprint 将 `SCRAPLING_RUN_WORKER=1`，在同一 Collector 容器内启动 Worker，确保 API 与 Worker 共享持久化磁盘。此 Blueprint 仍为手动 opt-in，不会自动创建或部署付费资源。
