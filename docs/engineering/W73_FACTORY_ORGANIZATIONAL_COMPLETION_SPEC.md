# W73 Factory Organizational Completion — 施工规格

> 状态：`W73g IMPLEMENTED / W73h NOT APPROVED`
> 版本：v1.6
> 审计坐标：`main@94a82aa`
> W73b 开工基线：`main@c6a76d7`
> W73c 开工基线：`main@b443908`
> W73d 开工基线：`main@95f51a4`
> W73e 开工基线：`main@d663cb1`
> W73f 开工基线：`main@3b924c2`
> W73g 开工基线：`main@94a82aa`
> 日期：2026-08-17
> 机器可读差额表：[`W73_FACTORY_GAP_MATRIX.json`](./evidence/W73_FACTORY_GAP_MATRIX.json)
> 跨波次真源：`C:\Users\Administrator\Downloads\交付区\Mazz 当前未落地全景-W71归并版.md`

## 1. 结论

W73 值得做，但它不是“下一代 Factory 重写”。当前 W68a/b/c 已经形成真实产品主链：任务、工件、三轮回炉、机检、对点、背靠背审理、质询、答辩、仲裁、四闸、终审卡、预算、成本台账、并发队列、暂停/恢复、Factory Desk 与七项运行健康指标都已存在。W73 的正确任务是：

> 在不改变 W68 审理语义的前提下，为现有生产行为建立唯一、可重开、可追踪的本地 Production Run 事实链，再让组织审计、持证、委托、调度、成本与评估共享这条事实链。

W73b 已按本规格完成单路径薄实现：只有 W68 单次任务进入 `mazz.production-run/v0`，以每 Run 独立目录保存 snapshot、append-only 事件语义和 Artifact references。W73c 又在同一条 W68 单次路径上补齐 `Finding / AuditFlag / Rework` 旁路事实链和恢复阻断；没有重写 W68 审理引擎。W73d 在同一事实链旁补齐项目级资格账、单 Run 委托账、受限 Seat 持证门禁与内部闭集 `AgentRuntime` 委托；由于当前产品真实 W66 Adapter 仍为 0，外部委托只允许确定性落 `BLOCKED: HARNESS_UNAVAILABLE`。W73e 继续在同一 Run 上补充可重算的候选/排除/人工决定/dispatch 事实，并让旧 1–4 worker pool 服从显式优先级、资格、健康、预算、风险和背压；AUTO 只提议，多候选必须由人类显式选择。W73f 已把同一 Run 的成本、版本化 Metric/Formula、本地评价与 Pareto 前沿落入 `economics.ndjson`：W68 字符折算只记作 estimate，真实 usage、结算金额和缺失证据保持分离或 UNKNOWN；九条能力轴、Production/Author/Audience 三张成绩单与七项系统健康 KPI 均可追溯，但真实样本不足时不宣称排名有效。W73g 又把 W68 Director table、handoff、exception、artifact chain 与 gate/recovery 冻结为项目级不可变协议资产，并把每个 Run 的既有引用按 sequence 投影为只读资产；两类资产均带 W72 Asset Envelope，并通过原 `工厂群.md` 被现有 Factory Desk 消费。它没有新增导演中心、流程图编辑器、第二 Factory 或执行权。W68 max/legacy、W73h soak、Hub、统一导入与外部工具仍未迁移。下一建议波为 W73h，尚未批准。

## 2. 不可破坏的所有权

```text
W72 Asset Envelope / Capability Registry
  描述“是什么、谁提供、当前健康怎样”
  不执行、不派工、不保存 Production Run

W66 Agent Harness
  执行 Agent Session，负责 start/cancel/dispose/result/lifecycle
  不等于 Provider，不定义 Seat，不拥有 Factory Gate

W73 Factory Runtime
  消费任务、计划、资产、能力与执行器
  拥有本次运行状态、工件、Finding、Gate、成本、人工决定和 Production Run

W82 Organizational Compiler
  把方法和约束编译为 Execution Plan
  不执行计划，不持有 Runtime Instance 或 Run 真相

W74c Promotion
  显式把本地事实升格为可撤销、可追溯的资产或公共证据投影
  Factory seal 不等于 Promotion

W69 Hub / AI Market
  查询显式公开的 evidence projection
  不托管私有 Run 真相，不在 Hub 内再造 Factory
```

固定不等式：

```text
Model != Provider != Harness != Seat
Capability != Executor
Execution Plan != Production Run
Factory Pass != Human Final != Promotion != Publication != Canon
Health Metric != KPI verdict != Ranking
```

## 3. 现有 W68 基座

| 已落地基座 | 代码事实 | W73 处理 |
|---|---|---|
| 三轮主环与退骨 | `runW68Review()`；三轮不收敛返回 skeleton | 原样复用；只补 run/rework identity |
| 修订单与保护项 | `buildRepairOrder()`、`validateRepairRevision()` | 扩成可查询的 rework lineage，不重写修订器 |
| M2/M4/M5/M6 与四闸 | point/review/objection/answer/verdict artifacts | 继续作为唯一审理语义 |
| 预算硬闸 | `ReviewBudgetLedger`、budget stop/degrade | 补 actual/estimate/price version，不删现有 token cap |
| 工件落盘 | W68 artifact names、Factory archive、成本台账 | 用引用纳入 Run；正文不复制进万能 JSON |
| 队列与并发 | `runTaskPool()`、并发 1–4、pause/retry | W73e 在其上增加显式调度理由和背压 |
| 闭集 Agent | `AgentRuntime`、最多六步、危险动作确认 | 内部动作可先记 Run；外部执行等待 W66 真 Adapter |
| 七项健康指标 | `FACTORY_HEALTH_METRICS` | 保留趋势语义；W73f 补版本、归因与防 Goodhart |
| Provider 路由 | Provider/model/role 显式路由与错误 | 记入 boundary event；不得冒充 Harness/Seat |

机器审计对恢复出的 22 项给出：`LANDED 1 / PARTIAL 10 / METHOD_ASSET 6 / POST_W71 3 / OBSOLETE 2`。这组数不是产品分数，而是防止把半落地能力重写、把远期路线偷渡或把旧方向复活。

## 4. W73 的最小事实模型

### 4.1 文件优先，不建万能数据库

首版采用“一个运行一个目录 + append-only 事件 + 小型快照”的本地事实模型。既有正文、蓝图、审理表和成本文件仍是各自真相；Ledger 只保存身份、引用、状态迁移和证据摘要。

建议布局：

```text
<factory-project>/.mazz/runs/<runId>/
├─ run.json                    # 稳定身份与当前可重建快照
├─ events.ndjson               # append-only 状态迁移
├─ findings.ndjson             # Finding / AuditFlag / Resolution
├─ economics.ndjson            # estimate / provider usage / actual
└─ references.json             # Artifact / Asset / Capability 引用，不复制正文
```

禁止把所有工件正文、Prompt、模型思维链、密钥或整个 Workspace 塞进 run 文件。

### 4.2 ProductionRun v0 必备字段

```text
schemaVersion
runId / taskId / projectId
createdAt / startedAt / endedAt
status: proposed | running | paused | blocked | failed | completed | cancelled
workflowRef? / workflowVersion?
domain / taskType / projectContextRef?
governanceProfile / budgetProfile
inputArtifactRefs[] / outputArtifactRefs[]
seatAssignments[]
executorRefs[]
providerBoundaryEvents[]
gateRefs[] / findingRefs[] / reworkRefs[]
humanDecisions[]
economicsSummary
recoveryState
provenance
```

身份引用必须拆开：

```text
seatAssignment = {
  seatId,
  qualificationRef?,
  executorRef,
  modelRef?,
  providerRef?,
  harnessSessionRef?,
  capabilityRef?,
  routeReason,
  manualOverride?
}
```

未知值写 `UNKNOWN` 或缺省并附原因；不得从模型名猜 Provider、从 Provider 路由猜 Seat、从一次成功猜持证。

### 4.3 事件规则

每条事件至少有：

```text
eventId / runId / sequence / occurredAt
type / actorRef / authorityRef?
fromStatus? / toStatus?
artifactRefs[] / findingRefs[]
reasonCode / message
sourceRef / provenance
```

规则：

1. `sequence` 在单 run 内严格递增；重复写入由 `eventId` 幂等拒绝。
2. 当前快照可由事件重放；快照损坏不毁事件。
3. 终态之后只允许 addendum、evidence projection reference 或显式 reopen；不得静默改历史。
4. Provider raw response 只保存受控引用或哈希；密钥、Authorization、环境变量和未脱敏私人内容不得入账。
5. crash 后存在未闭合 execution 时进入 `blocked/recovery-required`，不能伪报 completed。

### 4.4 Finding、Rework 与 AuditFlag

统一的是证据外壳，不是把不同语义压成同一字符串：

```text
Finding {
  findingId, runId, kind, severity,
  artifactRef, anchorRef?, evidenceRefs[],
  ruleRef?, raisedBy, raisedAt,
  status: open | accepted | disputed | resolved | waived,
  authorityRef?, resolutionRef?
}

Rework {
  reworkId, runId, triggerFindingRefs[],
  stage: skeleton | draft | point | review | final,
  reasonCode, affectedArtifactRefs[], protectionRefs[],
  assignedSeatRef, attempt, parentReworkRef?,
  beforeRefs[], afterRefs[], verificationRefs[], status
}
```

幻锚首批类型至少分：`missing-source`、`wrong-source`、`stale-source`、`authority-mismatch`、`dead-proposal-revival`、`self-certification`。每一项必须指向可打开的 Evidence；“模型说有来源”不是来源。

## 5. 分波施工

### W73a — 现状—设计差额审计与规格

状态：本变更完成。

交付：22 项机器矩阵、所有权边界、W73b–h 依赖图、守门测试。退出 Gate：每项有唯一分类、归属、代码证据和不得误写的结论。

### W73b — Production Run Identity & Append-only Ledger

状态：`COMPLETE`。入口：W73a 完成；W72 协议已冻结。W66 真 Adapter、W69、W74、W82 均不是本波前件。

只接一条现有 W68 生产路径做双写 PoC：

1. 冻结 `ProductionRun v0`、event、reference 和 recovery schema；
2. 为旧任务生成稳定 runId，不改原 task id；
3. 旧 W68 文件继续写，Run Ledger 只旁路记账；
4. 能从磁盘重开并核对 artifact/gate/budget/provider boundary；
5. 新账写失败时不伪报成功，也不损伤旧 W68 工件；
6. 证明关闭/崩溃/取消后无孤儿 writer/listener/timer。

退出 Gate：同一 run 可 create → start → gate → seal/fail → reopen；事件可重放，旧 W68 结果不变，关闭后资源归零。回滚：关掉双写开关后旧主链仍完整可用，已写账本保留为可检查证据。

实际实现坐标：

- `renderer/modules/factory/production-run.js` 冻结 `ProductionRun/Event/Reference v0`、严格字段、secret 拒绝、状态迁移、事件重放、写串行化、损坏尾隔离、orphan running 恢复与 dispose；
- `renderer/modules/factory/index.js` 只在 `W68_PROTOCOL && mode != max` 时创建 Run；审理工件只按路径引用，完成账先于任务 `done`；缺账直接阻断；
- 目录为 `<factory-project>/.mazz/runs/<runId>/`，五件套是 `run.json / events.ndjson / findings.ndjson / economics.ndjson / references.json`；W73c 已取得 findings，W73f 已取得 economics，正文仍只由引用连接；
- Provider 边界只登记 `route-requested-not-observed`，不把配置路由冒充实际执行，也不保存 API key/baseURL；
- event log 先于 snapshot/reference 写入；后两者写失败会将内存账标为 `requiresReload`，禁止继续覆盖，重开后从事件补回；
- 损坏尾隔离到 `corrupt-tail.txt` 并转 `blocked`，中段损坏硬拒绝；重开未闭合 `running` 先转 recovery-required。

完整证据见 [`W73B_PRODUCTION_RUN_CHECKPOINT_2026-08-17.md`](./W73B_PRODUCTION_RUN_CHECKPOINT_2026-08-17.md)。

### W73c — Rework & Audit Discipline

状态：`COMPLETE`。入口：W73b。

把既有修订单、机检、对点、审理、判例和保护项挂到 Run：

- 标准化 rework stage/reason/lineage/affected set；
- audit flag 有提出、争议、解决、豁免和 authority；
- 修复完成后固定执行 residue scan 与复审；
- 幻锚 Finding 必须有 source/anchor/evidence；
- 三轮不收敛继续退骨并请求人类，不增加无限重试。

退出 Gate：任一返工可回答“谁因何证据要求改什么、保护什么、改前改后是什么、谁复验”；恢复后未结旗语不丢。

实际实现：

- `renderer/modules/factory/review.js` 保持原修订单字段与四闸语义不变，只在每次真实机检/对点回炉后补充 `reworkHistory`：stage、reason、执行席、attempt、改前/改后正文和确定性 residue scan；下一轮原有机检与 M2 对点继续承担复审；
- `renderer/modules/factory/rework-audit.js` 冻结 `mazz.rework-audit-record/v0`，以 append-only `findings.ndjson` 记录 Finding 提出、状态改变、Rework、人工升级和审计恢复；六类幻锚全部强制 `sourceRef + anchorRef + evidenceRefs`；
- `renderer/modules/factory/index.js` 在 W68 十一类旧工件写完后旁路落审计账与 `回炉记录/Rnn-改前.md、改后.md、复验.json`，再把 finding/rework 引用挂回同一 Production Run；正文不进入 NDJSON；
- Finding 状态只允许 `open → accepted/disputed/resolved/waived` 的冻结迁移；提出、争议、解决、豁免均需证据，状态改变需 authority；`open/disputed/accepted` 在重开后仍算未结；
- 审计账精确重复幂等，同键异义拒绝；并发批次串行；尾损坏隔离到 `findings-corrupt-tail.txt` 并把 Run 保持 `blocked`，中段损坏硬拒绝；恢复记录没有被暗自清除；
- 三轮不收敛仍由 W68 原逻辑退骨，W73c 只记一次 `human-escalation-requested`，不增加重试；W68 max/legacy、资格、外部委托、调度、KPI、Router、Hub 均未进入本波。

完整证据见 [`W73C_REWORK_AUDIT_CHECKPOINT_2026-08-17.md`](./W73C_REWORK_AUDIT_CHECKPOINT_2026-08-17.md)。

### W73d — Qualification & Delegation

状态：`COMPLETE`。入口：W73b。外部 Agent 执行子门禁另依赖 W66 至少一个真实 Adapter；没有真 Adapter 时必须显示 `BLOCKED: HARNESS_UNAVAILABLE`。

- `QualificationDefinition/Attempt/Certificate` 分离；
- probe pack、版本、分数、证据、适用 Seat、有效期和撤销明确；
- 人工 Authority 可签发/撤销，模型和 Provider 不可自证；
- 内部闭集 AgentRuntime 接入 run/task evidence；
- 外部任务只能经 W66 Harness Session，保留 cancel/dispose/result provenance。

退出 Gate：未持证不能进入受限 Seat；过期/撤销即时阻断新派工；外部执行失败不会被改写成 Provider 成功。

实际实现：

- `renderer/modules/factory/qualification-delegation.js` 冻结 `mazz.qualification-record/v0` 与 `mazz.delegation-record/v0`；Definition、Attempt、Certificate 使用不同身份，probe pack/version、passing score/actual score、evidence、Seat applicability、valid-from/expiry/revocation 均为严格字段；
- 证书签发与撤销只接受 `human:*` Authority。模型、Provider、未知字段、secret、分数/结果不一致、未通过 Attempt 签证、超范围 Seat 全部在代码层拒绝；
- 项目级 `<factory-project>/.mazz/qualifications.ndjson` 可跨同项目 Run 复用；单 Run `<run>/delegations.ndjson` 只记 assignment 与执行生命周期，不复制指令正文或结果正文；
- 受限 Seat 在 assignment 之前检查证书、executor、Seat、有效期与撤销；未持证、错执行器、错 Seat、未生效、过期或撤销均合法 BLOCKED，绝不暗降为任意模型；
- `FactoryPanel.delegateInternalAgent()` 只接现有闭集 `AgentRuntime`，把 task/instruction/result evidence 引回同一 Production Run；max/legacy 不迁移；
- `FactoryPanel.delegateExternalAgent()` 只经 preload 白名单后的 W66 Harness IPC；有 Adapter 时必须保留 Adapter/Session/result/cancel/dispose provenance，失败记录为 Harness/Executor failure，不生成 Provider success；当前产品 Adapter=0，因此真产品路径固定返回 `BLOCKED: HARNESS_UNAVAILABLE` 且零 Session 创建；
- 两类账均串行、幂等、可重开；同键异义、中段损坏拒绝，尾损坏隔离并让 Production Run 保持 recovery-required；dispose 后 active writer / active external session 回零；
- Production Run v0 只增加 `qualification-recorded` / `delegation-recorded` 与引用数组，不取得证书正文或执行结果正文，也没有引入 W73e Scheduler、W73f KPI、W73g Protocol Asset、W69/W70/W79/W82。

完整证据见 [`W73D_QUALIFICATION_DELEGATION_CHECKPOINT_2026-08-17.md`](./W73D_QUALIFICATION_DELEGATION_CHECKPOINT_2026-08-17.md)。

### W73e — Joint Scheduler & Elastic Staffing

状态：`COMPLETE`。入口：W73b、W73d、W72 Registry；外部 executor 路线继续服从 W66/W79 可用性。

调度输入：Seat requirement、Capability requirement、qualification、health、budget、priority、backpressure、risk、manual lock。输出不是“最佳模型”，而是：

```text
候选集合 + 排除理由 + 推荐 + 备选 + 证据窗口
+ 预计成本/延迟 + 置信度 + 用户覆盖 + 最终决定
```

AUTO 只提议；必须可禁 Provider、锁 executor、改预算或选备选。无合格 executor 时合法结果是 BLOCKED，不是暗降到任意模型。

退出 Gate：同一输入可重算同一候选；每次路由可解释；并发、取消、背压和恢复不破坏旧任务池。

实际实现：

- `renderer/modules/factory/joint-scheduler.js` 冻结 `mazz.scheduler-request/v0`、`mazz.scheduler-proposal/v0` 与 `mazz.scheduler-record/v0`；候选必须携带 W72 `mazz.capability-provider/v0` 快照，Seat / Capability / Qualification / Health / Budget / Backpressure / Risk / Manual Lock 分别给出排除理由；
- 排序使用公开、确定性的字典序规则，不生成 One Overall Score。输出同时保留候选、排除、推荐、备选、证据窗口、预计成本/延迟和 confidence；相同输入可逐字重算；
- AUTO 只创建 proposal；最终决定必须由 `human:*` Authority 作出。多个可用候选若未显式选择则拒绝继续；选择备选必须保存覆盖理由；禁 Provider、锁 executor 与改预算均通过输入重算，不绕过资格/健康硬闸；
- 单 Run `<run>/scheduling.ndjson` 以 append-only 记录 proposal、human decision、dispatch start/reject/release 与 recovery acknowledgement；Production Run v0 只增加 `scheduling-recorded`、`run-blocked` 和 `scheduleRefs`，不复制工件正文；
- 调度账支持精确幂等、并发串行、损坏尾隔离、中段损坏拒绝；重开存在未释放 dispatch 时合法进入 recovery-required，只有 human Authority + evidence 可把孤儿标为 abandoned；
- `ElasticStaffingCoordinator` 只给现有 worker pool 发 1–4 路旁路 lease；缩容不强杀在途，新增派工受背压，release/cancel/dispose 归零。`runningTasks`、AbortController 与 W68 task pool 继续拥有实际执行；
- `FactoryPanel.runTaskPool()` 仅按显式 priority 稳定排序，并在 W68 单次任务开工前写入调度决定；无健康/合格 executor 时写 `BLOCKED`，不暗降模型。max/legacy、W73f KPI/Router、W73g Protocol Asset、W73h soak 与 W69/W74/W79/W82 均未进入本波。

完整证据见 [`W73E_JOINT_SCHEDULER_CHECKPOINT_2026-08-17.md`](./W73E_JOINT_SCHEDULER_CHECKPOINT_2026-08-17.md)。

### W73f — Cost, KPI & Local Evaluation

状态：`COMPLETE`。入口：W73b、W73c；真实样本不足时可以完成协议但不能宣称排名有效。

- 成本分 `estimate / provider-reported / settled-actual / unknown`；
- price table、currency、effective date、provider usage version 在位；
- MetricDefinition 与 Formula 都带版本、样本窗和适用上下文；
- Raw Ability、Governance Uplift、Final Quality、Governance Dependency 分轴；
- Reliability、Cost、Latency、Revision Cost、Canon Compliance 分轴；
- Production/Author/Audience 三张成绩单不互相替代；
- 提供 Pareto，不提供 One Overall Score；
- KPI 先用于系统健康，不自动奖惩 Seat、改 Gate 或改方法。

退出 Gate：任一视图可钻回 Sample → Run → Task → Artifact → Finding/Gate → Human Decision；公式变更可对旧记录重算且保留旧结果。

实际实现：

- `renderer/modules/factory/economics-evaluation.js` 冻结 `mazz.economics-evaluation-record/v0`、`mazz.cost-record/v0`、`mazz.price-table/v0`、`mazz.metric-definition/v0`、`mazz.metric-formula/v0` 与 `mazz.local-evaluation/v0`；字段闭集、secret 拒绝、版本引用、确定性重算和 evidence window 都在代码层执行；
- 成本只允许 `estimate / provider-reported / settled-actual / unknown` 四种事实。W68 `ReviewBudgetLedger` 的字符折算明确写为 `estimate + w68.review-budget-char-estimate/v0`，金额保持 unknown；供应商回报必须有 provider、usage version 与 evidence，结算实付必须有 settled amount 与 evidence；四类汇总不生成 combined total；
- Price table 显式保存 provider/model、currency、effective-from/to、版本、输入/输出单价与 sourceRef；没有真实表时不猜金额。现仓没有可信 Provider usage 或账单样本，因此本波只证明协议和本地估算链有效，不宣称 actual coverage；
- 标准目录覆盖 Raw Ability、Governance Uplift、Final Quality、Governance Dependency、Reliability、Cost、Latency、Revision Cost、Canon Compliance 九轴；MetricDefinition 冻结 scorecard、样本窗、适用上下文，Formula 独立版本化；seat/executor/provider/model/workflow version/defect class 可归因；
- Production、Author、Audience 保持三张独立成绩单；原始能力、治理增益、治理依赖、作者接受度与受众接受度在缺匹配样本或人工决定时保持 unknown，可靠性样本不足时保持 insufficient-sample；
- 七项 `FACTORY_HEALTH_METRICS` 获得 system-health 版本定义，描述中硬钉“不得自动处罚 Seat、改 Gate 或改方法”；该类 KPI 不参与业务成绩单或调度决定；
- `computeParetoFrontier()` 只返回非支配前沿、支配证据和缺轴排除；`overallScore` 固定为 null，未引入 hidden Router；
- 单 Run `economics.ndjson` 保存目录、成本与评价；精确重复幂等、同键异义拒绝、写入串行、损坏尾隔离、中段损坏拒绝、human + evidence 恢复和 dispose 等待在飞写均通过。Production Run v0 只新增 `economics-recorded / evaluation-recorded` 与引用数组，不取得评价正文；
- W68 单次审理完成 W73c 审计后旁路登记成本与评价，再继续原 `review-recorded`；Finding/Rework 使用真实 W73c 引用，成本证据指向项目 `成本台账.json`。max/legacy、W73g/h、W69/W74/W79/W82、UI、排行榜与真实外部执行均未进入本波。

完整证据见 [`W73F_COST_KPI_LOCAL_EVALUATION_CHECKPOINT_2026-08-17.md`](./W73F_COST_KPI_LOCAL_EVALUATION_CHECKPOINT_2026-08-17.md)。

### W73g — Director & Process Protocol Assets

状态：`COMPLETE`。入口：W73b、W72 Asset Envelope。

只定义可读、可 diff 的 protocol assets：Director table、handoff、exception、artifact chain、gate/recovery projection。显示仍进入现有 Factory Desk；不建设新“导演中心”、新流程图编辑器或第二 Factory 壳。W82 将来可以编译更完整的组织图，但不反向取得 Run 所有权。

退出 Gate：protocol asset 可保存、重开、版本化；引用现有 Run/Artifact/Gate；删除视图不删除事实。

实际实现：

- `renderer/modules/factory/process-protocol-assets.js` 冻结 `mazz.factory-process-protocol/v0` 与 `mazz.factory-process-protocol-projection/v0`。项目级 W68 协议含 7 个 Director stage、7 条 handoff、6 类 exception、12 个 artifact role、4 个既有 W68 Gate 与 6 个恢复点；所有 Exception 明确 `automaticFallback=false`；
- 项目级定义落在 `<factory-project>/.mazz/protocols/w68-governed-review/1.0.0/`，同一 `protocolId/version` 内容冲突拒绝覆盖；JSON、Asset Envelope 与普通 Markdown README 三件并存，可重开且逐字 diff；
- Run 投影落在 `<run>/process-protocol/run-seq-NNNNNN/`，按 Production Run `sequence` 留存历史版本，只引用现有 Artifact/Gate/Finding/Rework/recovery，不复制正文或取得事实所有权；删除视图或投影不删除 Run、领域工件或项目级协议；
- 两类资产都生成 `mazz.asset-envelope/v0`，分别以 `describesWorkflow`、`projectsRun`、`usesProtocol` 关系连接 W68 与当前 Run；这只是 W72 薄包络，不建立全局资产注册表或 Universal Graph；
- `ProductionRun v0` 只增加 `protocol-assets-recorded` 与 `protocolRefs[]`。初次登记和有新 Run 事实时生成可追溯投影；终态只刷新派生投影，不向已完成 Run 追加幽灵事件；
- `FactoryPanel.ensureProductionRun()` 继续是唯一接线入口；原 `工厂群.md` 获得幂等的 `process-protocol` 系统卡，Factory Desk 沿原 archive 加载链读取协议摘要与可读文件路径。没有新增 Module Registry 项、IPC、BrowserWindow、导演中心或第二 Factory 壳；
- schema 未知字段、secret、悬空 Stage/Gate/Artifact/Exception/Recovery 引用全部拒绝；Provider/Model/Harness/Executor 不被写成 Director 身份，协议不调用 `chatStream`、Agent Session、外部工具或 Router；
- max/legacy、W73h soak、W82 Compiler、W64 Persona presentation、W69/W74/W79 均未进入本波。

完整证据见 [`W73G_DIRECTOR_PROCESS_PROTOCOL_ASSETS_CHECKPOINT_2026-08-17.md`](./W73G_DIRECTOR_PROCESS_PROTOCOL_ASSETS_CHECKPOINT_2026-08-17.md)。

### W73h — Integration, Recovery & Soak

入口：W73c–g。

验证矩阵：

```text
create / start / pause / resume / cancel / fail / retry / seal / reopen
provider slow / offline / partial SSE / refusal / truncation / permission
budget degrade / budget stop / no qualified executor / backpressure
renderer crash / whole-app crash / app quit / corrupted ledger tail
20 task cycles / 20 open-close cycles / multi-window owner transfer
```

退出 Gate：旧 W68 合同全绿；Run 无幽灵终态；Ledger 可恢复或报告明确损坏；ResourceLedger、Harness Session、writer/listener/timer 回基线；无 P0/P1 数据可靠性缺陷。

## 6. 跨波次路由

| 项目 | W73 只做 | 真正所有者 |
|---|---|---|
| 统一导入 | 消费显式 AssetRef | W74a |
| Feed / 投喂 | 消费已登记输入 | W74b / W62e |
| Promotion | 暴露 eligible evidence refs，不自动升格 | W74c |
| 公共 AI Market | 保存本地事实，不上传 | W69j/k/l |
| Product Persona / 厂花 | 可引用 protocol asset | W64 |
| Graph/Cognition | 可提供只读 Finding/Evidence | W70；不作为 W73 前件 |
| 外部绘图/计算/Blender | 记录 capability invocation | W79 |
| 组织考古与 Execution Plan 编译 | 执行计划并记 Run | W82 |
| `.maz` 可移植生产资料 | 只引用 Definition，不保存 Runtime Instance | W84 |
| Context/Coverage 编译 | 消费可寻址上下文包 | W85 |

## 7. 数据、隐私与安全 Gate

1. Run 默认本地、按项目隔离；无显式 Promotion 不离开机器。
2. API key、Authorization、secret store value、原始环境变量永不进 Ledger。
3. Prompt/response 如需保留，只存受控 artifact reference、内容 hash、脱敏状态和 retention policy。
4. 删除/覆盖/发布/Canon/财务签发等动作继续要求 Authority；Router 无 override。
5. `events.ndjson` 尾部损坏必须可截断到最后一条合法记录并保留损坏证据；不得静默吞错。
6. 写盘采用临时文件 + 原子替换或 append + flush 的明示策略；异常写入不破坏旧 W68 工件。
7. Ledger schema migration 先 dry-run、备份、可回滚；v0 施工不做全仓历史迁移。

## 8. 测试层级

| 层 | 最低证据 |
|---|---|
| Schema contract | 枚举、必填、未知字段、版本、身份分离、禁止 secret |
| Unit | event reducer、idempotency、sequence、cost/metric recompute、route explanation |
| Roundtrip | create/save/reopen/replay；旧 W68 artifact reference 守恒 |
| Integration | 一条真实 W68 生产线双写，seal/fail/cancel 三路 |
| Fault | 慢、断、半包、损坏尾、预算停、无 executor、crash |
| Electron E2E | Factory Desk 可钻取且现有交互不回退 |
| Soak | 20 次生产/关闭；资源、Session、writer/listener/timer 回基线 |

每个波次必须同时提交：schema/ADR、实现、contract、roundtrip、故障证据、资源账、回滚说明、总表回写。只添页面或只添 JSON 类型不算完成。

## 9. 停工条件

出现以下任一项，应停止当前波而不是继续扩大：

- 需要重写 `runW68Review()` 才能接 Ledger；
- 两个模块同时宣称拥有 Run 终态；
- 必须把工件正文复制进通用 JSON；
- 需要把 Provider 当 Harness 或把 Model 当 Seat 才能继续；
- AUTO 无法解释候选、排除理由或人工覆盖；
- Promotion/Publication/Canon 被 seal 隐式触发；
- 测试只能靠删除历史 workaround、跳过故障或重试掩盖红灯；
- W73 施工要求先实现 W69 Hub、W74 全管线、W82 Compiler 或 W79 工具运行时。

## 10. W73 Definition of Done

W73 只有在以下可测试条件全部成立时才能标记完成：

1. 一条且只有一条本地 Production Run 真相链；现有 W68 审理和工件仍是唯一业务内核。
2. Run、Event、Finding、Rework、Qualification、Assignment、Economics、Metric 与 Process Protocol/Projection 均版本化、可重开、可追溯。
3. 外部 Agent 委托只经真实 W66 Harness；不可用时明确 BLOCKED。
4. Router 的候选、证据窗、成本、风险、置信度和覆盖决定可复验；没有 hidden AUTO。
5. cost actual 与 estimate 分开；未知不伪造；Metric/Formula 可重算且无 Overall Score。
6. 任一评价可钻回真实 Run、工件、审理、修订与人工决定。
7. seal 不自动 Promotion/Publication/Canon；W69 下线不损伤本地历史。
8. crash/resume/cancel/损坏尾/预算停/无 executor 路径通过；20 轮资源回基线。
9. W68 既有合同与正式主路径无回退；没有第二 Factory、万能数据库或身份混写。
10. W74/W79/W82/W69/W64 的外部项仍在其波次，不以占位按钮或半成品入口冒充 W73 完成。
