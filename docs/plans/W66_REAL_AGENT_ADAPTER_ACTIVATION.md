# W66 Real Agent Adapter Activation

> 状态：`PLANNED / REQUIRED BEFORE AGENT UI ACTIVATION`
> 冻结日期：2026-08-17
> 适用对象：Kimi Code、Claude Code、Codex 三种真实 Agent 执行器，以及它们之间的模型/执行器热切。

## 1. 决议

W66 的正式产品目标不是“Kimi Code 专项整合”，而是三种可独立探测、独立启用、独立降级的真实 Adapter：

```text
Kimi Code
Claude Code
Codex
```

用户可以在同一 W73 Production Run / Task 下选择执行器和模型，并在安全回合边界切换。跨执行器切换必须创建新的 Delegation Attempt 和 Harness Session，以 Handoff Snapshot 连接；不得伪装成同一 Vendor Session，也不得在工具事务、文件写入或命令执行尚未收敛时原地换模型。

当前仓库只有 `HarnessAdapter v1` Foundation，生产注册表仍为 0 个真实 Adapter。Kimi Code 与 Claude Code 当前未安装；本机能发现的 Codex WindowsApps 内部路径不可执行，版本探测返回 `EPERM`。实现和激活必须分别取证，不得用 fixture、Provider 路由、Terminal 或桌面应用内部可执行文件冒充真实 Adapter。

## 2. W66-R0 硬门：AgentRulePack 必载

装载任何真实 Agent 能力前，必须完整载入项目长期军规。Mazz 维护工作区的权威源为：

```text
C:\Users\Administrator\Downloads\交付区\Mazz Editor 开发军规.md
```

该文件不是可选参考、欢迎词或 UI 提示，而是每个 Agent Session 的必需 Project Rule Pack。任何 Adapter 都不得自行跳过、摘要替代或只传文件路径。

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
```

规则正文按原字节完整快照到当前 Run 的本地输入证据区；运行账只保存引用、哈希和版本，不复制正文或秘密。Adapter 收到的是同一份已校验全文，而不是厂商各自拼出的不同摘要。

### 2.2 装载顺序与失败语义

上下文优先级固定为：

```text
平台安全与 Sandbox
  > Project Rule Pack
  > Seat / Authority / Permission Profile
  > Task Instruction
  > Selected Materials / External Content
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

### 2.3 通用性边界

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
W66-R0  AgentRulePack 必载 + Adapter Contract v2
         REQUIRED；任何真实 Adapter 施工和 UI 激活的共同前置

W66-R1  CLI Supervisor / detect / probe / version / auth / golden event corpus

W66-R2  Kimi Code Adapter
         ACP/Server 会话、模型目标、权限、resume、interrupt/dispose

W66-R3  Claude Code Adapter
         Stream/SDK、模型目标、权限桥、hooks/MCP 安全边界

W66-R4  Codex Adapter
         独立 CLI、exec JSONL、模型目标、resume、sandbox

W66-R5  W73 Attempt / Handoff / safe hot switch
         同 Run 身份、顺序切换、失败回退、usage/结果引用

W66-R6  Agent UI + packaged Activation Gate
         三执行器/模型选择、健康/安装/认证态、20 轮与退出收尸
```

Foundation 扶正仍至少需要两个真实 Adapter 共用协议；若产品对外承诺 Kimi Code、Claude Code、Codex 三选一，则三者必须各自通过 Gate。任何一个未安装或未过 Gate，只影响自己的状态，不得拖垮另外两个。

## 7. 验收门

1. Rule Pack 缺失、不可读、编码错误或快照失败时，三个 Adapter 均为零 spawn。
2. 三个 Adapter 接收同一份军规全文和同一 SHA-256；任何截断、摘要替代或只传路径均判负。
3. Session、W73 Delegation Attempt、Handoff 与结果证据都能追到 Adapter、requested/resolved model、Rule Pack hash、权限档和版本。
4. 同一 Task 完成 Kimi → Claude → Codex 及逆序切换，Run ID 不变，Attempt/Session ID 不复用。
5. 在飞工具事务不允许直接换模；安全中断后 writer lease、child process 和资源账归零再启动目标。
6. 每种 Adapter 完成 detect/probe/auth/session/send/wait/fail/cancel/dispose 和 20 轮 packaged 循环；应用退出无 orphan。
7. 一个 Adapter 缺失、登录失效、版本漂移或输出未知事件时，其余 Adapter 仍可使用，并给出确定性人话状态。
8. 不在日志、ledger、Handoff 或 UI 中泄露 Rule Pack 正文、API Key、OAuth token、完整环境变量或厂商私有原始响应。

## 8. 明确不做

本波不建设完整 W85 Context Compiler、Task Capsule、SeatPackage、Universal Policy System、并发多模型委员会或跨厂商万能 Session。军规必载是 W66 的最小安全前置，不借机吞并后续架构。
