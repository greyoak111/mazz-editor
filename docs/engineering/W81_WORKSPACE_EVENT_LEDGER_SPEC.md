# W81 Workspace Event Ledger / Personal Operational History

> 状态：LANDED（本地语义事件产品切片）
> 日期：2026-08-19

## 边界

W81 只记录“用户与资产发生了什么关系”的语义元数据。`Asset = 事实载体`、`Event = 行为证据`、`Relation = 派生解释`；Event、Episode、概念阶段都不获得 Authority。账本默认本地，主模块的成功不依赖采集成功。

永久禁止进入事件协议：正文、逐键输入、剪贴板正文、终端命令、环境变量、prompt、transcript、凭据与 secret。浏览器只记去 query/hash 的 canonical page key；Terminal 只记一次 Enter 提交，不记提交内容。

## 实现

- `mazz.workspace-event/v0` 严格 schema、确定性 event identity、clock anomaly、privacy/retention class。
- `.mazz/events/ledger.ndjson` append-only SHA-256 hash chain；损坏时保留原账并生成恢复报告。
- Browser、Editor、Terminal 三个非阻断 Pilot Producer。
- Episode v0 按时间与共享引用聚类，公开 confidence/reasons/evidence；概念生命史只作 inferred 聚合。
- 侧栏“工作史”支持开关、预算显示、模糊找回、Episode 展开、导出、保留策略和可恢复清空。
- `session / 30d / 1y / keep` 保留策略只能由 `human:*` 显式执行；旧账先归档，再重建 hash chain。

## Gate

本地 Product Slice 已闭：默认本地、可关闭/导出/清空、采集失败不阻断、派生可重建、证据可解释。未建设同步 Universal Event Bus、全知画像、云端 daemon，也不把 W81 当作 Production Run、事实库或计划库。
