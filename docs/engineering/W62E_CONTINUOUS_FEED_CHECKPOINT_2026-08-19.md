# W62e 持续素材投喂检查点 — 2026-08-19

## 完成

- subscription/search/local 三类来源注册、持久化、即时扫描和恢复调度。
- RSS/Atom 有界归一，SearXNG 复用，本地项目边界与只读元数据观察。
- M0 人工核准、M1 自动入料资格、M2 显式授权待启动队列三档。
- 维度路由、来源健康、连续失败、调度器、local watcher、Resource Ledger 与退出释放。
- 主进程 IPC、preload 白名单和 Factory 正式控制面；W65 四站适配器兼容保留。

## 验证

- `npm run build`：PASS。
- `node tests/contract/w62e-continuous-feed.test.mjs`：6/6 PASS。
- `node tests/contract/w74b-feed-pipeline.test.mjs`：8/8 PASS。
- `node tests/contract/w65bc-convergence.test.mjs`：8/8 PASS。
- 新合同已登记 `tests/run.js`；本检查点未运行全量、真实公网 RSS 或长时间 watcher soak。

## 停止线

M2 只生成 `awaiting-factory-dispatch` 请求且明确 `automaticAiInvocation:false`；没有以“全自动”绕过 Factory 权限、预算和启动闸。
