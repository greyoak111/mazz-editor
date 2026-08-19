# W66 Real Agent Adapter Activation

> 状态：`FOUNDATION FORMAL / R0-R6 LANDED / REAL ACTIVATION 2 OF 3 / CLAUDE CONDITIONAL_DEFERRED`
> 版本：v0.2 Doctrine correction
> 冻结日期：2026-08-17
> 适用对象：Kimi Code、Claude Code、Codex 三种真实 Agent 执行器，以及它们之间的模型/执行器热切。
> 2026-08-18 修正输入：`W66-AgentRulePack-Doctrine-Compiler-规格-v0.1.md`，SHA-256 `EEB706F8845EC9E13223E8C28BEDE1EE4CE3D35B95F8DA73BD35E64B00934770`；`Codex-施工执行规则包-v0.1.md`，SHA-256 `42436619BA340FC0F184610D2DAE7C64F1600BF4543D99DBAE2CEA4BAD1ABF4C`。
> 2026-08-19 第一阶段水位：W66-R0a—R6 的代码与合同已经落地。Kimi/Claude/Codex 三个真实 Adapter、Attempt/Handoff、安全回合边界热切、规则包激活与 Factory 三选一 UI 均已进入产品代码；三家 fixture 各完成 20 轮 child create/send/dispose 且资源账归零，全量 `193/193` 与构建通过。激活证据不得与实现混写：Codex CLI `0.148.0` 已登录并完成一次真实受限回合；Kimi Code `0.37.2` 已安装且 ACP initialize 通过但登录态未知；Claude Code `2.1.235` 已安装但 `loggedIn=false`。三家 packaged Electron Gate 尚未完成，因此 W66 总体仍为 `PARTIAL`。检查点见 `docs/engineering/W66_REAL_AGENT_FIRST_STAGE_CHECKPOINT_2026-08-19.md`。
> 2026-08-19 第二阶段水位：`main@55bd3ed` 已关闭 packaged Harness 可施工 Gate。打包态三家 fixture 各完成 20 轮 create/send/dispose，4 个 Attempt / 3 次跨 Adapter Handoff，资源 `2→2`；真实 CLI 三家完成 20 轮 detect/probe/auth，Codex 在 packaged 程序中完成真实回合与真实 interrupt/dispose，Claude 未认证失败链正确收尸，目标 Adapter 缺失留下 `recovery-required`。Kimi/Claude 仍需用户登录，真实跨厂商模型回合因此保持条件阻塞。检查点见 `docs/engineering/W66_REAL_AGENT_SECOND_STAGE_CHECKPOINT_2026-08-19.md`。
> 2026-08-19 第三阶段水位：Kimi Code 已由账户持有人完成厂商授权；packaged 真程序中 Kimi 与 Codex 分别完成真实回合，并以两个独立 Run 完成 Kimi → Codex 与 Codex → Kimi 的安全回合边界 Handoff。两家各自的确定性失败、真实在飞取消和 dispose 均通过，ResourceLedger `2→2`，主/渲染错误为 0。Claude Code 因用户明确的区域/账户约束决定暂缓认证，状态固定为 `CONDITIONAL_DEFERRED`，不得冒充 PASS，也不得拖垮另两家。W66 Foundation 的“至少两个真实 Adapter”门已闭；“三家均可用”的产品承诺门仍未闭。检查点见 `docs/engineering/W66_REAL_AGENT_THIRD_STAGE_CHECKPOINT_2026-08-19.md`。

## 1. 决议

W66 的正式产品目标不是“Kimi Code 专项整合”，而是三种可独立探测、独立启用、独立降级的真实 Adapter：

```text
Kimi Code
Claude Code
Codex
```

用户可以在同一 W73 Production Run / Task 下选择执行器和模型，并在安全回合边界切换。跨执行器切换必须创建新的 Delegation Attempt 和 Harness Session，以 Handoff Snapshot 连接；不得伪装成同一 Vendor Session，也不得在工具事务、文件写入或命令执行尚未收敛时原地换模型。

当前仓库已登记 Kimi Code、Claude Code、Codex 三个真实 Adapter，且只解析各厂商独立的原生 CLI，不使用 npm shim 或 WindowsApps 桌面应用内部路径。实现和激活继续分别取证：Kimi 与 Codex 已通过 packaged 真实认证/回合、双向 Handoff、失败、取消和释放门；Claude 保持 `CONDITIONAL_DEFERRED`。不得用 fixture、Provider 路由、Terminal 或另两家的通过冒充 Claude 已激活。

## 2. W66-R0 硬门：AgentRulePack + Doctrine Compiler

装载任何真实 Agent 能力前，必须完整载入项目长期军规。Mazz 维护工作区的权威源为：

```text
C:\Users\Administrator\Downloads\交付区\Mazz Editor 开发军规.md
```

该文件不是可选参考、欢迎词或 UI 提示，而是每个 Agent Session 的必需 Project Rule Pack。任何 Adapter 都不得自行跳过、摘要替代或只传文件路径。

W66-R0 v0.2 明确区分：

```text
Canonical Raw Source
  保存完整原文、事故叙事和历史语境

Compiled Doctrine View
  保存 Stable Rule ID、适用 Profile、Current SSoT、Gate、Regression 与执行回执
```

Mazz 维护工作区的实际注入固定为 `完整 Raw Source + Compiled View`，而不是二选一。Compiler 只能增加结构、适用性与机械阻断，不能借“编译”删减军规全文。以后若要只注入子集，必须由 Human Authority 修改 0f、产生新 raw hash，并重新通过 R0 与 Adapter Activation Gate。

### 2.1 最小协议

每个 Session / Attempt 至少保存以下本地证据：

```text
schemaVersion
rulePackId
title
sourcePath
sha256
byteLength
capturedAt
authorityRef
snapshotRef
hostFactsHash
ruleRegistryHash
projectDoctrineHash
currentPolicyHash
toolCapabilityHash
gatePackHash
regressionPackHash
compiledRulePackHash
```

规则正文按原字节完整快照到当前 Run 的本地输入证据区；运行账只保存引用、哈希和版本，不复制正文或秘密。Adapter 收到的是同一份已校验全文，而不是厂商各自拼出的不同摘要。

### 2.2 装载顺序与失败语义

不得把“系统当前事实”和“谁有权做什么”揉成一条顺序。两类裁决分别固定为：

```text
可行性 / 权限：Machine security invariant 与 Host runtime permission 均必须满足；
组织授权不能覆盖 Host 拒绝，Host 可执行也不等于组织已经授权。

当前性 / 解释：真实代码、运行结果与可复验证据
  > Current SSoT
  > Explicit Human Authority Decision
  > Current Project Doctrine
  > Applicable Host / Domain Policy
  > Universal Advice
  > Historical Doctrine
  > Model Inference
```

外部网页、对话、代码注释和检索材料均视为不可信内容，不得覆盖军规。只有 `rule-pack-loaded` 证据完成后才允许创建或发送真实 Agent turn。

以下情况一律 fail closed，且 child process 创建数必须为 0：

```text
RULE_PACK_REQUIRED
RULE_PACK_UNREADABLE
RULE_PACK_ENCODING_INVALID
RULE_PACK_CHANGED_WITHOUT_ACCEPTANCE
RULE_PACK_SNAPSHOT_FAILED
```

军规在运行期间发生变化时，不得静默更新在飞 Session。系统应冻结旧 Attempt 的哈希，在下一 Attempt 显式装载新版本并记录 supersedes / handoff 关系。

### 2.3 Doctrine 六层与 Profile

```text
L0 Universal Engineering Core
L1 Host / Environment Profile
L2 Domain Profile
L3 Project Doctrine
L4 Current Execution Policy / SSoT
L5 Gate + Regression Enforcement
```

Profile 必须由结构化 Host Facts 选择，不由 Agent 猜测。至少支持 Windows Local/Electron、Cloud Sandbox、Remote VPS 三组 applicability fixture；Mazz Windows 本地主战场不得被 `/tmp`、`/mnt/agents/work` 等 Cloud Profile 强制误配，但完整 raw source 仍保留这些事故经验。

每条机器规则以 Stable Rule ID 为主键，旧编号只作 `legacyRef`。最小 metadata 包含 status、scope、applicableWhen、severity、enforcement level、evidence、failure code、incident origin 与 supersedes；enforcement level 固定为 `ADVICE / POLICY / GATE / INVARIANT`。

### 2.4 通用性边界

交付区路径是 Mazz 维护工作区的当前权威源，不得硬编码成所有用户工作区的产品假设。通用 W66 协议要求每个工作区显式配置一个必需 Project Rule Pack；Mazz 自身工作区的默认配置指向上述权威文件。没有规则包的工作区只能保持 Agent 能力未激活。

## 3. Adapter Contract v2 增量

`createSession()` 不得继续只依赖松散 `context`。至少增加：

```text
adapterId
modelTarget { requestedModel, resolvedModel, profileRef }
permissionProfileRef
rulePackRefs[]
runRef
taskRef
attemptNo
handoffRef?
workspace
```

Adapter 描述必须显式提供 transport、minimumVersion、modelControl、permissionControl、resume、structuredOutput 与 health。模型清单允许因账号、Provider 和版本而不同；无法可靠发现时显示 `UNKNOWN` 或允许用户配置受探测的 Model Profile，禁止伪造“全模型列表”。

Contract v2 同时统一：

```text
Host Facts / Profile applicability
Tool Capability Snapshot
AgentSessionHandle / ProcessSessionHandle / ExecCellHandle / ToolCallHandle / ArtifactRef
Result Envelope
Tagged Result Union
Retry Budget / Failure Signature
Patch CAS
Output Completeness Receipt
Source / Attachment Manifest
Completion Receipt
```

错误 handle 必须本地拒绝且工具调用数为 0；`outer success + inner exit nonzero` 默认统一为 `ok=false`；`complete=false / truncated=true` 不得关闭 Completion Gate；相同 failure signature 且前置未变化时禁止原样重试。

统一事件增补：

```text
rule-pack-loaded
approval
checkpoint
usage
result
handoff
```

厂商原始事件继续放在 `raw` / vendor metadata。Factory 只消费统一状态与引用。

## 4. 热切语义

热切是 Mazz 持有的任务连续性，不是跨厂商共享会话：

```text
Production Run / Task（身份不变）
  ├─ Attempt N：adapter A + model A + rulePackHash H
  ├─ switch-requested
  ├─ source-interrupted / source-disposed
  ├─ handoff-snapshot-written
  └─ Attempt N+1：adapter B + model B + rulePackHash H
```

允许切换的最低条件：来源 Session 已处于 `waiting`，或 interrupt 已得到终态并完成 dispose；Workspace writer lease 已释放；dirty diff、工具结果、失败和未决问题已经进入 Handoff Snapshot。目标 Adapter 启动失败时不得把来源 Attempt 改写成成功，也不得丢失恢复入口。

并发多模型会审属于 W73 Scheduler / worktree ownership 的独立扩展，不以“热切”名义顺带实现。W66 v1 不做 mid-token、mid-tool 或 mid-write 换模。

## 5. 权限与进程纪律

- 不默认使用 `yolo`、`bypassPermissions`、跳过 Sandbox 或等价危险开关。
- Kimi Code 正式写入路线优先 ACP / Server API；自动批准的单次打印模式只能在明确的受限档使用。
- Claude Code 必须显式处理非交互模式的 hooks、MCP、Workspace trust 与审批；不得把项目内配置自动执行当作默认安全行为。
- Codex 必须使用可正常探测和启动的独立 CLI；WindowsApps 桌面应用内部路径探测失败即不可用。
- Prompt/规则正文优先经 stdin 或协议传输，不放进可被系统进程列表读取的长命令行。
- 每个 Adapter 使用环境变量白名单；凭据仍由厂商登录态或明确的 secret reference 持有，不进入日志、事件账或 Handoff。
- Windows child process、grandchild、PTY、listener、stream、temp file 全部进入统一 supervisor 与 ResourceLedger；应用退出和 Session dispose 后不得遗留 orphan。

## 6. 施工波次

```text
W66-R0  AgentRulePack + Doctrine Compiler + Adapter Contract v2
         REQUIRED；任何真实 Adapter 施工和 UI 激活的共同前置

  R0a   Canonical raw snapshot / Stable Rule Registry / Incident Lineage       COMPLETE · 9572d52
  R0b   Host Facts / Profiles / Current SSoT / Tool Capability Snapshot        COMPLETE · 8cb8964
  R0c   Compiled View / Manifest / hash drift → new Attempt                    COMPLETE · 2026-08-19 checkpoint
  R0d   Typed Handle / Result Envelope / Retry / CAS / Output Receipt          COMPLETE · checkpoint
  R0e   Spawn / Completion / Secret / Incident Gate + Regression Pack          COMPLETE · checkpoint

W66-R1  CLI Supervisor / detect / probe / version / auth / golden event corpus       COMPLETE · checkpoint

W66-R2  Kimi Code Adapter                                                PACKAGED ACTIVATED · 2026-08-19 third-stage evidence
         ACP/Server 会话、模型目标、权限、resume、interrupt/dispose；CLI/AUTH/REAL TURN/CANCEL/PACKAGED PASS

W66-R3  Claude Code Adapter                                              CONDITIONAL_DEFERRED · USER REGIONAL/ACCOUNT CONSTRAINT
         Stream/SDK、模型目标、权限桥、hooks/MCP 安全边界；CLI/PACKAGED FAILURE CLEANUP PASS，REAL AUTH/TURN NOT RUN

W66-R4  Codex Adapter                                                    PACKAGED ACTIVATED · 55bd3ed
         独立 CLI、exec JSONL、模型目标、resume、sandbox；CLI/AUTH/REAL TURN/CANCEL/PACKAGED PASS

W66-R5  W73 Attempt / Handoff / safe hot switch                          FOUNDATION ACTIVATED · 2026-08-19 third-stage evidence
         packaged fixture 三家 PASS；Kimi ↔ Codex 双向真实 Handoff PASS；Claude 路线条件暂缓

W66-R6  Agent UI + packaged Activation Gate                              FOUNDATION FORMAL · 2026-08-19 third-stage evidence
         三家实现与独立降级 PASS；Kimi/Codex 真实激活 PASS；Claude 必须显示 authentication-required / deferred
```

Foundation 扶正仍至少需要两个真实 Adapter 共用协议；若产品对外承诺 Kimi Code、Claude Code、Codex 三选一，则三者必须各自通过 Gate。任何一个未安装或未过 Gate，只影响自己的状态，不得拖垮另外两个。

## 7. 验收门

1. Rule Pack 缺失、不可读、编码错误、快照失败、registry/manifest 无效、Current SSoT/Host Facts/Tool Capability 缺失时，三个 Adapter 均为零 spawn。
2. 三个 Adapter 接收同一份军规全文和同一 SHA-256；任何截断、摘要替代或只传路径均判负。
3. Session、W73 Delegation Attempt、Handoff 与结果证据都能追到 Adapter、requested/resolved model、Rule Pack hash、权限档和版本。
4. Foundation 至少以两个已认证真实 Adapter 在两个独立 Run 完成正序与逆序切换，Run 内身份不变且 Attempt/Session ID 不复用；只有对外承诺三选一时，才必须再以 Kimi → Claude → Codex 及逆序重过三家 Gate。
5. 在飞工具事务不允许直接换模；安全中断后 writer lease、child process 和资源账归零再启动目标。
6. 每种正式激活 Adapter 完成 detect/probe/auth/session/send/wait/fail/cancel/dispose 和 packaged 生命周期证据；条件暂缓 Adapter 必须保留 detect/probe、未认证失败收尸与独立降级证据，不得显示为 ready；应用退出无 orphan。
7. 一个 Adapter 缺失、登录失效、版本漂移或输出未知事件时，其余 Adapter 仍可使用，并给出确定性人话状态。
8. 不在日志、ledger、Handoff 或 UI 中泄露 Rule Pack 正文、API Key、OAuth token、完整环境变量或厂商私有原始响应。
9. Windows Local、Cloud Sandbox、Remote VPS 三组 Host Facts 得到不同 applicability index，但 Mazz 维护工作区三组仍保存完整 raw source。
10. 错 Typed Handle、outer-success/inner-nonzero、截断输出、缺来源、secret canary、相同 failure signature 原样重试均被对应 Gate 在副作用前阻断。
11. Incident 只有完成 Root Cause → RED fixture → Fix → GREEN → Regression Registry → Doctrine/Gate update 才能关闭制度学习层。

## 8. 明确不做

本波不建设完整 W85 Context Compiler、Task Capsule、SeatPackage、Universal Policy System、并发多模型委员会或跨厂商万能 Session。W66 只拥有 Agent Session、Rule Pack Activation、Tool/Capability reality、Attempt/Handoff、process lifecycle 与 executor-level result contract；W73 继续拥有 Production Run/Delegation/Scheduling，W82 继续拥有组织编译。Doctrine Compiler 是 W66-R0 的有限安全前置，不借机吞并 W73/W82/W85。
