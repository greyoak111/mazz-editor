# W73d Qualification & Delegation — 检查点

> 状态：`COMPLETE`
> 开工基线：`main@95f51a4`
> 日期：2026-08-17
> 下一波：`W73e Joint Scheduler & Elastic Staffing — NOT APPROVED`

## 1. 本波结论

W73d 已在 W73b/c 的同一条 W68 单次 Production Run 旁路上落地资格与委托事实链。它没有把 Provider 路由改名成 Agent Harness，也没有因为当前真实 Adapter 为 0 就伪造外部执行成功。

本波关闭四个具体缺口：

1. `QualificationDefinition / QualificationAttempt / QualificationCertificate` 不再混为一个“能力标签”；
2. 受限 Seat 在 assignment 之前有可重放的持证门禁；
3. 现有闭集 `AgentRuntime` 有可指回 task/result evidence 的内部委托路径；
4. 外部任务只有 W66 Harness Session 一条合法执行路；当前无 Adapter 时精确返回 `BLOCKED: HARNESS_UNAVAILABLE`。

## 2. 不可破坏的身份边界

本波继续执行：

```text
Model != Provider != Harness != Seat
QualificationDefinition != QualificationAttempt != QualificationCertificate
Certificate != Assignment
Provider success != Harness execution success
```

证书从一次通过的 Attempt 派生，但三者使用独立 ID；证书只声明某个 Executor 对指定 Seat 的资格，不把模型名、Provider 连接或一次成功反推成“已持证”。

## 3. 资格事实链

新增 schema：

```text
mazz.qualification-record/v0
```

记录类型：

```text
qualification-defined
qualification-attempt-recorded
qualification-certificate-issued
qualification-certificate-revoked
```

Definition 冻结：

- `definitionId`；
- `probePackRef + probePackVersion`；
- `seatRefs[]`；
- `passingScore`。

Attempt 冻结：

- `attemptId + definitionId + executorRef`；
- `score + outcome`，二者由代码核对；
- `startedAt + completedAt`；
- 至少一项可打开的 `evidenceRefs[]`。

Certificate 冻结：

- `certificateId + definitionId + attemptId + executorRef`；
- 适用 `seatRefs[]` 不得超出 Definition；
- `issuedAt + validFrom + expiresAt`；
- 签发与撤销 evidence；
- 撤销时间、原因与人工 Authority。

签发/撤销只接受 `human:*` Authority。`model:*`、`provider:*`、未通过 Attempt、分数与 outcome 不一致、错 executor、超范围 Seat、未知字段和 secret 都在落盘前拒绝。

## 4. Assignment 门禁

受限 Seat 的新 assignment 必须同时满足：

```text
certificate exists
&& certificate.executorRef == requested executor
&& seatRef in certificate.seatRefs
&& validFrom <= now < expiresAt
&& certificate not revoked
```

失败状态不会暗降到任意模型，分别保留：

```text
QUALIFICATION_REQUIRED
QUALIFICATION_EXECUTOR_MISMATCH
QUALIFICATION_SEAT_MISMATCH
QUALIFICATION_NOT_YET_VALID
QUALIFICATION_EXPIRED
QUALIFICATION_REVOKED
```

非受限内部动作必须显式写 `restricted=false`；它不会污染或自动签发受限 Seat 证书。

## 5. 委托事实链

新增 schema：

```text
mazz.delegation-record/v0
```

记录类型：

```text
assignment-created
delegation-started
delegation-blocked
delegation-completed
delegation-failed
delegation-cancelled
delegation-disposed
```

每项委托保存：Run、Task、Seat、Executor、Certificate、channel、instruction reference、evidence、result/error 与 Harness 生命周期引用。指令正文、结果正文、密钥和 Provider raw response 不进入 NDJSON。

文件布局：

```text
<factory-project>/.mazz/qualifications.ndjson
<factory-project>/.mazz/runs/<runId>/delegations.ndjson
```

资格账按项目存在，可供同项目新 Run 验证；委托账按 Run 隔离。Production Run 只新增 `qualificationRefs[] / delegationRefs[]` 与两类事件引用，不复制资格或执行正文。

## 6. 内部 AgentRuntime

`FactoryPanel.delegateInternalAgent()` 只调用现有闭集 `AgentRuntime.submit()`，先过资格门，再顺序记录 assignment/start/result。它不创建第二 Agent Runtime，不扩大命令闭集，也不改变 W62a 的六步上限、澄清卡或危险动作确认。

内部执行结果只写 result reference 和有限状态摘要；任务正文仍由原模块持有。

## 7. 外部 Harness 现实水位

当前产品主进程的 `AgentHarnessService` 没有注入任何真实 Adapter，正式 census 仍为：

```text
registeredAdapterCount = 0
```

因此产品当前合法行为是：

```text
harness:adapters -> []
assignment -> BLOCKED: HARNESS_UNAVAILABLE
harness:createSession calls -> 0
```

协议测试使用注入式 Harness client 证明未来真 Adapter 到位后的唯一合法路径是：

```text
listAdapters
→ createSession
→ send
→ result reference / failure
→ interrupt（取消时）
→ dispose
```

Session、Adapter、result、cancel、dispose provenance 全部入委托账。外部 failure 只记 Harness/Executor failure；记录形状没有 `providerBoundary/providerRef/modelRef`，不能被重写成 Provider 成功。

## 8. 恢复与资源纪律

资格账和委托账均：

- 单账串行写；
- 精确重复幂等，同键异义拒绝；
- 可由 NDJSON 重放；
- 中段损坏硬拒绝；
- 尾损坏隔离到 `*.corrupt-tail.txt` 并进入 recovery-required；
- recovery-required 时 Production Run 保持 `blocked`；
- dispose 等待在飞写，`activeWrites=0`；
- Service dispose 会 interrupt/dispose 所有在飞 Harness Session，`activeExternal=0`。

## 9. W68 与跨波边界

没有改变：

- W68 三轮回炉、退骨、M2/M4/M5/M6、四闸与十一类工件；
- W68 max/legacy；
- Provider/model 角色路由；
- W62a 指令台现有 UI 与危险动作确认；
- W66 Harness Foundation 契约。

明确未进入：

- W73e Scheduler / elastic staffing / candidate set / backpressure；
- W73f cost/KPI/ranking；
- W73g protocol assets；
- W69 Hub/Market、W74 Promotion、W70 Cognition、W79 外部工具、W82 Compiler。

## 10. 验证

定向验证：

```text
W73d qualification/delegation ledger     10/10
W73d Factory integration                  6/6
W73b Production Run                      17/17
W73c Rework/Audit                        12/12
W62a AgentRuntime                         9/9
W66 Harness Foundation                    7/7
W68a/b/c                                 29/29
合计                                     90/90
```

最终验证：`node tests/run.js` **164/164 测试文件通过**；`npm run build` 通过。机器证据见 [`W73D_QUALIFICATION_DELEGATION_IMPLEMENTATION.json`](./evidence/W73D_QUALIFICATION_DELEGATION_IMPLEMENTATION.json)。

## 11. 回滚

本波没有迁移旧工件或删除旧路径。回滚只需停止调用 W73d 两个 Factory 委托入口并不再打开两份新账；W68/W73b/c 原主链仍可独立运行。已经写出的资格与委托记录保留为只读证据，不应删除或改写。

## 12. 下一闸

W73e 仅为建议下一波，尚未批准。它可以消费本波的资格结果和现有 W72 Registry，但不得把本波已经明确的 `BLOCKED` 改成暗中降级，也不得在没有真实 W66 Adapter 时伪造外部候选。
