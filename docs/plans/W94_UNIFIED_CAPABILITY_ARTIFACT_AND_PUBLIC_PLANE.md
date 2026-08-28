# W94 Unified Capability, Artifact & Public Plane / 统一能力、资产与公共运行面

> 状态：**W94D PASS / W94E PARTIAL / W94F PARTIAL · W94Fb PASS_WITH_SCOPE · W94G/H PARTIAL/BLOCKED**
> 版本：v0.1
> 日期：2026-08-26
> 代码基线：`main@0add39fce403`（W93A–G 已完成；写入本设计前无 tracked 工作树改动）
> 用户目标：以十三卷 `docs/archaeology_v2/00–12` 为历史证据，对照当前产品真相，补齐统一能力执行、计算、绘图、Blender、关系与分支、Player 传输、World/Hub 公共面；不再用孤立模块、测试桩或适配器名称冒充端到端能力。
> 只读边界：`docs/archaeology_v2/` 仅作证据来源，不在 W94 中修改、修订或回写。
> 前置基线：[W93 Library Resource Freedom](./W93_LIBRARY_RESOURCE_FREEDOM.md)、[W86 Capability Production Runtime](./W86_CAPABILITY_PRODUCTION_RUNTIME.md)、[W85 Context Compiler](./W85_CONTEXT_COMPILER_AND_COVERAGE.md)、[W84 `.maz` Production Asset Standard](./W84_MAZ_PRODUCTION_ASSET_STANDARD.md)、[W82 Organizational Compiler](./W82_ORGANIZATIONAL_COMPILER.md)、[W69 MazzHub Local-first Content Network](./W69_MAZZHUB_LOCAL_FIRST_CONTENT_NETWORK.md)。

## 0. 文档裁决与证据口径

W94 是施工参照，不是完成声明。它把十三卷考古材料中的历史原证、当前仓库中已经可达的产品事实、尚未接通的基础器官和未来公共面拆开登记。

证据优先级固定为：

```text
当前可运行代码 + 持久磁盘事实 + 可复现运行证据
  > 当前合同 / Source / Packaged 证据
  > 当前设计与检查点
  > 历史考古原证
  > 推断、愿景和命名相似性
```

以下表述一律禁止：

- 有类、有文件或有 IPC，就声称产品能力已贯通。
- fixture、mock、jsdom fallback 通过，就声称真实外部工具、Canvas、网络或物理环境通过。
- 本地 schema/crypto 内核存在，就声称 Hub、Marketplace、公共授权或 World Runtime 已上线。
- Provider/CLI 安装存在，就声称已经授权、可用或满足全部模型能力。
- 旧历史快照中的 HEAD、测试数或波次状态覆盖当前仓库真相。

## 1. Executive Decision

当前 Mazz 的主要问题不是器官数量不足，而是器官之间缺少一条统一、耐久、可取消、可恢复、可追责的施工脊柱。W94 的总目标是把计算、图表、Canvas、Blender、关系检索、Player transport、World 和 Hub 统一到同一套边界：

```text
用户 / Factory / Agent / Organization
        ↓
Capability Registry：能力发现、版本、环境与安全等级
        ↓
Execution Proposal：明确输入资产、目标、约束和授权
        ↓
Lease + Owner：Workspace/Task/Seat/Window/Process 所有权
        ↓
Capability Adapter：Calc / Chart / Canvas / Blender / Retrieval / Transport
        ↓
Execution Receipt：状态、输入哈希、输出哈希、日志摘要、取消与恢复
        ↓
Artifact Store：定义、来源、派生关系、版本、可迁移实体
        ↓
Review / Gate / Promotion：产品态升格与回滚
        ↓
Local Product → 可选 Public Projection / Hub
```

首要裁决：**先统一能力和资产真相，再扩张工具；先完成本地耐久闭环，再部署公共面；先消灭两套 transport 和点对点桥接真相，再增加来源。**

## 2. 当前仓库真相

### 2.1 已经落地的基础

- Agent Harness 已有 Codex/Kimi/Claude adapter、激活门、取消与事件链；是否授权必须按运行环境单独证明。
- W82/W85/W86 已提供组织、上下文、能力安全与生产运行的受控内核，但不是通用产品执行器。
- Math UI、持久 Python Kernel、Markdown Calc、Sheet Chart、Draw 与 Blender headless adapter 已存在。
- Visual Composition 已接入主窗口、Browser、Panel 与 Window surface；主要表面具有统一几何和生命周期合同。
- W63/W70/W76–W78/W81/W85 已形成地址化证据、多父 Context、认知和事件基础。
- W83 Player/Danmaku、Feed、Companion 与 W93 Library Resource Freedom 已形成强本地垂直切片。
- W84 已形成 `.maz` 本地 profile、加密、签名、授权和迁移内核。
- W94E 记录的历史回归基线为 `276/276`；W94Fb 新增 bridge 合同后为 `279/281`。W94Ga/Gb/Gc/H 又新增 World、Hub、origin 和 seal 合同；最终回归结果以本次 W94H checkpoint 的实跑数字为准，不能沿用旧快照。`npm run build` 与 `npm run dist:dir` 仍需在最后一处改动后重跑；这都不是 W94 完成证据。

### 2.2 不能冒充完成的器官

1. `CapabilityRegistry` 尚未成为生产唯一能力目录。
2. Factory Joint Scheduler 最终仍把执行权交回既有内容流程，没有通用 Proposal → Lease → Adapter → Receipt 链。
3. Python Kernel 接收 raw code 并共享进程状态，不能直接授权给 Agent 或公共任务。
4. Calc 没有耐久定义、数据版本、结果实体和可重放 Receipt。
5. Chart 只有即时渲染/PNG，没有稳定 ChartSpec、字体主题冻结和数据血缘。
6. Draw 是人工编辑器，不是可版本化的 Canvas Agent 施工站。
7. W94D 已把 Blender adapter 接入产品 Capability/Artifact/Receipt 脊柱并完成真实 5.2.1 opt-in；复杂资产编排、版本矩阵和 GPU 一致性仍未完成。
8. Relation Retrieval 仍主要是纯内核，没有产品服务、UI、解释链和全域事件覆盖。
9. Player TorrentDaemon 与 W93 Library Torrent Transport 是两套真相；Player 任务仍是内存态并动态依赖当前 Workspace。
10. World 的本地持久 Store、Canon 提案/审阅/合并运行时已由 W94Ga 落地；编辑器、公共投影和生产 Hub 仍缺。
11. Hub 服务器/DNS 只完成基础准备；当前 origin、TLS、应用、身份、发布和治理均未部署。

## 3. 范围、非目标与永久禁区

### 3.1 W94 范围

- 统一 Capability Registry、执行请求、Lease/Owner、取消、恢复、回执和 Artifact lineage。
- 计算、Chart、Canvas、Blender 四类能力的真实产品闭环。
- Relation Retrieval 产品化与 Branch/Effective State 合并。
- Player Torrent 迁移到 W93 耐久传输脊柱，并建立本地 watch-room 最小闭环。
- World 本地持久运行时与 Canon proposal/review/merge。
- Mazz Hub 最小安全 origin、身份、发布、公共投影和运维证据。

### 3.2 非目标

- 不借 W94 重写已通过的 W93 Library、W87 Visual Composition 或 W66 Harness。
- 不把 Hub 变成 Universal Database，不让公共面拥有本地 Workspace 真相、私钥或生产任务所有权。
- 不在没有本地耐久 Receipt 前直接开放远程 Agent、Blender、Python 或文件系统能力。
- 不用 live-only 证据结案；真实网络/Blender/服务器验证只能补强确定性合同。
- 不一次性公开 Marketplace、支付、排行榜和所有 World 能力；公共能力逐层授权。

### 3.3 永久禁区

- Agent/模型直接执行不受限 shell、raw Python、Blender Python 或物理设备控制。
- Renderer 持有外部进程、任意绝对路径、secret、下载 owner 或公共发布私钥。
- 以标题相似、临时 URL、随机端口、`Date.now()` 或当前活动窗口作为持久资产身份。
- 用字数、token、页数、来源数、队列条数等任意业务门限静默裁剪工作流。
- 删除 SSRF、路径 containment、磁盘、解压炸弹、资源 owner、并发 CAS、格式和权限等安全边界。
- Hub 自动取得本地私有资产、自动发布、自动上传 P2P 或绕过 Rights/Publication Gate。

## 4. 冻结领域模型

### 4.1 Capability Descriptor

Schema：`mazz.capability-descriptor/v1`

```js
{
  capabilityId, version, adapterId,
  kind,                 // compute | chart | canvas | blender | retrieval | transport | publish
  executionPlane,       // main | isolated-worker | external-process | remote-service
  inputSchemas: [], outputSchemas: [],
  determinism,          // deterministic | seeded | nondeterministic | external
  safetyClass,          // local-safe | isolated | external-read | external-write | public-effect
  availability: { state, checkedAt, evidenceRef },
  cancelMode, resumeMode,
  provenance
}
```

Descriptor 只描述能力，不授予执行权。安装探测、CLI 版本或 adapter 文件存在只能产生 availability evidence，不能产生授权。

### 4.2 Execution Proposal 与 Lease

Schemas：`mazz.execution-proposal/v1`、`mazz.execution-lease/v1`

```js
{
  proposalId, workspaceIdentity, taskId, seatId,
  capabilityId, capabilityVersion,
  inputs: [{ artifactId, contentHash, role }],
  parameters, expectedOutputs, constraints,
  authority, createdAt
}

{
  leaseId, proposalId, ownerKind, ownerId,
  state, acquiredAt, heartbeatAt, expiresAt,
  cancelRequestedAt, releasedAt
}
```

- 同一副作用 proposal 只能有一个 active lease。
- Lease 不能凭窗口存在推断；必须由主进程 owner 持久登记。
- App quit、Workspace 切换、窗口 handoff 和外部进程退出都必须先结清或安全暂停 Lease。

### 4.3 Execution Receipt

Schema：`mazz.execution-receipt/v1`

```js
{
  receiptId, proposalId, leaseId,
  capability: { id, version, adapterId },
  state,                 // completed | paused | cancelled | failed | quarantined
  inputFacts: [{ artifactId, contentHash }],
  outputFacts: [{ artifactId, contentHash, mediaType, role }],
  environment: { runtime, toolVersion, platform, renderer },
  determinism, seed,
  startedAt, finishedAt,
  diagnostics: { code, summaryRef },
  resourceFinal, provenance
}
```

Receipt 不持久化 secret、完整远端正文、用户绝对路径、Bearer、Cookie 或未脱敏命令行。失败回执必须区分业务失败和持久化失败；读回可见不等于目录 `fsync` 已成功。

### 4.4 Artifact 与 Derivation

Schemas：`mazz.artifact/v1`、`mazz.artifact-derivation/v1`

```js
{
  artifactId, workspaceIdentity,
  kind, mediaType, contentHash,
  definitionHash, storageRef,
  createdByReceiptId, createdAt,
  sourceArtifacts: [], rightsRef,
  mutableHead, revision
}
```

- Blob 身份使用完整内容哈希；可编辑定义使用稳定 definition hash + revision。
- PNG/SVG/PDF/BLEND/JSON/CSV/Python 结果都是资产，不是剪贴板字符串。
- 派生关系必须引用输入版本，不能只引用文件名或当前活动文档。
- Preview、thumbnail、缓存与正式 Artifact 分权；缓存可删，定义和 Receipt 不可随缓存消失。

### 4.5 Branch 与 Effective State

Schema：`mazz.branch-manifest/v1`

```js
{
  branchId, workspaceIdentity, baseRevision,
  headRevision, parents: [],
  changes: [{ artifactId, fromRevision, toRevision, intent }],
  relationChanges: [], cognitionChanges: [],
  conflicts: [], authority, status
}
```

Effective State 必须由 base + ordered changes + explicit resolutions 计算；不得由“最后写入文件”或某个 UI 当前值冒充。文件、关系、认知、World Canon 和发布投影采用同一冲突语义，但各自保留独立 Authority。

## 5. 跨波硬不变量

1. **Local-first truth**：Workspace、Artifact、Receipt、Branch 和 Rights 的本地事实先成立；Hub 仅持有获得 Publication Grant 的投影。
2. **One capability, one owner**：同一副作用执行只有一个主进程 owner；Renderer、事件提示和 UI 状态不能成为真相源。
3. **No raw Agent execution**：Agent 只能提交符合 schema 的 Proposal；Adapter 决定安全执行形式。
4. **No silent truncation**：不得按任意字数、token、条目、历史轮次、图层数、页面数或文件数静默丢输入；资源不足必须明确失败、暂停或分片并保持守恒。
5. **Provider-owned generation limits**：不向 Provider 发送本地产生的 token 上限；Provider 的安全终态、空输出、协议和内容过滤仍 fail-closed。
6. **Determinism is explicit**：确定性、seeded、nondeterministic、external 必须在 Descriptor/Receipt 中明确；`Math.random`、系统字体、GPU、Blender 版本和外部网络不能被隐藏。
7. **Full identity**：内容哈希、工具版本、schema 版本、输入版本和 Workspace identity 必须完整；不使用截断哈希作为持久唯一键。
8. **Atomic publication**：临时文件 → 完整校验 → `fsync` → 排他发布 → 目录 `fsync` → Receipt；任何失败不得留下冒充成功的正式资产。
9. **Capability before convenience**：既有 point-to-point Bridge 只能作为兼容入口，最终必须转为 Artifact + Proposal，不再依赖全局 active controller。
10. **No public side effect without grant**：公共发布、排行榜、市场、支付、外部写入和服务器部署都必须有显式 Authority 与审计回执。
11. **No live-only closeout**：每波先有离线 fixture/故障合同，再做 opt-in 真实工具或网络；live 失败不能被重试掩盖产品语义失败。
12. **RED 不越波**：任一 P0/P1、全量红、资源未归零、Source/Packaged 不同代、隐私或 provenance 红，本波保持 PARTIAL/BLOCKED，下一波不得以“并行”绕过。

## 6. W94A：Capability Execution Spine

规格文件：[W94A Capability Execution Spine](../engineering/W94A_CAPABILITY_EXECUTION_SPINE_SPEC.md)  
检查点：[W94A Capability Execution Spine 检查点](../engineering/W94A_CAPABILITY_EXECUTION_SPINE_CHECKPOINT_2026-08-25.md)

### 6.1 交付

- 在主进程建立生产唯一 `CapabilityRegistryService`，登记内置/外部 capability descriptor、availability 和版本。
- 建立持久 Proposal/Lease/Receipt Store，绑定 Workspace、Task、Seat、Adapter 与输入资产。
- 建立严格状态机：proposed → awaiting-authority → queued → running ↔ paused → verifying → completed；失败、取消、隔离明确分流。
- Joint Scheduler 通过注册表提交 Proposal；既有 Factory 内容流程可作为兼容 adapter，但不能绕过 Receipt。
- 统一 App quit、Workspace rebind、window handoff、进程 crash 的 owner 回收和显式恢复。
- 建立 Artifact Registry/Derivation 最小内核，先支持 compute/chart/canvas/blender 四类未来输出。

### 6.2 不做

- 不在 W94A 直接开放 raw Python、Blender 或公共网络能力。
- 不重写 W66 Harness；Harness 成为 Proposal producer，而不是执行真相所有者。

### 6.3 Final Gate

- 同 proposal exactly-once；多窗口并发不会双执行。
- 进程崩溃后 running 进入 paused/recovery，不自动重放副作用。
- 持久化失败不能凭 readback 可见误判成功。
- 取消/恢复/失败不泄漏 owner、listener、timer、worker 或 temp。
- Fixture capability 的 Source + Packaged 完整闭环通过。

## 7. W94B：Calc + Chart 可追责资产链

规格文件：[W94B Calc + Chart Artifact](../engineering/W94B_CALC_CHART_ARTIFACT_SPEC.md)  
检查点：[W94B Calc + Chart Artifact 检查点](../engineering/W94B_CALC_CHART_ARTIFACT_CHECKPOINT_2026-08-26.md)

### 7.1 Calc

- 冻结 `mazz.calc-definition/v1`：语言、代码/表达式、数据引用、环境、seed、期望输出 schema。
- Python 通过隔离 worker/进程 capability 执行；默认不共享用户全局 namespace，不允许 Agent 传任意 shell/路径/网络。
- Sheet 公式、Markdown Calc 和 Factory 计算共用 Definition/Receipt，不再各自藏结果。
- 输出为 typed table/scalar/text/image/file artifacts；大输出按流式资产处理，不塞 Renderer/Base64。

### 7.2 Chart

- 冻结 `mazz.chart-spec/v1`：数据资产、字段映射、图型、尺寸、DPI、字体包、主题、locale、seed。
- SVG/PNG/PDF 与 ChartSpec 分离；同 spec + 同环境应有可解释的可重放结果。
- 字体缺失、GPU/Canvas 差异和随机布局必须进入 Receipt，不得隐藏。
- Chart 进入文档/幻灯/Draw 时传 Artifact Ref，不传 data URL。

### 7.3 Final Gate

- 相同输入与确定性环境产出相同 definition/content hash。
- 随机函数必须显式 seed 或标记 nondeterministic。
- 真实 Python unavailable/崩溃/取消/超时均形成耐久、可恢复事实。
- jsdom fallback 不计真实 Canvas 证据；Source/Packaged 必须实际生成并重新打开资产。

## 8. W94C：Canvas Agent Construction

规格文件：[W94C Canvas Agent Construction](../engineering/W94C_CANVAS_AGENT_CONSTRUCTION_SPEC.md)  
检查点：[W94C Canvas Agent Construction 检查点](../engineering/W94C_CANVAS_AGENT_CONSTRUCTION_CHECKPOINT_2026-08-26.md)

### 8.1 交付

- 冻结 Canvas Document、Layer、Selection、Operation、Revision schemas；Mask/Boolean 仍是后续扩展，不冒充本波已落地。
- Agent 只能提交结构化 operation：新增、更新、移除、排序、选择、显式 human replace-document 与链接资产；禁止直接操纵全局控制器。
- 每个 operation 具有 precondition、affected IDs、inverse/rollback、Receipt 和 preview。
- Draw legacy frame 可 fork 为 v1 Document；Chart/Image/SVG 通过 Artifact Ref 组合，不复制 Base64。Mindmap/Slide 适配留待后续波。
- 人工与 Agent 修改共享 revision/CAS；冲突明确呈现，不静默覆盖。

### 8.2 Final Gate

- 连续结构化操作、撤销、重做、崩溃恢复后文档和 Artifact 哈希一致。
- 选区/图层越权、过期 revision、恶意 SVG/HTML 均 fail-closed；Mask/Boolean 不在本波能力集合。
- Source + Packaged 完成真实 Canvas Document 生成、编辑、关闭、重开、导出与资源归零；Draw legacy adapter 有独立合同覆盖。

## 9. W94D：Blender External Capability

规格文件：[W94D Blender External Capability](../engineering/W94D_BLENDER_EXTERNAL_CAPABILITY_SPEC.md)  
检查点：[W94D Blender External Capability 检查点](../engineering/W94D_BLENDER_EXTERNAL_CAPABILITY_CHECKPOINT_2026-08-26.md)

### 9.1 交付

- 建立 Blender 安装探测、版本指纹、受支持版本矩阵和显式 unavailable 产品态。
- Adapter 只接受结构化 operation 与受控脚本模板；禁止 Agent 提交任意 Blender Python。
- 输入 `.blend`/模型/纹理/参数全部以 Artifact Ref 进入隔离 staging；输出通过完整哈希原子升格。
- 支持 render/inspect/export 的最小闭环，具备 timeout、cancel、进程树清理、日志脱敏和 GPU/CPU 环境 Receipt。
- Blender 未安装时不下载、不静默 fallback、不声称能力可用。

### 9.2 Final Gate

- Fixture adapter、真实 Blender opt-in、恶意路径、崩溃、卡死、取消、磁盘失败和版本漂移合同齐全。
- Source/Packaged 均能从同一 `.blend` fixture 产出、校验并重新打开结果。
- 退出后 Blender 子进程、临时目录、文件 handle 和 Capability Lease 全归零。

**W94D 已通过。** Fixture 与真实 Blender 5.2.1 的 Source/Packaged、三 operation、失败/取消、
资源收尸、全量回归和构建证据均已写入 W94D checkpoint；下一波只进入 W94E。

## 10. W94E：Relation Retrieval + Branch Effective State

规格文件：[W94E Relation Retrieval + Branch Effective State](../engineering/W94E_RELATION_BRANCH_EFFECTIVE_STATE_SPEC.md)

当前状态：**PARTIAL / IN PROGRESS**；实现、Source/Packaged 运行证据、构建和全量回归已落地，尚未宣称全波通过。

检查点：[W94E Relation + Branch 检查点](../engineering/W94E_RELATION_BRANCH_EFFECTIVE_STATE_CHECKPOINT_2026-08-26.md) · [Source 证据](../engineering/evidence/W94E_RELATION_BRANCH_SOURCE.json) · [Packaged 证据](../engineering/evidence/W94E_RELATION_BRANCH_PACKAGED.json)

### 10.1 交付

- 把 Relation Retrieval 从纯函数接为 Workspace service/IPC/UI，返回结果、证据路径、排序理由和 supersession。
- Factory、Library、Player、Calc、Canvas、Blender、World 全部产生地址化 workspace events。
- Context、认知、关系和 Artifact revision 进入 Branch Manifest；实现 effective-state 计算、冲突识别和显式 resolution。
- LAN Sync 扩展为可合并的关系/认知/branch facts；文件同步不再冒充状态同步。

### 10.2 Final Gate

（2026-08-28 续记：W94Fb 的 Player↔W93 bridge 与 Workspace A/B 门已在 Source/Packaged
运行中闭合；下方较早的 PARTIAL 文字仅保留历史差分，现状以 W94F 检查点及 W94Fb 证据为准。）

- 同一查询可解释地回到原始 evidence/ref，不用 regex 命中冒充关系推理。
- A/B Workspace、离线并发、多父关系、删除/恢复、冲突重放均不丢事实。
- Branch 切换不会串 Calc/Chart/Canvas/World 的当前 revision。

当前已验证：W94E 合同 `9/9`、LAN 合同 `12/12`（含真实 TLS TCP loopback 的冲突/重连/坏签名/中途断线/跨帧乱序路径）、Source/Packaged 查询解释/拒绝重放、多父冲突人工 resolution、`approval` outcome 合同与八 domain metadata-only producer；另有真实跨机器 TLS/帧协议端点双向 1 文件 + 1 state-fact 的 `PASS_WITH_SCOPE` 证据。W94Fe 又以两个独立 Electron Mazz 完成 Source/Packaged room 边界、host transfer/new epoch、重连与 durable replay，W94Fb 再完成显式 W93 Candidate/Offer/Rights Receipt bridge、Workspace A/B 隔离与重启恢复，W94Ga 再完成本地 World Store、Root/Community Branch、Proposal/Review/Canon merge、Workspace A/B 与 restart。证据见 [`W94FE_PLAYER_ROOM_SOURCE.json`](../engineering/evidence/W94FE_PLAYER_ROOM_SOURCE.json)、[`W94FE_PLAYER_ROOM_PACKAGED.json`](../engineering/evidence/W94FE_PLAYER_ROOM_PACKAGED.json)、[`W94FB_PLAYER_LIBRARY_SOURCE.json`](../engineering/evidence/W94FB_PLAYER_LIBRARY_SOURCE.json)、[`W94FB_PLAYER_LIBRARY_PACKAGED.json`](../engineering/evidence/W94FB_PLAYER_LIBRARY_PACKAGED.json) 与 [`W94GA_WORLD_RUNTIME_CHECKPOINT_2026-08-28.md`](../engineering/W94GA_WORLD_RUNTIME_CHECKPOINT_2026-08-28.md)。W94Ga 定向合同、Source/Packaged、build/dist 通过；当前全量 `280/282`，仅 W71 release foundation 与 W72c provenance 两个既有审计漂移仍红。W94F 总波保持 PARTIAL，剩余为 W94Gb/W94Gc/W94H 与审计红项。详见 [`W94E_DOMAIN_EVENT_COVERAGE.json`](../engineering/evidence/W94E_DOMAIN_EVENT_COVERAGE.json) 与 [`W94E_LAN_PHYSICAL_PROTOCOL_PEER.json`](../engineering/evidence/W94E_LAN_PHYSICAL_PROTOCOL_PEER.json)。

## 11. W94F：Player Transport Convergence + Watch Room

规格文件：`docs/engineering/W94F_PLAYER_TRANSPORT_AND_ROOM_SPEC.md`

### 11.1 Player Transport

- Player Torrent 迁移到 W93 持久 Job/Workspace/路径/校验/恢复脊柱；退役独立内存 Job 真相。
- 不自动补公共 tracker；私有 tracker、DHT、上传和 peer IP 明示并分权。
- 删除固定队列条数业务门；资源不足显式暂停/拒绝，不静默丢任务。
- Stream URL 只作短命消费 capability；媒体身份使用完整 hash + selected file identity。W94Fc
  已将 Player 媒体/字幕改为 `tor:fileCapabilityUrl` + `mazz-res://tor-cap` Range 流，旧
  `tor:fileBytes` 仅作兼容入口且不再设 32 MiB 人为门。
- 文件读取、删除、Range 和 protocol proxy 全部复用严格 containment 与 sender capability。

### 11.2 Watch Room

- 先做本地/LAN 房间：room manifest、媒体身份、clock epoch、成员、权限、聊天/弹幕事件。
- 不把 wall clock 当媒体真相；seek、pause、buffer、host transfer 形成可重放事件。
- 公共房间和陌生人发现留到 Hub Publication Gate 后。
- W94Fd 已落地独立 `watch-rooms` LAN 帧、Workspace-scoped durable room/event/epoch store、
  显式配对 join、成员权限与 host transfer；文件帧与 W94E state-fact 帧保持分离。定向合同
  `5/5` 与真实 TLS loopback 重连收敛通过，详见 [W94Fd 检查点](../engineering/W94FD_WATCH_ROOM_CHECKPOINT_2026-08-28.md)。
- W94Fe 已完成 Source/Packaged 双 Mazz 边界：两个独立 Electron 进程在同一 Workspace 通过
  TLS loopback 完成成员回传、断线重连、host transfer/new epoch、host-only 控制和 close/reopen/replay；
  未配对/未知字段 fault injection、ResourceLedger 与三轨帧隔离均通过，详见 [W94Fe 检查点](../engineering/W94FE_PLAYER_ROOM_BOUNDARY_CHECKPOINT_2026-08-28.md)。

### 11.3 Final Gate

- 重启、切 Workspace、选档、暂停、恢复、删除、退出均不丢任务或串路径。
- Player 与 Library 对相同 Blob/BTIH 不产生冲突的 transport truth。
- 双端本地房间完成断网、重连、host transfer 和 timeline 收敛。

W94Fb 已追加完成：显式 W93 Candidate/Offer/selected-file bridge 复用既有
`LibraryResourceSurfaceService.acquireTorrent`，Player durable projection 与 Workspace A/B
重绑定在 Source/Packaged 运行中通过；没有 Candidate 的媒体 Magnet 仍保持媒体专属，不伪造
书籍 Acquisition Job。证据见 `W94FB_PLAYER_LIBRARY_SOURCE/PACKAGED.json`。

## 12. W94G：World + Mazz Hub Public Plane

规格文件：`docs/engineering/W94G_WORLD_HUB_PUBLIC_PLANE_SPEC.md`

### 12.1 World Runtime

- 建立本地 World Store、Edition、Branch、Canon Proposal、Review、Merge 和 Publication Projection。
- World Context 不再只是值对象；编辑、引用、冲突和历史全部落 Branch/Artifact/Receipt。
- Civilization simulation 保持受控内核；只有通过 Artifact/Receipt 的结果才能进入 Canon proposal。
- W94Ga 已完成本地最小切片：World Store、Root/Community Branch、Proposal/Review/partial Merge、
  Workspace A/B 隔离、Source/Packaged restart 与 public-safe snapshot 均有证据；W94Gb 又完成同一
  envelope/manifest/grant/command/receipt 语义的 fake Hub prepare/publish/query/withdraw/sync；W94Gc
  已完成隔离 staging origin、HTTPS、health/snapshot 和 disabled-public-effect 验证，但备份恢复、
  双域 DNS、告警/事故演练与生产签名治理仍未闭合，不把 staging 通过误报为公网发布。

### 12.2 Hub 最小公共面

- 服务器基线：非 root 部署用户、SSH 策略、防火墙、80/443、TLS、反向代理、进程管理、日志轮转、备份与恢复演练。
- DNS：明确 apex 与 `www`，Cloudflare origin/TLS/health 配置可审计；521 必须在公开验收前消失。
- 最小服务只做账户/设备身份、Publication receipt、内容寻址 manifest、公共页面与撤回；不先做支付。
- Hub 只接收获得 grant 的加密/公开投影；本地私钥、Workspace 路径、Draft、Agent transcript 和未发布 Rights 事实不上传。
- `.maz` 公共加载必须核 entitlement、signature、profile/version 和撤回状态；未知 profile inspect-only。

### 12.3 后置扩张

- Charts/Ranking、Marketplace、支付、推荐和公共 Watch Room 均另有 feature gate。
- 不建 Overall Score；排行榜必须按明确维度、时间窗、样本和反作弊规则分开。

### 12.4 Final Gate

- 全新服务器可由审计过的 runbook 从零恢复；回滚不丢 Publication truth。
- staging 与 production 分权；secret 不进仓库、截图、日志和 manifest。
- 本地撤回、Hub 撤回、缓存失效和客户端重新同步形成完整闭环。
- 外部安全审查、备份恢复、证书续期、资源监控和 incident drill 通过后才可公开。

## 13. W94H：Convergence / Security / Release Seal

规格文件：`docs/engineering/W94H_CAPABILITY_PUBLIC_CONVERGENCE_SPEC.md`

W94H 不新增功能，只做：

- Capability/Artifact/Receipt/Branch schema 迁移与旧点对点桥接兼容退役。
- Calc、Chart、Canvas、Blender、Retrieval、Player、World、Hub 的统一 owner/resource/provenance 审计。
- Source/Packaged 同代、真实 Canvas、真实 Blender opt-in、双 Workspace、崩溃恢复、服务器 staging/prod 证据。
- 隐私、secret、绝对路径、远端正文、签名 URL、用户资产和截图人工复核。
- 全量、build、dist、release、provenance、依赖、许可证和回滚演练。

Final Gate 只有两种：

- `W94A–H PASS / W94 COMPLETE`
- `PARTIAL/BLOCKED`，保留精确失败与复开条件，不以缩小口径冒充完成。

## 14. 每波必查

每个子波必须同时提交：规格、schema/ADR、实现、定向合同、roundtrip、故障注入、资源账、Source/Packaged 证据、checkpoint 和总表回写。

| Gate | 最低要求 |
| --- | --- |
| Targeted | 新行为与所有反向边界逐项通过，不只做静态字符串断言 |
| Durable roundtrip | save → close → reopen → replay；事实、revision、identity 与 owner 一致 |
| Fault | cancel、crash、I/O、fsync、磁盘不足、外部进程、网络、损坏、并发、stale revision |
| Resource | owner/listener/timer/window/worker/process/temp/protocol 回到基线或稳定身份子集 |
| Adjacent | 与本波共享 Store、IPC、Renderer、Factory、Player、Library 的相邻合同全绿 |
| Full | `node tests/run.js`；任一红不得用“旧测试”跳过，必须裁决并更新合同 |
| Build | `npm run build`；触及打包/外部工具时追加 `dist:dir` 和 provenance |
| Runtime | 触及 main/renderer/UI 必须 Source + Packaged，runtime error 为 0 |
| Real tool/network | 先 fixture；真实 Blender/Hub/网络只显式 opt-in，不成为唯一通过证据 |
| Privacy | JSON、日志、截图、manifest 不含 Key、Bearer、Cookie、用户绝对路径和真实私有正文 |
| Rollback | feature flag/schema rollback/兼容入口可恢复；不删除未知或未来版本资产 |

任一 Gate 为 RED：本波 checkpoint 只能写 `PARTIAL` 或 `BLOCKED`，README 的 NEXT 指针不得推进。

## 15. 验收矩阵

| 能力 | Proposal/Lease | Durable Receipt | Artifact lineage | Cancel/Recovery | Source | Packaged | Real opt-in | Public effect |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fixture capability | W94A | W94A | W94A | W94A | 必需 | 必需 | 不需要 | 无 |
| Calc | W94B | W94B | W94B | W94B | 必需 | 必需 | Python | 无 |
| Chart | W94B | W94B | W94B | W94B | 必需 | 必需 | Canvas/font | 无 |
| Canvas | W94C | W94C | W94C | W94C | 必需 | 必需 | GPU/Canvas | 无 |
| Blender | W94D | W94D | W94D | W94D | 必需 | 必需 | Blender | 无 |
| Retrieval/Branch | W94E | W94E | W94E | W94E | 必需 | 必需 | LAN 可选 | 无 |
| Player transport | W94F | W94F | W94F | W94F | 必需 | 必需 | P2P opt-in | LAN room |
| World | W94G | W94G | W94G | W94G | 必需 | 必需 | Hub staging | grant 后 |
| Hub | W94G/H | W94G/H | content-addressed | incident recovery | client | client | staging/prod | 显式 grant |

## 16. 迁移与兼容

- 旧 Bridge 先包成 compatibility adapter，产生 Proposal/Receipt；消费者迁完后才能删除全局 active-controller 入口。
- 旧 Calc/Chart/Draw 文件保留原字节，首次编辑时 fork 到 v1 schema，不原地改写未知格式。
- Player 旧 Torrent job 无持久事实时不得伪造恢复；只迁移可验证的 BTIH、selected file 和完整本地文件。
- W84 `.maz` 未知 profile 始终 inspect-only；迁移必须 fork、签名并保留原件。
- Hub schema 升级先兼容读、后双写、再切读、最后停旧写；不得把客户端升级作为取回用户资产的前提。

## 17. 施工波次总表

| 子波 | 交付 | 前置 | Deterministic Gate | Runtime/Fault Gate | 状态 | 检查点 |
| --- | --- | --- | --- | --- | --- | --- |
| W94A | Capability/Proposal/Lease/Receipt/Artifact Spine | W66/W82/W85/W86 | fixture exactly-once | crash/recovery/Source/Packaged | **PASS** | [检查点](../engineering/W94A_CAPABILITY_EXECUTION_SPINE_CHECKPOINT_2026-08-25.md) |
| W94B | Calc + Chart Artifact | W94A | definition/content reproducibility | Python/SVG/Packaged | **PASS** | [检查点](../engineering/W94B_CALC_CHART_ARTIFACT_CHECKPOINT_2026-08-26.md) |
| W94C | Canvas Agent Construction | W94A/B | operation/revision replay | real Canvas Document/rollback | **PASS** | [检查点](../engineering/W94C_CANVAS_AGENT_CONSTRUCTION_CHECKPOINT_2026-08-26.md) |
| W94D | Blender External Capability | W94A | fixture adapter | real Blender opt-in/process cleanup | **PASS** | [检查点](../engineering/W94D_BLENDER_EXTERNAL_CAPABILITY_CHECKPOINT_2026-08-26.md) |
| W94E | Retrieval + Branch Effective State | W94A | query/merge replay | A/B Workspace/LAN conflict | **PARTIAL / IN PROGRESS** | [施工参照](../engineering/W94E_RELATION_BRANCH_EFFECTIVE_STATE_SPEC.md) · [检查点](../engineering/W94E_RELATION_BRANCH_EFFECTIVE_STATE_CHECKPOINT_2026-08-26.md) |
| W94F | Player Transport + Watch Room | W94A/W93/W83 | transport identity/replay | restart/P2P opt-in/LAN | **PARTIAL / W94Fa PASS · W94Fb PASS_WITH_SCOPE · W94Fc PASS · W94Fd PASS · W94Fe PASS_WITH_SCOPE** | [W94F 检查点](../engineering/W94F_PLAYER_TRANSPORT_AND_ROOM_CHECKPOINT_2026-08-27.md) · [W94Fe 检查点](../engineering/W94FE_PLAYER_ROOM_BOUNDARY_CHECKPOINT_2026-08-28.md) |
| W94G | World + Hub Public Plane | W94A/E/W69/W84 | publication/withdraw fixture | staging/prod/incident | **W94Ga PASS / W94Gb PASS_WITH_SCOPE / W94Gc PASS_WITH_SCOPE** | [施工参照](../engineering/W94G_WORLD_HUB_PUBLIC_PLANE_SPEC.md) · [W94Ga 检查点](../engineering/W94GA_WORLD_RUNTIME_CHECKPOINT_2026-08-28.md) · [W94Gb 检查点](../engineering/W94GB_PUBLICATION_HUB_CHECKPOINT_2026-08-28.md) · [W94Gc runbook](../engineering/W94GC_MAZZHUB_SERVER_RUNBOOK_2026-08-28.md) |
| W94H | Convergence & Release Seal | W94A–G | full deterministic suite | Source/Packaged/live audits | **PARTIAL / BLOCKED** | [规格](../engineering/W94H_CAPABILITY_PUBLIC_CONVERGENCE_SPEC.md) · [检查点](../engineering/W94H_CAPABILITY_PUBLIC_CONVERGENCE_CHECKPOINT_2026-08-28.md) |

## 18. 十三卷来源冻结

下列 SHA-256 只证明本设计采用的历史文本版本；这些文本不是运行时合同，也不随 W94 自动修订：

| 文件 | SHA-256 |
| --- | --- |
| `00_证据方法与语料拓扑.md` | `985129A8AF0CE5B2359B6BF277DB1CEF511AF431B100C84D198A1851FFF6EAB3` |
| `01_用户技术路线原证与时间线.md` | `2E276A349399154ADF0E79771DDA3F3A9E776D3D0A9B0A8EBA0752785F9F97AB` |
| `02_产品定位与横向架构.md` | `0108128124F0F5DE1225EDF0E9676BA28CAF793D9779A42E01C981AC4AEB18A4` |
| `03_Factory_Agent_Harness与组织工程.md` | `B2FB3329799E8A8C38AE53A516B9AD85BBD4D11FB3EFDE06FF425947E2E27CED` |
| `04_资产关系上下文认知固化与检索.md` | `F5832C91297E69DB6AF840B57ABE1313D13DF77F993C7C4F27DCF44F3EDD2BAF` |
| `05_编辑器模块桥接UI_Surface与视觉组合.md` | `B477B192B3486F8FDB87E14C63CC205EBF2A593AD18B14FD76E63B5129A6DC62` |
| `06_Player_P2P弹幕陪看Feed与Library.md` | `5F5204257F8D4948913B424283E2AE1659A0A86039BEBA40AF75361BFAE407E8` |
| `07_MazzHub_World排行榜市场与maz.md` | `25713128E4F6A2444AB627A46F66C0F2A202792F26D46DA69DA6EF31E80F970E` |
| `08_计算绘图确定性工具与外部能力.md` | `1A22725749626BB7F9F4A82A2A244608DC6911C1F7124FF27F57B4637777833D` |
| `09_工程治理安全测试性能与事故方法论.md` | `5D7167DE86B8BB7A2707B50A4115719A86FA27763D0FE609AE83D143B9FD1C96` |
| `10_决策修订链遗失项与开放问题.md` | `A926E1409B293429E12F369F63DBCDA0454AC6810F485D80D40D1653D6667FD7` |
| `11_当前仓库真相与历史差分.md` | `3A1F62A87AF9E1992F1F19E3E57212ADAF1AB95E7DA4D630202D92662ED2777F` |
| `12_节点证据附件与覆盖审计.md` | `4EC987C762C6F5E7F9144442BC04A2C1D98CD9D91D290D012CC08EB70FC61249` |

## 19. Definition of Done 与下一步

W94Fb bridge/A-B 已完成，W94Ga 本地 World Store/Canon proposal-review-partial-merge 和 W94Gb fake Hub 公共投影也已通过；后续施工不再重复创建 Player↔W93 适配，而是转向 W94Gc 运行门、W94H 与剩余
审计红项。媒体 Magnet 若没有 W93 Candidate/Edition/Rights Receipt，继续保持不进入书库取得
链的明确边界。

W94 只有在 A–H 全部通过、README/总表/检查点同代、全量与构建绿、Source/Packaged 证据完整、真实 Canvas/Blender/Hub 边界诚实、无未裁决 P0/P1 时才能写 `W94 COMPLETE`。

当前精确施工项分两条并行但不越权：**按 W94E 施工参照继续补齐跨机器真实 LAN A/B 专项证据；W94Ga 的 World、W94Gb fake Hub 与 W94Gc staging origin 已收口到 PASS_WITH_SCOPE，W94H release seal 保持 PARTIAL/BLOCKED，下一刀是备份/恢复、事件覆盖、生产签名治理与剩余审计红项。W94F 已完成 W94Fa、W94Fb W93 bridge + Workspace A/B、W94Fc capability/Range 流、W94Fd Local/LAN Watch Room 和 W94Fe Source/Packaged 双 Mazz 边界。媒体 Magnet 在没有 W93 Candidate/Edition/Rights Receipt 时不伪造书籍 Job，并保留真实公网 P2P/跨机器房间的 opt-in 复开条件。Library durable Job settlement 已接入，现有 producer 接线与缺口见覆盖审计。**
W94D 已把 Blender 三 operation、真实外部进程、Artifact lineage、失败/取消/收尸与 Source/Packaged 证据接入
W94A/B 脊柱；W94E 已完成实现、Source/Packaged 运行、构建和全量回归，但因上述两项未完成仍保持 PARTIAL；Player、World 或 Hub 仍不因本波通过而自动获得施工授权。
