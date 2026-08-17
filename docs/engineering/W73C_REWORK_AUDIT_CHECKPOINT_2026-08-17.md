# W73c Rework & Audit Discipline 检查点

> 日期：2026-08-17
> 开工基线：`main@b443908`
> 状态：`COMPLETE — ONE W68 SINGLE-PATH SLICE`
> 下一波：`W73d Qualification & Delegation — NOT APPROVED`

## 1. 交付结论

W73c 已在 W73b 的唯一 Production Run 事实链上补齐可重开、可追责的回炉与审计纪律。它消费现有 W68 机检、对点、修订单、保护项、质询、答辩和裁决结果，不重写 `runW68Review()` 的三轮主环、M2/M4/M5/M6 分工或四闸。

正式接入仍只有：

```text
W68 single task / mode != max
→ existing review and repair
→ W68 artifacts stay authoritative
→ Finding / AuditFlag / Rework records
→ before / after / residue evidence files
→ findingRefs / reworkRefs attach to the same Production Run
```

W68 max、legacy、资格、持证、外部 Harness、调度、成本评价、Router、Hub、Promotion 和 W70 Cognition 均未迁入。

## 2. 冻结合同

审计记录协议：`mazz.rework-audit-record/v0`。

记录类型闭集：

```text
finding-raised
finding-status-changed
rework-recorded
human-escalation-requested
audit-recovery-required
```

Finding 状态闭集：

```text
open → accepted / disputed / resolved / waived
disputed → accepted / resolved / waived
accepted → resolved / waived
resolved / waived → terminal
```

六类幻锚：

```text
missing-source
wrong-source
stale-source
authority-mismatch
dead-proposal-revival
self-certification
```

每项幻锚必须同时有 `sourceRef`、`anchorRef` 和 `evidenceRefs`。状态改变必须有 `authorityRef`、`resolutionRef` 和证据；未知字段、secret 字段、非法迁移和无改前/改后/复验证据的回炉一律拒绝。

## 3. 回炉证据链

现有 W68 每次机检或 M2 对点回炉会产生一条内部 `reworkHistory`。原修订单五字段没有改变，避免 W68 公共工件回归。W73c 通过现有 finding message、审理来源和工件引用完成旁路关联。

每次回炉落：

```text
<artifactDir>/回炉记录/
├─ R01-改前.md
├─ R01-改后.md
└─ R01-复验.json
```

`findings.ndjson` 只存引用、身份、原因、影响集合、保护引用、执行席、复验者、attempt、父回炉和状态，不复制改前/改后正文；保护项指回既有修订单而不复制字面内容，审计消息复用当前 Provider key 脱敏。于是任一 Rework 都能回答：

```text
谁要求 / 谁执行 / 谁复验
为什么改 / 哪个 Finding 触发
影响哪个工件 / 保护什么
改前与改后在哪里
residue scan 在哪里、结果是什么
上一轮回炉是谁
```

修后立即运行确定性 residue scan；随后仍进入 W68 原下一轮机检与 M2 对点。三轮未收敛继续退骨，W73c 只追加一个确定性人工升级记录，不建立无限重试器。

## 4. 恢复、幂等与资源纪律

1. 单 Run 的审计追加由 Promise queue 串行，sequence 连续。
2. 相同 `recordId` 且语义一致为幂等重放；同键异义硬拒绝。
3. 重开通过全账 replay 恢复 Finding 状态、Rework 和人工升级。
4. `open / disputed / accepted` 一律保留为未结；只有 `resolved / waived` 关闭。
5. 尾行损坏被隔离到 `findings-corrupt-tail.txt`，合法前缀和未结旗语保留，并追加 `audit-recovery-required`；对应 Run 保持 `blocked`。
6. 中段损坏说明历史顺序不可信，直接报错，不跳过、不猜测。
7. dispose 等待在飞写完成，释放后拒绝新追加，`activeWrites` 回到 0。
8. 本波不提供“自动解除恢复阻断”；人工检查和未来 W73h 恢复流程在明确证据前不能抹掉恢复记录。

## 5. W68 与 Factory 集成顺序

```text
writeW68Artifacts()
→ appendW73cAudit()
   → write rework evidence files
   → append findings.ndjson
   → append audit-recorded to Production Run
→ append review-recorded to Production Run
→ existing seal/block flow
```

若正式 W68 单次任务已有 Production Run 但缺少匹配的 Audit Ledger，报 `W73_AUDIT_LEDGER_MISSING`，不得无审计继续。审计尾损坏时 `ensureProductionRun()` 报 `W73_AUDIT_RECOVERY_REQUIRED`，任务保持暂停/阻断，不能被普通异常路径伪报 failed 或 completed。

## 6. 验证

定向验证：

```text
W73c rework-audit ledger          8 / 8
W73c Factory integration          4 / 4
W68a                              11 / 11
W68b                               9 / 9
W68c                               9 / 9
W73b ledger                       13 / 13
W73b Factory integration           4 / 4
W71 Factory lifecycle              6 / 6
```

覆盖：schema 闭集、六类幻锚三联、secret/未知字段拒绝、状态 authority、真实 W68 修后 residue、回炉九问、正文与引用分离、三轮退骨、未结状态重开、精确幂等、同键冲突、并发 sequence、损坏尾/中段、Factory 真路径、缺账阻断、Run 引用和 dispose 资源归零。

全量回归：`node tests/run.js`，`162/162` 个测试文件通过。运行期间 jsdom 仍会输出仓库既有的 Canvas 未实现提示，但测试文件失败数为 0；本波没有以忽略失败或重试掩盖红灯。

## 7. 回滚与未完成

回滚 W73c 旁路调用后，旧 W68 修订、十一类工件、正文封存和任务状态仍可独立运行；已经写出的 `findings.ndjson` 与回炉旁证保留为只读检查证据，不静默删除。

本波明确未完成：

- W68 max、多单元和 legacy 的审计迁移；
- W73d 资格、证书、Seat assignment 与 W66 外部委托；
- W73e 调度、弹性编制和 Router；
- W73f economics、actual cost、KPI、Metric/Formula 与本地测评；
- W73g Director/Process protocol asset；
- W73h packaged Electron、真实 crash 和 20 次生产 soak；
- W69/W70/W74/W79/W82 的任何远期能力。

下一波只能在维护者批准后进入 W73d；其中外部 Agent 执行仍必须等待至少一个真实 W66 Adapter，不能用 Provider 路由冒充 Harness。
