# W85 Context Compiler & Coverage Accounting
## Addressable Context + Prospective Memory / 可寻址上下文与前瞻记忆

> 状态：`W85a–W85e LOCAL CONTEXT COMPILER + COVERAGE LANDED`
> 版本：v0.2
> 登记日期：2026-08-16
> 来源：维护者《从内容网络、World、组织编译器到 .maz 生产资料标准》
> 原始 SHA-256：`79A1588A2971E134B6CEB1CFD02AC4D27AB4981968A0E46285DEA0EE3D039408`
> 严格增量 II：维护者《Externalized Organizational Truth / Supersession Semantics》，SHA-256 `98EDCEBFE850836AD9ED96AC3D99F9C43BAD72BC6E5EFE22D547871CDCE450C0`
> 跨波次真源：`C:\Users\Administrator\Downloads\交付区\Mazz 当前未落地全景-W71归并版.md`

## 0. 三个不可混写

```text
Context != Plan
Memory != State
Reasoning != Coverage
```

更大的上下文窗口只能提高可携带容量，不能证明模型看到了权威版本、记住全部后续义务或完成了任何事项。W85 的目标是把长上下文变成 High-capacity Addressable Memory，并以 Coverage Accounting 防止第 34–47 项从注意力中掉出。

外置的目标不只防 Forgetting，还要防 Temporal / Version / Authority Misbinding：模型可能记得一句旧策略，却把它错误绑定为当前验收线。Conversation 是历史材料，不是 Operational Truth。

## 1. Context Compiler

```text
Task + Workspace + Checkpoint + Seat + Budget
                         ↓ compile
authoritative state
relevant assets / anchors
constraints / architecture locks
recent delta
known conflicts / unknowns
provenance
excluded stale material
coverage obligations
```

Compiler 输出可解释的 Context Package；每个进入或排除的材料都有 reason、sourceRef、version/mtime/hash、token estimate 和 freshness。它不生成业务结论，也不成为事实数据库。

## 2. 输入真源与优先级

候选来源按任务显式配置：

```text
Repository / symbol evidence
Blueprint / ADR / authoritative spec
Runtime State / Production Ledger
Checkpoint / recent delta
W75 retrieval candidates
W81 Episode / operational evidence
user-supplied material
historical discussion
```

权威与相关性分开评分：一份高相关旧讨论不能覆盖较新权威规格；一份权威总表也不必全文常驻。冲突必须进入 `knownConflicts`，不得静默选边。

### 2.1 Supersession Semantics

Decision、材料与结论必须显式区分：

```text
CURRENT       当前权威、可据此行动
SUPERSEDED    已被指定对象替代
HISTORICAL    只解释过去环境
PROPOSED      尚未批准
REJECTED      已明确不采用
INFERRED      系统推断，未取得 Authority
```

`SUPERSEDED` 必须指向 replacement、effective time、Authority 与 reason；新结论不得通过“时间较新”自动获得 CURRENT。典型约束：历史“80 分战略”可以解释高速扩张时期的资源分配，但不能覆盖当前“垂直深度可取舍、Electron 平台能力尽量逼近边界”的正式目标。

## 3. Context Package 最小契约

```text
contextPackageId
taskId / seatId / checkpointId
compilerVersion / policyVersion
budget / used / overflow

authoritativeRefs[]
relevantRefs[]
recentDelta[]
constraints[]
knownConflicts[]
unknowns[]
excludedRefs[{ ref, reason }]
coverageSnapshot
provenance
```

Context Package 默认短命、可重建、可导出检查；不把模型内部 conversation cache 当真相。敏感字段必须在编译前按 Seat permission 裁剪。

## 3.1 Externalized Organizational Truth

需要外置的不是一个笼统 Memory blob，而是相互分权的对象：

```text
Current SSoT          当前事实
Decision              已批准决定
Supersession          旧决定如何失效
Runtime State         实际做到哪里
Prospective State     还有什么必须发生
Evidence Ledger       什么已经证明完成
Provenance            来源、理由和版本
Authority / Locks     谁能改变、什么不可自由重解释
Checkpoint            中断后如何恢复
```

基本分工固定为：模型负责理解、推理、创造、提议和解释；系统负责版本、状态、权威、证据、覆盖率、完成与 provenance。凡影响生产连续性和验收的信息，不得只存在于聊天上下文。

```text
Discussion → Finding → Decision → External State
           → Rule / Contract → Machine Enforcement
```

Externalized State 是制度的前件，不是无限保存聊天记录。

## 4. Wave Graph = Prospective Memory

多波次全景的技术职责固定为：

```text
Blueprint        要造什么
Workflow         怎么造
Wave Graph       还有什么必须发生
Runtime State    实际做到哪
Evidence Ledger  哪些已经证明完成
Checkpoint       怎样恢复
```

Wave Graph 保存未来义务、依赖、退出 Gate、冻结区和授权状态，不保存运行细节。它是前瞻记忆，不是看板装饰，也不是把 TODO 列表重新命名。

## 5. Coverage Accounting

每项义务必须有稳定 ID 与可机读状态：

```text
REGISTERED
NOT_AUTHORIZED
READY
IN_PROGRESS
BLOCKED
EVIDENCED
WAIVED
SUPERSEDED
```

`EVIDENCED` 必须引用测试、工件、提交或人工验收；`WAIVED` 必须记录 Authority、理由与影响；`SUPERSEDED` 必须指向替代项。模型总结、口头“做完了”和上下文中出现过都不构成 Coverage。

Coverage 报告至少回答：

- 本轮授权范围有哪些 obligation；
- 哪些已取证、哪些未开始、哪些阻塞；
- 哪些依赖尚未满足；
- 哪些材料因过期、重复、无权或预算被排除；
- 本轮改名/拆分/取消是否同步到唯一总表；
- 是否存在“代码变了但 Gate/台账没变”或反向漂移。

## 6. Machine Governance 接口

Context Compiler 为执行者提供证据，不给予生效权。Machine Governance 消费 Context Package 和 Coverage Snapshot，实施：

```text
repository/symbol evidence before interface claims
Blueprint Authority before scope expansion
reuse inventory before new abstraction
mandatory tests before transition
architecture locks before destructive change
UNKNOWN/BLOCKED as valid state
diff scope / permission before mutation
destructive action authority before irreversible step
```

缺上下文的安全结果是 `UNKNOWN/BLOCKED` 或请求补证，不是用更长推理补全事实。

## 7. 与现有波次的边界

| 波次 | W85 消费 / 提供 | 禁止混写 |
|---|---|---|
| W66 Harness | 为 Seat/Agent 编译任务上下文 | Harness Session 不成为长期真相库 |
| W71 工程纪律 | 可试点文档 Coverage 检查 | 不因试点实施 Post-W71 Runtime |
| W73 Factory | 消费 Task/Run/Checkpoint，提供 coverage refs | Context 不等于 Production State |
| W75 Retrieval | 提供候选 Anchor/Evidence | 检索分数不等于 Authority |
| W81 Event Ledger | 提供 Episode/近期行为证据 | 行为证据不等于事实或计划 |
| W82 Compiler | 为 Organization/Seat 提供必要上下文 | Context Compiler 不编译组织或执行 Workflow |
| W84 `.maz` | 可把 Context Policy 作为 Definition 资产 | 不把活跃 Context Package 打进公开包 |

## 8. 施工拆波

### W85a — Vocabulary & Context Package Contract

冻结 Context/Plan/Memory/State/Coverage、CURRENT/SUPERSEDED/HISTORICAL/PROPOSED/REJECTED/INFERRED、source priority、conflict、exclusion 与敏感字段规则。

### W85b — Repository + Checkpoint Prototype

只对一个本地工程任务编译 spec、symbols、diff、checkpoint 和 constraints；输出 inspectable package，不调用模型。

### W85c — Wave Graph / Coverage Ledger

把唯一总表 obligation、依赖、授权、Gate、supersession 与 evidence 变成可对账投影；Markdown 仍可作为权威人读层，机器索引可重建。

### W85d — Harness Injection & Seat Policies

在 W66 真实 Adapter 稳定后，按 Seat permission 和 token budget 注入上下文；记录实际使用版本、overflow 与 exclusions。

### W85e — Retrieval / Event Consumers

最后接 W75/W81；候选证据必须可解释、可拒绝，不得把 shadow relation 或行为统计写回权威上下文。

## 9. Hard Validation Sample H

```text
40+ obligation multi-wave project
→ suspend at checkpoint
→ change 3 authoritative files and supersede 2 obligations
→ retain a conflicting historical strategy in the source set
→ resume in a fresh Agent Session with fixed context budget
→ compile current state + recent delta + conflicts + exclusions
→ execute one authorized wave
→ produce coverage report
```

退出条件：无未解释义务丢失；旧规格不覆盖新权威；CURRENT/SUPERSEDED/HISTORICAL 可追到 Authority 和替代链；未授权项不会进入施工清单；超预算材料有明确排除理由；EVIDENCED 均可追到证据；新 Session 不依赖旧聊天隐式记忆也能恢复。

## 10. 永久禁区

```text
× dump everything = context compilation
× chat history = authoritative state
× reasoning confidence = coverage
× retrieval score = truth / authority
× Wave Graph = Runtime State / Evidence Ledger
× 为省 token 静默丢弃 obligation
× 把 sensitive context 交给无权限 Seat
× Context Compiler 自动扩大任务授权
× 建设全知、常驻、默认云端的 Universal Memory Daemon
× 只因材料较新就自动标记 CURRENT
× 旧决定与新决定并存时靠模型“自行领会”替代 supersession
× 把 Conversation 保存完整视为 Externalized Organizational Truth
```

## 11. 当前停止线

本文件只登记 W85 v0.2、Supersession Semantics 与 Externalized Organizational Truth。W71 内只允许继续使用既有人工总表和检查点纪律，不得据此实现后台索引器、Context daemon、Agent 自动注入、长期记忆数据库、Decision service 或 Coverage 产品 UI。
