# W94E Relation Retrieval + Branch Effective State 检查点

> 状态：**PARTIAL / 实现、Source/Packaged 证据、构建与全量回归已落地；第二个 Mazz A/B 与剩余入口缺口仍待补齐**  
> 日期：2026-08-26；增补复核：2026-08-27  
> 施工参照：[W94E Relation Branch Effective State Spec](./W94E_RELATION_BRANCH_EFFECTIVE_STATE_SPEC.md)

## 本次波次已落地

- `main/foundation/branch-effective-state.js`：严格 `mazz.branch-manifest/v0`、revision、effective-state、human resolution 合同；纯 reducer 保留 current/unknown/conflict 三态，按 domain 隔离，禁止隐式 Authority。
- `main/branch-effective-state-service.js`：当前 Workspace 绑定的 Branch Store，原子写入、CAS、state hash、父分支环检测、重启重建；不输出路径或正文。
- `main/relation-retrieval-service.js`：从现有 Workspace Event Ledger 与 Context Graph 生成可解释检索投影；结果回到 event/anchor/edge/context 引用；候选拒绝作为 human 授权的 durable negative fact；不复制正文、路径、凭据或网络定位器。
- `main/foundation/lan-state-facts.js` 与 `main/lansync.js`：增加独立 `state-facts` frame/merge/ack 轨，Workspace identity、revision、signature 校验与冲突保留；文件 frame 成功不冒充 state fact 合并。不同物理根的传统文件同步仍可继续，state fact 轨会单独拒绝跨 Workspace。
- `main/foundation/domain-event-capture.js`、各 domain producer 与 `main/library-acquisition-service.js`：八域共享 metadata-only producer helper；Workspace Event 合同正式接受 `approval` outcome；Library 的 HTTP/Torrent/Browser durable Job 在成功、失败、取消、暂停 partial 终态进入同一 Event Ledger，禁止正文、路径、凭据和传输内容进入事件。
- `main/main.js`、`preload/bridge.js`：加入 relation、branch、state-fact 窄 IPC；旧 `context:*`、`events:*`、文件同步入口继续兼容。

## 已查波次

| 检查项 | 结果 | 证据 |
|---|---|---|
| W94E 纯合同 | PASS，9/9 | `node --test tests/contract/w94e-relation-branch.test.mjs` |
| Source runtime | PASS | [`W94E_RELATION_BRANCH_SOURCE.json`](./evidence/W94E_RELATION_BRANCH_SOURCE.json) |
| Packaged runtime | PASS | [`W94E_RELATION_BRANCH_PACKAGED.json`](./evidence/W94E_RELATION_BRANCH_PACKAGED.json) |
| 八 domain 事件投影 | PASS，8/8 metadata-only events | Source/Packaged runtime evidence |
| 查询解释/拒绝重放 | PASS | Source/Packaged runtime evidence |
| 多父冲突/人工 resolution | PASS | Source/Packaged runtime evidence |
| LAN state-fact 独立轨 | PASS，offline fixture + real TCP loopback；12/12 LAN assertions（含真实 TLS 中途断线 fail-closed、跨帧乱序重放） | W94E contract；`tests/contract/lansync.test.mjs` |
| 跨机器物理 TLS/帧专项 | PASS_WITH_SCOPE，真实跨机器 TCP 与临时协议端点完成双向 1 文件 + 1 state-fact，监听/证书已清理；非第二个 Mazz 二进制 | [`W94E_LAN_PHYSICAL_PROTOCOL_PEER.json`](./evidence/W94E_LAN_PHYSICAL_PROTOCOL_PEER.json) |
| 八域事件 producer 接线 | PARTIAL，8/8 producer 已接入同一 metadata ledger；approval outcome 合同与 Canvas 人类导出意图已补齐；剩余缺口按域/入口列出 | [`W94E_DOMAIN_EVENT_COVERAGE.json`](./evidence/W94E_DOMAIN_EVENT_COVERAGE.json) |
| W94A–D 回归 | PASS | W94A–D contract/runtime evidence |
| 全量回归 | PASS，276/276 | `npm test` |
| build / packaged dist | PASS | `npm run build`、`npm run dist:dir` |
| provenance / secret / release audit | PASS | `npm run audit:provenance`、`npm run audit:secrets`、`npm run audit:release` |

## 当前未宣称完成的部分

1. 本波全量回归、构建与打包审计已经完成，但不把局部绿色缩小口径成全波完成；因此状态仍保持 PARTIAL。
2. 跨机器真实 TLS/帧线路已用临时协议端点完成双向文件与 state-fact 验证；完整的“第二个 Mazz 实例 ↔ 第二个 Mazz 实例”物理 A/B 仍需第二端运行时，不能用 Python 协议端点冒充。
3. 八个正式 domain 的 producer 已接入同一 helper；Workspace Event 合同现在可持久化 `approval`，Factory、Library、Calc、Chart、Blender 与 Canvas 现有审批/人类导出意图已按真实入口记录。Player 仍无独立 approval，Canvas 仍无显式 cancel，World 仍无 cancel/人工 approval；缺口已逐项写入 [`W94E_DOMAIN_EVENT_COVERAGE.json`](./evidence/W94E_DOMAIN_EVENT_COVERAGE.json)，不能以推断事件填充。

## 复开条件与停止线

- 任一 Workspace identity、hash/CAS、signature、recovery 或资源 owner 失败，停止发布并保留原始事实。
- 即使全量 `npm test`、`npm run build`、`npm run dist:dir` 与审计复核已通过，未完成第二个 Mazz 实例的真实 LAN A/B 和正式入口覆盖审计前，仍不写 W94E PASS。
- 不新增字数、token、候选、文件数量业务门；显式输出偏好只能由调用者提供，厂商计量留在厂商/usage 证据。
