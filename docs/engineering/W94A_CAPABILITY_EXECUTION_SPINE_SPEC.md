# W94A Capability Execution Spine 施工与验收规格

> 状态：**PASS / CHECKPOINTED / W94B NEXT**
> 版本：v0.1
> 日期：2026-08-25
> 代码基线：`main@0add39fce403`
> 总施工参照：[W94 Unified Capability, Artifact & Public Plane](../plans/W94_UNIFIED_CAPABILITY_ARTIFACT_AND_PUBLIC_PLANE.md)
> 检查点：[W94A Capability Execution Spine 检查点](./W94A_CAPABILITY_EXECUTION_SPINE_CHECKPOINT_2026-08-25.md)
> 本波范围：只建立主进程 `Registry → Proposal → Lease → Receipt → Artifact` 耐久脊柱和 fixture 闭环；不接 raw Python、Canvas、Blender、Player 或 Hub。

## 1. 当前断点

- W72 `CapabilityRegistry` 是内存 Provider 目录，没有主进程产品实例、版本化执行合同或持久状态。
- W73e Joint Scheduler 能产生提案和人工选择记录，但 dispatch 仍归既有 Factory 流程所有。
- `ExternalToolService` 直接把 renderer request 交给 adapter，绕过 Proposal、Lease、Receipt 与 Artifact。
- W73b Production Run 是 Factory 专属文件账，不应被扩写成所有能力的 Universal Store。
- W93 Acquisition Store 已证明 Workspace 绑定、原子发布、腐败阻断和显式重启恢复的正确边界；W94A 继承方法，不复用书库领域 schema。

## 2. 本波裁决

W94A 新建独立主进程服务：

```text
CapabilityExecutionService
  ├─ CapabilityAdapterRegistry（代码拥有 descriptor/adapter）
  ├─ CapabilityExecutionStore（Workspace 持久事实）
  ├─ active executions（短命 AbortController/Promise）
  └─ ResourceLedger owner（运行期观测）
```

生产环境本波可以没有可执行 adapter。测试 fixture 只在显式注入时存在，不打包成用户能力。后续 W94B–D 必须通过 `register(adapter)` 接入，不得新增旁路 IPC。

## 3. 物理布局

```text
<workspace>/.mazz/capability-runtime/
  state.json
  locks/mutation.lock
  quarantine/
```

- Workspace 先 canonical realpath，identity 为 `workspace-sha256-<64hex>`。
- 构造与每次读写都验证 Workspace、`.mazz`、runtime、locks、quarantine 的物理目录身份；reparse/symlink/替换立即 fail-closed。
- `state.json` 是单一小型事实索引，不保存 artifact 正文；正文由后续 Artifact Store/各 adapter 原子发布。
- 每次 mutation 在持有跨实例原子锁后重新读盘，CAS revision，临时文件 `fsync`，原子 replace，再目录 `fsync`。
- 损坏 `state.json` 原字节保留并阻断 mutation；不得自动重建覆盖。
- orphan lock 只能由 Electron 单实例 owner capability 显式修复。

## 4. 冻结 schema

### 4.1 Descriptor

`mazz.capability-descriptor/v1`

必填：`capabilityId/version/adapterId/kind/executionPlane/inputSchemas/outputSchemas/determinism/safetyClass/availability/cancelMode/resumeMode/provenance`。

本波枚举：

- kind：`fixture|compute|chart|canvas|blender|retrieval|transport|publish`
- executionPlane：`main|isolated-worker|external-process|remote-service`
- determinism：`deterministic|seeded|nondeterministic|external`
- safetyClass：`local-safe|isolated|external-read|external-write|public-effect`
- availability：`unknown|available|degraded|unavailable`
- cancelMode：`none|cooperative|process-tree`
- resumeMode：`none|restart|checkpoint`

Descriptor 只描述和观测能力，不是授权。

### 4.2 Proposal

`mazz.execution-proposal/v1`

- Proposal ID 由 Workspace/Task/Seat/Capability/Adapter/输入版本/参数/期望输出/约束/authority 的 canonical SHA-256 派生。
- 完全相同 Proposal 重放返回同一事实；同 ID 不同正文视为完整性冲突。
- 状态：`proposed|queued|running|paused|failed|completed|cancelled`；并冻结 descriptor 的 `determinism` 快照，使 adapter 暂时不可用时仍可诚实生成重启恢复回执。
- Renderer 只允许 `human:*` Authority；Agent/Organization 未来通过主进程内部 producer 接入。

### 4.3 Lease

`mazz.execution-lease/v1`

- 状态：`active|cancel-requested|released`。
- 同一 Proposal 同时最多一个 active/cancel-requested Lease。
- Lease 绑定 `workspaceIdentity/proposalId/ownerKind/ownerId`；窗口、Task、Seat 和进程不由 UI 文案推断。

### 4.4 Receipt

`mazz.execution-receipt/v1`

- 状态：`completed|paused|cancelled|failed|quarantined`。
- 只持久 input/output facts、工具环境、确定性、时间、诊断 code/summaryRef、资源终态和 provenance。
- 禁止 secret、用户绝对路径、完整远端正文和未脱敏命令行。
- 业务失败只有在 failed/paused/cancelled Receipt 完整提交后才算耐久收敛；Store/`fsync` 失败不得由读回猜测成功。

### 4.5 Artifact

`mazz.artifact/v1`

- W94A 只保存 descriptor：`artifactId/kind/mediaType/contentSchema/contentHash/definitionHash/storageRef/createdByReceiptId/sourceArtifacts/rightsRef/revision`。
- `artifactId` 和 `contentHash` 使用完整 SHA-256；禁止截断哈希、随机端口、文件名或临时路径成为身份。
- Fixture 只产生内存定义的 hash descriptor，不写用户正文文件。

## 5. Adapter 协议

`mazz.capability-adapter/v1`

```js
{
  protocol,
  descriptor,
  execute({ proposal, lease, signal }),
  cancel?(context),
  dispose?(reason)
}
```

`execute` 只能返回：

```js
{
  status: 'completed',
  outputs: [artifactDescriptorWithoutReceipt],
  environment,
  diagnostics,
  resourceFinal,
  provenance
}
```

Adapter 不得自己伪造 Receipt、Lease 或 Workspace identity。Service 在 adapter 成功后重新规范化输出，并在一个持久 mutation 中提交 artifacts、receipt、released lease 和 completed proposal。

## 6. Service API

- `register(adapter)` / `listCapabilities()` / `probeCapability()`
- `openWorkspace(workspacePath)`
- `submitProposal(workspace, input)`
- `executeProposal(workspace, proposalId)`
- `cancelProposal(workspace, proposalId, authorityRef)`
- `workspaceSnapshot(workspace)`
- `recoverWorkspace(workspace, singleInstanceOwnerCapability)`
- `shutdown(reason)` / `snapshot()`

所有 mutation 都以 Store 最新磁盘 revision 为准。Service 的内存 active map 只用于 AbortController/Promise，不决定 durable state。

## 7. IPC 边界

本波白名单：

- `capability:list`
- `capability:workspaceSnapshot`
- `capability:submitProposal`
- `capability:executeProposal`
- `capability:cancelProposal`

要求：

- sender 必须是已发布的 Mazz 主壳/子壳 main frame，URL 精确为 `mazz-res://app/index.html`。
- Renderer 不得选择任意 Workspace；payload path 先与主进程当前 Workspace 做 lexical/case 比较，不匹配时不得 probe 文件系统。
- IPC 不接收 adapter、可执行路径、script、shell、secret、artifact 正文或任意 storage path。
- 没有注册 adapter 的 capability 只能查看 descriptor，不能执行。

## 8. 状态机与恢复

```text
submit:      Ø → proposed
execute:     proposed|paused → queued → running
success:     running → completed + released lease + completed receipt + artifacts
failure:     running → failed + released lease + failed receipt
cancel:      running → cancel-requested lease → cancelled + released lease + receipt
restart:     queued|running → paused + released lease + paused receipt
```

- completed/cancelled 是终态；不可修改输出、输入、capability、authority 或 artifact refs。
- failed 仅允许以新 Proposal 重试；W94A 不自动重放副作用。
- 重启恢复必须显式由单实例 owner 执行；普通 Store open 不暂停另一个仍活跃的实例。

## 9. 必测矩阵

1. Descriptor：未知字段、严格类型、secret、版本、枚举、重复 adapter。
2. Proposal：稳定 ID、exact replay、不同输入不误合、Workspace A/B 隔离。
3. Lease：并发 execute 只有一个 winner；重复 execute completed 幂等返回 receipt。
4. Receipt/Artifact：完整 hash、输入 lineage、无正文/secret/path、一个事务提交。
5. Cancel：cooperative fixture 观察 abort，Lease/ResourceLedger 归零。
6. Failure：adapter error 持久 failed receipt；Store/`fsync` error 不伪装 durable business failure。
7. Restart：queued/running → paused；普通 reopen 不恢复；单实例 owner 显式恢复。
8. Corruption：state 损坏、非 regular、symlink/reparse、layout swap 全部阻断且原件保留。
9. Atomicity：两个 Store 交错同 Proposal、revision CAS、lock owner/token/orphan repair。
10. IPC：untrusted/subframe/provisional shell、任意 Workspace、未知字段、非 human Authority 全拒。
11. Resource：active execution/lease/adapter/process/listener/temp 归零。
12. Regression：W72/W73e/W79/W86/W93A、全量、build、Source/Packaged。

## 10. Definition of Done

W94A 只有同时满足以下条件才可 PASS：

- 生产 main 实例化唯一 Service，preload 仅暴露冻结 IPC。
- fixture capability 完成 submit → execute → receipt/artifact → reopen 的 Source + Packaged 闭环。
- 并发、取消、重启、腐败、`fsync`、layout swap 和退出资源合同全部通过。
- W72/W73/W79/W86 与 W93A 相邻合同无回归。
- 默认全量、build、dist/release/provenance 按触及范围通过。
- checkpoint 记录精确文件哈希、测试数、未接能力与下一波；README 只有此时才推进到 `W94A PASS / W94B NEXT`。
