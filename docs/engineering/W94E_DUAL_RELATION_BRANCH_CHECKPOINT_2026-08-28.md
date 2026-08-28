# W94E 双 Mazz Relation / Branch / State-fact 检查点（2026-08-28）

> 结论：**PASS（定向 A/B 运行边界）**；W94E 总波仍为 PARTIAL，正式 domain outcome 缺口和全量审计 drift 仍按总检查点保留。
> 施工参照：[W94E Relation Branch Effective State](./W94E_RELATION_BRANCH_EFFECTIVE_STATE_SPEC.md)

## 本波定向边界

同一 Workspace 下启动两个相互独立的 Electron Mazz 实例，A/B 使用不同 user-data，复用现有
`relation:*`、`branch:*`、`sync:host/join`、`sync:stateFactPut` IPC；不新增业务接口，不把临时
Python 端点或文件拷贝冒充第二个 Mazz。

## Gate 结果

| Gate | Source | Packaged |
|---|---|---|
| 第二个真实 Mazz runtime | PASS | PASS |
| Workspace identity | A/B 相同；路径不进入报告 | 同左 |
| Relation retrieval | B 读取 A 的事件；B 写入 human rejection；A 重放不回潮 | 同左 |
| Branch effective state | A 写入双父冲突；B 读到冲突；A resolution 后 B rebuild 收敛 `rev:right` | 同左 |
| State-fact transport | A 产生 branch fact；现有 TLS pairing 后 B 接收；独立于 file frame | 同左 |
| Runtime / ResourceLedger | runtime errors `[]`；无 external-tool-process 残留 | 同左 |

证据：[`W94E_RELATION_BRANCH_DUAL_SOURCE.json`](./evidence/W94E_RELATION_BRANCH_DUAL_SOURCE.json)、
[`W94E_RELATION_BRANCH_DUAL_PACKAGED.json`](./evidence/W94E_RELATION_BRANCH_DUAL_PACKAGED.json)。Packaged
证据固定 EXE SHA-256：`12a427ac980e022f2bec3be31b6ddb8f72723067e771538fd16039fcd4bbb080`。

## 验证命令

```text
node --test tests/contract/w94e-dual-runtime.test.mjs
npm run test:w94e:dual-runtime
node tests/e2e/w94e-dual-relation-branch-runtime.mjs --executable "release/win-unpacked/Mazz Editor.exe"
```

脚本：[`w94e-dual-relation-branch-runtime.mjs`](../../tests/e2e/w94e-dual-relation-branch-runtime.mjs)；
定向合同已纳入 [`tests/run.js`](../../tests/run.js)。

## 边界声明

这次只关闭“第二个 Mazz 实例 ↔ 第二个 Mazz 实例”的 Relation/Branch/State-fact A/B 证据；
不宣称公网 P2P、DHT/Tracker、W93 书籍 Job 正式桥接或八域 outcome 矩阵完成。
