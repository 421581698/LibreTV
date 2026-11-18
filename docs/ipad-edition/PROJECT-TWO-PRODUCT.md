# LibreTV iPad Edition — 项目二：完整产品建设

状态：开发与自动化验收进行中。此项目基于项目一独立基础分支，在专属产品分支上构建完整 iPad 影院产品。

## 范围

本项目只建设 iPad 版本，不扩展其他设备形态。产品 UI、导航、样式、页面路由均位于 `/ipad-edition` 独立命名空间；允许复用既有服务端数据 API、搜索服务、媒体详情逻辑、播放器内核和本地数据库能力。

## 页面与能力

| 页面/模块 | 实现方式 | 数据来源 |
|---|---|---|
| 影院首页 | 宽幅精选 Hero、继续观看、热门电影、热门剧集、最新内容、新番轨道 | 豆瓣 API、60s 热榜备用、Bangumi 日历 |
| 电影 | 热门/最新/高分切换、分页、真实海报 | `/api/douban` |
| 电视剧 | 热门/最新/高分切换、分页、真实海报 | `/api/douban` |
| 动漫 | 新番日历与真实番剧条目 | `/api/bangumi/calendar` |
| 搜索 | 聚合已启用点播源、真实搜索结果、进入详情 | `/api/search` |
| 详情 | 复用既有真实详情、分集、收藏与分享逻辑 | `/api/detail` 与本地数据库 |
| 播放 | iPad Edition 专属播放路由，复用现有播放器能力 | 既有播放服务与播放内核 |
| 资料库 | 本地收藏读取、打开详情、移出收藏 | IndexedDB / Dexie |
| 设置 | 连接现有数据源和播放设置能力 | 既有设置状态与 API |

## 数据真实性规则

- 首页和分类只展示 API 返回的真实条目。
- 不用假海报、随机内容或静态样例填充真实内容区域。
- 推荐接口失败时允许使用已配置的真实热榜备用接口；备用接口也失败时显示错误/空状态。
- 搜索结果必须来自当前启用且通过 URL 安全校验的点播源。
- 影片详情和播放必须使用源返回的真实 ID、详情和播放地址。

## 视觉与交互

- 延续项目一冻结的影院式 iPad 应用壳与浅色/深色 token。
- Sidebar、顶部悬浮胶囊导航和页面内容共享同一 iPad Edition 路由布局。
- Hero、海报轨道、分类网格、搜索结果和本地资料库使用独立 `ipad-edition__*` 样式命名空间。
- 提供加载、错误、空数据状态；支持键盘/触控可访问性与减少动态效果偏好。

## 独立验证

产品包含本地继续观看进度轨道；播放入口使用 iPad Edition 专属播放路由。\n\n当前产品分支的 TypeScript、ESLint、单元测试与 Next.js 生产构建已通过 CI；独立 Preview 部署与 HTTP smoke test 已通过，最新增量变更正在重新验收。

- TypeScript：`npm run typecheck`
- ESLint：`npm run lint`
- 单元测试：`npm test -- --reporter=dot`
- 生产构建：`npm run build`
- 独立 Preview：只允许部署至 `libretv-ipad-edition-preview` Worker；不连接生产路由。
- Preview HTTP smoke test 仅验证路由和页面壳响应；不等同于真实 iPad 视觉验收。

## 分支与发布边界

- 项目一基础分支：`feature/libretv-ipad-edition-foundation`
- 项目二产品分支：`feature/libretv-ipad-edition-product`
- 项目二 Draft PR：#99
- 不修改 main、不合并 PR、不部署生产。
- 只有 CI 通过、独立 Preview 可访问并完成 iPad 实际视觉验收后，才可报告项目二验收完成。
