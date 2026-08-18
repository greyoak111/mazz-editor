# Mazz 三工程与 Doctrine 修正入库

> 状态：`DESIGN INTAKE COMPLETE / RUNTIME NOT IMPLEMENTED`
> 日期：2026-08-18
> 作用：登记三份维护者修正文献、冻结其对 W66/W73/W82 与施工纪律的影响，不把文献中的设计句子冒充产品能力。

## 1. Source Receipt

| 来源 | SHA-256 | 性质 |
|---|---|---|
| `C:\Users\Administrator\Downloads\Mazz-技术路线升格-从Agent到三工程与组织运行时-v0.1.md` | `0908423812CCC4DA07BDE35E4980569FA19C2869FB04EB2CA7EBFD24D3B89E80` | 三工程、Agent/Harness/Factory 边界、Staffing 与 Delegation Graph |
| `C:\Users\Administrator\Downloads\Codex-施工执行规则包-v0.1.md` | `42436619BA340FC0F184610D2DAE7C64F1600BF4543D99DBAE2CEA4BAD1ABF4C` | 军规之下的执行 Gate、回执与状态机工作稿 |
| `C:\Users\Administrator\Downloads\W66-AgentRulePack-Doctrine-Compiler-规格-v0.1.md` | `EEB706F8845EC9E13223E8C28BEDE1EE4CE3D35B95F8DA73BD35E64B00934770` | W66-R0 Doctrine Compiler 设计输入 |

三份文件中的标题、建议和伪代码是设计输入，不自动授予运行时、网络、发布、删除、外部 Agent 或 W82 施工权限。

## 2. 本轮正式采纳的修正

### 2.1 三工程

```text
人的思维工程       方法与高价值认知的可外置化
机器的智能工程     数字个体能力的可扩展化
组织工程           Human / Agent / Tool / Machine 生产关系的可执行化
```

三者正交互补。Mazz 是首个真实生产、事故和证据试验场，不因理论成立就宣称跨域假说已经证实。

### 2.2 身份与所有权

```text
Model != Agent
Agent != Harness
Seat != Executor
Executor != Harness
Harness != Tool
Sub-Agent != Child Seat
Staffing != Tool Routing
Delegation != Authority Transfer
Qualification != Delegable Credential
Multi-Agent != Factory
Self-correction != Institutional Learning
```

Seat 保存职责、输入输出、责任和 Gate；Staffing/Delegation 寻找实际 Executor；Harness 提供 Session、工具、权限和生命周期；Tool 提供确定性或结构化能力。

### 2.3 W66-R0

`AgentRulePack` 不再只等于“把一份 Markdown 放进 Prompt”。Mazz 维护工作区的注入物固定为：

```text
完整 Canonical Raw Source
+ Compiled Doctrine View
+ Current SSoT Snapshot
+ Host / Domain Profile
+ Tool Capability Snapshot
+ Gate / Regression obligations
+ Hash Manifest
```

完整原文仍是不可削弱兼容底线。Compiled View 只能解释适用性和机械义务，不能删除、摘要替代或暗改原文。

### 2.4 施工执行规则包

《Codex-施工执行规则包》是完整军规之下的执行层工作稿，采纳其 Preflight、Typed Handle、Result Envelope、Failure Signature、Patch CAS、Output Completeness、Acceptance Path、Incident Promotion 与 Completion Receipt。它不替代安全边界、当前 SSoT、完整军规或 Human Authority。

## 3. 波次与所有权映射

| 归属 | 新增或修正 | 状态 |
|---|---|---|
| W66-R0a | Canonical raw snapshot、stable rule registry、incident lineage | NOT STARTED |
| W66-R0b | Host Facts、Profile resolution、Current SSoT、Tool Capability snapshot | NOT STARTED |
| W66-R0c | Compiled view、manifest、hash/drift/new Attempt | NOT STARTED |
| W66-R0d | Typed Handle、Result Envelope、Tagged Result、retry/CAS/output receipt | NOT STARTED |
| W66-R0e | Spawn/Completion/Secret/Incident gates 与回归包 | NOT STARTED |
| W66-R1—R6 | Supervisor、三家真实 Adapter、安全热切、UI/packaged Gate | 保持既有顺序，NOT STARTED |
| W82a | 三工程 Kernel、Seat/Executor/Staffing/Delegation Contract | NOT APPROVED |
| W73 future extension | 执行时 Delegation Graph / Labor Supply Chain；复用现有 Run，不改写 W73a–h 已封事实 | DEFERRED / REQUIRES SEPARATE SPEC |
| W69 market | 只接显式公共投影与劳动力/能力市场视图，不拥有私有 Run 或资格真相 | NOT APPROVED |

## 4. Delegation Graph 冻结约束

未来嵌套委托至少要求：

```text
maxDelegationDepth
no delegation cycle
provenance on every hop
no implicit subcontract
Authority not inherited
Qualification not inherited
full-chain cost visibility
effective Task Contract for final Executor
parent Seat retains responsibility unless explicit Authority transfer
required child results received before COMPLETE
```

当前 W73a–h 仍按既有规格 `COMPLETE / SEALED TO SPEC`。上列是新增未来扩展，不反写成 W73 已实现，也不另造第二套 Production Run。

## 5. 停止线

- 不实现真实 Adapter、Doctrine Compiler、W82 Runtime、市场或嵌套转包。
- 不把 `DRAFT / DESIGN SPEC` 提升成 CURRENT 产品状态。
- 不用新理论覆盖 W65、W74c-3、W79、W82、W69、W64 等历史欠账。
- 不把“Agent 自纠”写成“制度已经学习”；事故只有进入 Doctrine + Gate + Regression 后才能关闭这一层复发债。
