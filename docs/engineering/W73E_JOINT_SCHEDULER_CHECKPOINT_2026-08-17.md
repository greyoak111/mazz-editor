# W73e Joint Scheduler & Elastic Staffing — 检查点

> 状态：`COMPLETE`
> 开工基线：`main@d663cb1`
> 日期：2026-08-17
> 下一波：`W73f Cost / KPI / Local Evaluation — NOT APPROVED`

## 1. 本波结论

W73e 已在 W73b–d 的同一条 W68 单次 Production Run 上落下“提议—人工决定—dispatch—释放”的调度事实链。它没有替换 `runTaskPool()`、`runningTasks`、AbortController 或 W68 执行器，也没有把 AI Provider 路由冒充 Capability、Executor、Seat 或 Harness。

本波关闭四个具体缺口：

1. FIFO 队列现在可按显式 priority 稳定排序；
2. 每次正式派工都能列出候选、排除理由、推荐、备选、证据窗口、成本/延迟估计与 confidence；
3. 多候选必须由人类显式选择，AUTO 不能暗中落锤；
4. 1–4 路弹性容量、背压、取消、释放和崩溃后的孤儿 dispatch 都有可重放事实。

## 2. 身份与所有权边界

继续钉死：

```text
Model != Provider != Harness != Seat
Capability != Executor
Schedule Proposal != Human Final Decision
Staffing Lease != W68 Task Execution
Factory Pass != Promotion != Publication != Canon
```

W72 `CapabilityRegistry` 继续只描述能力和健康；W73e 只消费其 `mazz.capability-provider/v0` 快照。实际任务仍由旧 W68 worker pool 执行，调度器不调用 Provider、Harness、外部工具或子进程。

## 3. 冻结协议

新增：

```text
mazz.scheduler-request/v0
mazz.scheduler-proposal/v0
mazz.scheduler-record/v0
```

调度输入：

```text
Seat requirement
Capability requirements
Qualification result
Health snapshot
Budget remainder
Priority
Backpressure
Risk limit
Manual candidate/executor lock
Banned Provider refs
Evidence window
```

调度输出：

```text
included candidates
excluded candidates + reason codes
recommended candidate
alternate candidates
estimated cost / latency
confidence
human override options
final human decision
```

候选排序是公开字典序：健康 → 风险 → 背压 → 成本是否已知/数值 → 延迟是否已知/数值 → confidence → candidateId。没有不可解释的综合分或 One Overall Score。

## 4. 人工覆盖纪律

`createScheduleProposal()` 只产生建议。`finalizeSchedule()` 只接受 `human:*` Authority：

- 单一合格候选可由用户的“启动任务/启动批次”动作确认；
- 多个合格候选必须显式给出 `selectedCandidateId`；
- 选择非推荐候选必须写 `overrideReason`；
- 改预算、禁 Provider、锁 executor 后重新计算候选；
- 不允许用人工覆盖绕过无证、不可用健康状态或硬风险事实。

## 5. 排除与合法阻断

首批显式原因包括：

```text
MANUAL_CANDIDATE_LOCK
MANUAL_EXECUTOR_LOCK
PROVIDER_BANNED
SEAT_MISMATCH
CAPABILITY_MISSING
QUALIFICATION_*
HEALTH_UNKNOWN / HEALTH_UNAVAILABLE
EXECUTOR_BACKPRESSURE
POOL_BACKPRESSURE
BUDGET_INSUFFICIENT
RISK_EXCEEDS_LIMIT
```

没有合格 Executor 时结果为 `BLOCKED: NO_QUALIFIED_EXECUTOR`；纯容量不足时为 `BLOCKED: BACKPRESSURE`。两者都不会降级到任意模型。

## 6. 调度账与恢复

单 Run 新增：

```text
<factory-project>/.mazz/runs/<runId>/scheduling.ndjson
```

记录类型：

```text
schedule-proposed
schedule-decided
dispatch-started
dispatch-rejected
dispatch-released
recovery-acknowledged
```

账本具备：

- sequence 严格递增；
- recordId 精确幂等、同键异义拒绝；
- 写入串行；
- 尾损坏隔离到 `scheduling.ndjson.corrupt-tail.txt`；
- 中段损坏拒绝猜测；
- 重开检测未释放 dispatch 并阻断 Run；
- 只有 human Authority + evidence 可把孤儿 dispatch 标记为 `recovered-abandoned`；
- dispose 等待在飞写并回到 `activeWrites=0`。

Production Run v0 只增加：

```text
scheduling-recorded
run-blocked
scheduleRefs[]
```

正文、Prompt、模型回复、API key 和原始环境变量不进入调度账。

## 7. 弹性编制与旧任务池保真

`ElasticStaffingCoordinator` 只维护旁路 lease：

- 容量继续为产品既有的 1–4；
- 缩容不杀死已运行任务，只阻断新 lease；
- 达上限明确 BACKPRESSURE；
- release/cancel/dispose 回到 active=0；
- `runningTasks` 与 task AbortController 继续是真实执行/取消 owner。

`runTaskPool()` 只新增稳定 priority 排序；同优先级保持原输入顺序。max/legacy 仍不迁移，旧 W68 单次链之外没有隐式启用。

## 8. 故障与资源证据

| 场景 | 结果 |
|---|---|
| 无 Provider / 无健康 Executor | Run 进入 blocked，不执行正文 |
| 证书撤销/过期 | 新派工即时排除 |
| 多候选未显式选择 | 拒绝最终决定 |
| 容量满/缩容超配 | 不强杀在途，新派工 BACKPRESSURE |
| dispatch 开始后崩溃 | 重开识别 orphan，Run recovery-required |
| Ledger 尾损坏 | 尾部隔离、合法前缀保留、继续写阻断 |
| Ledger 中段损坏 | 硬拒绝猜测 |
| 正常完成/失败/取消 | dispatch release 留 outcome，lease 归零 |

回滚方式：停止调用 `scheduleFactoryTask()` 即可恢复原 W68 task pool 行为；既有调度账保留为只读证据。不得删除已写 Ledger，也不需要迁移 W68 工件。

## 9. 验证水位

- W73e 新增合同：`17/17`；
- W72 Registry + W66 Harness + W62a Agent + W68a/b/c + W73a–e 关联断言：`125/125`；
- renderer build：`PASS`；
- 全量 `node tests/run.js`：`166/166` 个测试文件通过（退出码 0）。

## 10. 明确未做

- W68 max/legacy 迁移；
- W73f cost actual / KPI / local evaluation / Pareto；
- W73g Director / Process Protocol Assets；
- W73h Electron/packaged/20-cycle soak；
- 真 W66 Adapter 或外部 Agent 激活；
- W69 Router/Market、W74 Promotion、W79 Tool Runtime、W82 Compiler；
- 新调度 UI、排行榜、One Overall Score 或 hidden AUTO。

下一建议薄波为 W73f，仍需维护者单独批准。
