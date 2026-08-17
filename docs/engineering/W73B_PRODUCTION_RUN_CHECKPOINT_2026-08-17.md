# W73b Production Run Identity & Append-only Ledger 检查点

> 日期：2026-08-17
> 开工基线：`main@c6a76d7`
> 状态：`COMPLETE — ONE W68 SINGLE-PATH SLICE`
> 下一波：`W73c Rework & Audit Discipline — NOT APPROVED`

## 1. 交付结论

W73b 已经把一条既有 W68 单次生产路径接入唯一、文件优先的本地 Production Run 事实链。它没有重写 `runW68Review()`，没有改变四闸、修订单、Factory Desk 或正文落盘格式，也没有建设第二 Factory。

选定路径：

```text
W68 single task
→ run-created / run-started
→ existing generation
→ existing W68 review artifacts
→ review-recorded (references only)
→ existing final Markdown + snapshot
→ run-completed
→ legacy task state done
```

完成账故意先于 legacy `done` 状态；W68 单次任务若缺 Ledger，会以 `W73_RUN_LEDGER_MISSING` 阻断，不能无账继续。W68 max 和 legacy review 路线没有迁移。

## 2. 新增合同

| 合同 | 标识 | 责任 |
|---|---|---|
| Production Run | `mazz.production-run/v0` | 稳定身份、当前状态、时间、上下文、Gate/Artifact 引用与恢复摘要 |
| Run Event | `mazz.production-run-event/v0` | 单 Run 严格递增的 append-only 状态/证据事件 |
| References | `mazz.production-run-references/v0` | Artifact path/id/type/role/sourceRef 去重引用；不复制正文 |

状态闭集：

```text
proposed → running → paused / blocked / failed / completed / cancelled
paused / blocked → running
terminal = failed / completed / cancelled
```

事件闭集：

```text
run-created
run-started
review-recorded
artifact-recorded
run-paused
run-recovery-required
run-failed
run-completed
run-cancelled
```

未知顶层字段、非法状态/事件、sequence 跳号、runId 路径穿越和 `apiKey/authorization/secret/password/accessToken/...` 字段均拒绝。

## 3. 本地布局

```text
<factory-project>/.mazz/runs/<runId>/
├─ run.json
├─ events.ndjson
├─ findings.ndjson
├─ economics.ndjson
└─ references.json
```

`findings.ndjson` 与 `economics.ndjson` 在本波只作为空的所有权占位文件；W73b 不以文件存在冒充 W73c Finding 或 W73f actual cost 已完成。

既有正文、蓝图、审理报告、判例、圣经、成本台账和 Factory archive 仍在原位置。Run 只引用它们，不搬迁、不改格式、不复制正文。

## 4. 写入与恢复语义

1. 单 Run 内所有 append 由 Promise queue 串行，sequence 和 eventId 不重号。
2. 每次先原子写 `events.ndjson`，再写 `run.json` 和 `references.json`。
3. event 已写、后续快照写失败时，当前实例进入 `requiresReload`，拒绝继续覆盖；重开由 event replay 补回。
4. 最后一行损坏时只隔离尾部到 `corrupt-tail.txt`，保留合法前缀并显式写 `run-recovery-required → blocked`。
5. 中段损坏说明历史顺序不可信，直接报错，不猜测、不跳行。
6. 重开未闭合 `running` Run 先转 `blocked / ORPHANED_RUNNING_RUN`；下一次真实任务启动才写 `EXPLICIT_RECOVERY → running`。
7. dispose 等待在飞写完成；释放后拒绝新 append。

## 5. W68 集成边界

- `ensureProductionRun()` 只允许 `reviewProtocol === W68_PROTOCOL && mode !== 'max'`；
- task state 保存 schema/runId/path/status 指针；终态任务重跑生成新 runId，并用 `previousRunId` 连接，绝不改写旧 Run；
- `review-recorded` 引用 W68 十一类工件和 manifest，并记录 machine/point/review/objection Gate 的 pass/block；
- `run-completed` 只引用最终 Markdown 路径；不写正文、Prompt、response 或模型思维链；
- Provider 只登记请求路由且 `observed=false`，因为当前 Provider 层尚未回传实际 executor/finish boundary；F20 仍是 PARTIAL；
- 当前配置中的 API key 会在错误消息入账前脱敏，且 Provider boundary 不含 key/baseURL。

## 6. 验证

定向验证：

```text
w73b-production-run-ledger       13 / 13
w73b-factory-integration          4 / 4
W68a                              11 / 11
W68b                               9 / 9
W68c                               9 / 9
W71 Factory lifecycle              6 / 6
```

覆盖内容：

- schema、字段闭集、身份和路径安全；
- secret 拒绝与当前 Provider key 脱敏；
- create/start/review/complete/reopen 往返；
- 同 Run 并发 append 串行；
- 真实临时文件系统五件套与重开；
- event 已写、snapshot 失败后的重放；
- 损坏尾隔离、中段损坏拒绝；
- orphan running 恢复；
- dispose 等待在飞写并回到 `activeWrites=0`；
- 真实 `FactoryPanel` 方法创建、记审、完成、重跑链接和缺账阻断；
- W68 max/legacy 未被顺手迁移。

全量回归：`node tests/run.js`，`160/160` 个测试文件通过。

## 7. 本波明确未完成

- W68 max、多单元恢复、legacy review 的 Run 迁移；
- W73c rework lineage、Finding/AuditFlag/幻锚证据；
- W73d 资格、证书与真实 W66 外部委托；
- W73e 联合调度与弹性编制；
- W73f provider actual usage、价表、KPI、Metric/Formula、评价与 Router；
- W73g Director/Process protocol asset；
- Production Run UI、公共投影、Promotion、Hub、排行榜；
- packaged Electron E2E 和 20 次真实生产 soak。

这些缺项不是 W73b 假完成所需的“尾巴”；它们分别属于 W73c–h。下一波只能从 W73c 开始，不能把 W73d–g 并行偷渡进来。
