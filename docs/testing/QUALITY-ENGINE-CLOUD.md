# LibreTV Quality Engine — 自主云端执行与存储

状态：沙盒开发阶段。此配置不会自动创建 Cloudflare 资源，也不会部署 Worker。

## 架构

- **执行平面：** GitHub-hosted Actions runners 执行 lint、TypeScript、Vitest、生产构建和 Playwright 浏览器矩阵。
- **控制/存储平面：** 独立 Cloudflare Worker 提供受认证的 run、event、evidence API。
- **结构化持久化：** 专用 Cloudflare D1，保存运行元数据、追加式事件流和证据索引。
- **二进制证据：** 专用 Cloudflare R2，保存截图、视频、Trace、JUnit、日志等证据对象。
- **质量决策：** 继续由仓库内纯 TypeScript Quality Engine 生成报告和执行质量门禁；Worker 不自行宣布发布通过。

## API

公开健康检查：
- `GET /health`

其余接口均要求 `Authorization: Bearer <token>`：
- `POST /v1/runs`：创建运行记录。要求 id、planId、project、branch、commitSha；commitSha 必须是 40 位十六进制 SHA；Preview URL（如提供）必须为 HTTPS。
- `GET /v1/runs/:runId`：读取运行元数据。
- `POST /v1/runs/:runId/events`：追加事件；runId 必须匹配，sequence 必须连续。
- `GET /v1/runs/:runId/events`：按 sequence 读取事件。
- `POST /v1/runs/:runId/evidence/:evidenceId`：上传证据；通过 `x-evidence-kind` 和 `x-evidence-label` 提供元数据，限制 15 MiB。
- `GET /v1/runs/:runId/evidence`：列出证据元数据。
- `GET /v1/runs/:runId/evidence/:evidenceId`：经认证下载证据。

安全边界：
- Worker 不开放匿名写入；不启用宽泛 CORS。
- API 只接受 SHA-256 格式的 token 摘要配置，原始 Bearer token 不写入代码或 D1。
- JSON 请求上限 64 KiB；证据上传上限 15 MiB，并限制内容类型。
- R2 对象 key 由服务端生成，下载前必须通过 D1 元数据定位。
- D1 使用全局事件 ID 主键和 `UNIQUE(run_id, sequence)`，并发冲突明确失败，不覆盖已有事件。
- 运行、事件、证据都属于独立 QA 环境；禁止使用生产用户数据或生产媒体存储。

## 沙盒验证与资源准备

1. 在 Cloudflare 创建独立 D1 数据库 `libretv-quality-engine`。
2. 创建独立 R2 bucket `libretv-quality-artifacts`，不要复用生产桶。
3. 将返回的 D1 database ID 替换到 `quality-engine/cloud/wrangler.quality.toml`。
4. 本地生成高熵随机 Bearer token，并计算 SHA-256；只把摘要作为 Worker Secret `QUALITY_API_TOKEN_SHA256` 保存。原始 token 只交给受信任的 CI secret 管理，不写入仓库。
5. 先用 Wrangler local mode 和合成数据运行迁移/API 集成测试；通过后才考虑部署到独立 Preview Worker。
6. Preview Worker 部署、D1/R2 资源创建、CI secret 注入均需单独授权；本分支不会触碰生产 Worker。

## 迁移

```bash
npx wrangler d1 migrations apply libretv-quality-engine --local \
  --config quality-engine/cloud/wrangler.quality.toml
```

远端迁移只能在独立 QA D1 已创建、ID 已填写并得到部署授权后执行：

```bash
npx wrangler d1 migrations apply libretv-quality-engine --remote \
  --config quality-engine/cloud/wrangler.quality.toml
```

## 当前明确限制

- D1EventStore 提供跨 Worker 实例共享的持久事件存储；D1 唯一约束负责阻止重复 ID/序号竞争。
- 当前 API 负责运行元数据、事件和证据存取；还没有接入自动修复 Agent，也不自动改变 run 状态或质量门禁结论。
- GitHub Actions 是云端执行器；Cloudflare Worker 是独立存储/查询服务。下一阶段将把 CI 的运行事件和证据上传接入此 API，并增加端到端契约测试。
- 云端 Chromium/Firefox/WebKit 结果不是实体 iPhone/iPad Safari 结果。
