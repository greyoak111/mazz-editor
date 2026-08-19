# W62e 持续素材投喂规格

## 定位

W62e 是来源与运行控制面；W74b 仍是变化检测、聚类、投喂包、裁决账和来源 KPI 的唯一实现。W65 四站聚合保留为独立适配器，不能代表通用投喂主链。

## 来源

- `subscription`：RSS/Atom URL，经 SSRF、重定向、TLS、体积上限复检。
- `search`：调用主进程 SearXNG 服务，凭据不出主进程。
- `local`：只允许项目内文件/目录；观察元数据，不读取正文。

来源写入 `.mazz/feed-sources/sources.json`；状态写入 `state.json`。来源 schema 严格拒绝未知字段和 secret。

## 三档自动化

| 等级 | W74b mode | 行为 |
|---|---|---|
| M0 `approval` | `approval` | 只生成投喂包，等待人工裁决 |
| M1 `ingest` | `semi` | 授予自动入料资格；不直接启动 Factory |
| M2 `queue` | `full` | 必须显式授权；只写待启动请求，不调用 AI |

`factoryQueueAuthorized` 只能由用户显式授予。待启动请求记录 `automaticAiInvocation:false`，Factory 运行仍由既有调度与预算闸控制。

## 生命周期与错误语义

- 每来源一个有界 interval；本地来源另有可释放 watcher 与 750ms debounce。
- timer/watcher 登记 Resource Ledger；重配、删除、退出都释放。
- 同一来源运行合流，不重复扫描。
- 来源失败写入健康状态并累加 `consecutiveFailures`，不得伪装成 `NO_CHANGES`。
- 包、报告、裁决和 KPI 继续由 W74b/W74a 管理。

## 停止线

不构建通用爬虫、不存储订阅凭据、不自动调用 AI、不越权创建 Universal Graph，也不并入 W69 网站。
