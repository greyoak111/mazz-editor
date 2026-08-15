# W82 Industry Workflow Compiler
## Media Production Workflows / 行业生产线编译器

> 状态：`DESIGN REGISTERED / POST-W71 / NOT APPROVED FOR IMPLEMENTATION`
> 版本：v0.1
> 登记日期：2026-08-15
> 原始材料：维护者《Media Production Workflows / Industry Workflow Compiler 增量》
> 原始 SHA-256：`92736DB6477616CD15321BC6A9168680DADB1CACE57F7863BDD8D4A2886E4679`
> 公共生态接口：[`W69_MAZZHUB_LOCAL_FIRST_CONTENT_NETWORK.md`](./W69_MAZZHUB_LOCAL_FIRST_CONTENT_NETWORK.md)
> 跨波次真源：`C:\Users\Administrator\Downloads\交付区\Mazz 当前未落地全景-W71归并版.md`

## 0. 升格结论

“从灵感做到动画、游戏”不再登记为 Factory 远期 demo，而升格为独立的本地生产基础设施：

> 把成熟内容工业的社会分工、资产交接和质量门槛，编译成 Factory 可以执行的 AI-native Workflow。

它同时成为 MazzHub 的第六柱，但公共与本地职责必须分开：

```text
W82 / Local Mazz
Workflow Package → Compiler → Factory Execution → Artifact / Final

W69 / MazzHub
Workflow Publication → Discovery / Fork / Charts / Market Projection
```

W82 不建设动画引擎、游戏引擎、NLE、DAW 或“超级 Agent”。它复用现有 Editor、Mindmap、Canvas、Library、Player、Browser、Factory、Harness，以及经 W79 接入的外部工具，把它们组织成可复验生产线。

## 1. 产品原则：透明生产系统，不是黑箱一键生成

目标链：

```text
Prompt / Idea
→ World / Project Blueprint
→ choose deliverable
→ compile Industry Workflow
→ Seats + Artifacts + Gates + Routing
→ Model / Agent / Script / OSS Tool / Human 分别上岗
→ intermediate artifacts + local repair
→ finished work
→ Publication
```

Mazz 不需要宣称基础模型优于专用生成平台。可持续优势是：

- 过程可见、可拆、可暂停、可恢复；
- 每个中间工件可版本化、复用和局部重做；
- Executor 可替换，不被单一模型、Provider 或平台锁死；
- 成本、耗时、来源、许可证和人工介入可追；
- World、角色、地点、声音、风格与历史资产跨媒介共享；
- Gate 在每次交接处阻断一致性、质量、预算和权利问题。

不得把 `Idea → Finished Work` 偷换成 `Idea → one opaque prompt → binary output`。

## 2. 从人类行业组织编译，而不是让 AI 发明组织

设计方法固定为：

```text
传统岗位       → Seat
岗位职责       → Seat Policy
交接物         → Artifact Contract
审批环节       → Gate
制作工具       → Capability / Executor
制片管理       → Factory Runtime
行业 SOP       → Workflow Package
```

核心纪律：

```text
Seat != Model
Seat != Harness
Capability != Executor
Workflow Package != Running Workflow
Artifact != Publication
Factory Pass != Human Final
```

Executor 可以是模型、Agent、脚本、CLI、外部 OSS 工具或人；Seat 表达职责和交接契约，不随 Executor 更换而改变。

## 3. Workflow Package 一等资产

候选包络：

```text
workflowId
name
version
industry
deliverableType

inputs
worldRequirements
budgetProfiles

seats
artifactContracts
gates
routingPolicies

capabilityRequirements
toolchainConstraints
licensePolicy
provenance

migrations
compatibility
```

示例：

```text
Anime Short Workflow v1.4

Inputs
  Idea / World / Characters / StyleRefs / Budget / Duration

Seats
  Producer / Script / Storyboard / Visual Director
  Animation / Voice / Sound / Editor / Reviewer

Artifacts
  script.md / shot-list.json / storyboard/
  character-sheet/ / keyframes/ / audio/ / timeline/ / master.mp4

Gates
  Canon / Character Consistency / Shot Continuity
  Duration / Audio Sync / Resolution / Rights / Budget

Routing
  cheap / standard / premium
```

Package 必须是可读、可 diff、可版本化、可迁移的本地资产。领域文件和实际工程目录仍是真相；Workflow Package 只编排职责、交接和 Gate，不把所有产物塞进通用 JSON。

## 4. Compiler 与 Runtime 的边界

Industry Workflow Compiler 输入 Package、World/Project Context、目标、预算和本机 Capability，输出确定的执行计划：

```text
Workflow Package
  + World / Project Snapshot
  + Target Deliverable
  + Budget / Quality Profile
  + Capability Probe
        ↓ compile
Execution Plan
  ├─ Seat Instances
  ├─ Artifact DAG
  ├─ Gate Schedule
  ├─ Routing Candidates
  ├─ Budget Envelope
  └─ Recovery / Resume Points
```

Compiler 不直接执行工具。W68/W73 Factory Runtime 调度 Seat，W66 Harness 执行 Agent，W79 Capability Adapter 执行 Blender/FFmpeg/其他工具，人类步骤进入明确待办和验收卡。

编译必须确定性：同一 Package version、输入快照、Capability profile 和 routing lock 应产生可比较计划。AUTO 路由如受 W69k 市场视图影响，必须记录公式、证据窗口、候选与人工覆盖。

## 5. Artifact DAG 与局部重做

生产线的价值来自中间工件，不来自最后一个二进制：

```text
Script
→ Shot List
→ Storyboard
→ Character / Location Assets
→ Layout / Keyframes / Motion
→ Voice / Music / SFX
→ Timeline / Composite
→ QC
→ Master
```

每个 Artifact Contract 至少包含：

- 格式、schema/version、来源和生成工具；
- 上游输入、下游消费者和失效传播规则；
- Gate 结果、人工修改、锁定区与可重做范围；
- 缓存键、可再生性、保留策略和版权/许可证；
- 失败、取消、恢复和 supersedes 关系。

局部重做只使受影响下游失效，不默认重跑整个项目。角色声音、立绘、场景和 World Fact 可以跨作品复用，但复用必须留下来源与版本。

## 6. World 是跨媒介共享生产状态

World 不只是小说防吃设定工具，而是 Novel → Comic → Audio → Animation → Visual Novel → Game 的共享 Production Context：

```text
World
├─ Canon / Branch / Timeline
├─ Characters / Locations / Institutions
├─ Existing Images / Voice / Music
├─ Style / Rules / Rights
└─ Existing Publications
```

同一个 World Event 可以产生互见但不互抄的多个 Edition/Artifact：

```text
World Event #1837
├─ novel chapter
├─ news broadcast
├─ comic chapter
├─ audio drama scene
├─ animation short
└─ game quest
```

跨媒介转换不得静默改写 Canon。每个 Workflow Run 必须标明 Canon/Branch Context、World version、锁定事实和 adaptation policy。

## 7. 两类代表性行业蓝图

### 7.1 Animation / Short Video

传统 Producer/Director/Script/Storyboard/Character/Layout/Animation/Background/Lighting/Composite/Voice/Music/Edit/QC 被编译为 Seat、Artifact、Gate 和 Executor。

Storyboard Seat 示例：

```text
Input   script / world canon / shot constraints
Output  storyboard asset
Gate    character continuity / geography / shot coverage /
        duration / dialogue timing
```

Executor 可替换为 Image/Video Model、Blender Script、FFmpeg、Agent 或 Human，不改变 Seat 契约。

### 7.2 Visual Novel / Game Vertical Slice

```text
Idea → Game Blueprint → Design Bible
     → Prototype Gate
     → Map / Character / Dialogue / Quest / UI / Audio / Code
     → Integration → Playtest / QA → Build
```

首轮只验证一个可运行 vertical slice，不建设通用游戏引擎。Mazz 管理 Blueprint、资产、代码、外部构建工具、测试和交接；渲染/运行仍由现有引擎或结构化工具 Capability 完成。

## 8. 本地优先、版本与复现

Workflow 生产的源资产、计划、日志和中间工件默认本地。Hub 只能接收显式 Promotion 的 Workflow Publication、可公开样本和统计。

每次运行必须钉住：

```text
Workflow Package version
World / Branch / Canon version
Artifact Contract versions
Seat Policies
Model / Provider / Harness / Tool versions
Routing Formula / overrides
Budget profile
License / provenance snapshot
```

“可复现”不要求随机模型逐字节相同，而要求能重建组织、输入、版本、参数、决策、工件链和差异，并能解释为什么无法完全重现。

## 9. 与 W69 第六柱的公共接口

MazzHub 的公共对象由 Publication、World、Creator、AI Worker 扩展到 Production Workflow：

```text
Local Workflow Package
→ explicit Promotion
→ Workflow Publication
→ Hub discover / inspect / fork
→ local capability check / migration preview
→ Fork Workflow locally
→ replace Seat Executor / Gate / Routing
→ compile and run
```

公共页面展示输入要求、Seat/Artifact/Gate 图、支持的目标、版本、许可证、成本/耗时区间、真实 Production Records 与兼容性。不得上传私有 World、密钥、未授权素材、完整运行史或本机路径。

Workflow 排名属于 W69k/l 市场视图：比较“完成某类作品的生产组织”，而不是只比较单模型。Official workflow 不默认获得排名加权，Fork 热门也不自动覆盖原 Workflow。

## 10. 施工拆波

### W82a — Workflow Package Contract & Compiler Core

- 冻结 Package、Seat、Artifact、Gate、Routing、Capability 与 migration 契约；
- Package validation、确定性编译、Artifact DAG、预算和恢复点；
- 纸面 fixture 证明 Seat/Model/Harness/Capability 分层。

### W82b — Animation Short Vertical Slice

- 选择 30–180 秒动画短片作为第一个完整样本；
- Script → Storyboard → visual/audio → timeline → QC → master；
- 至少两种 Executor 可在同一 Seat 契约下替换；
- 局部镜头重做不重跑无关工件。

### W82c — Cross-media Workflow Family

- Novel/Comic/Audio/Animation 共享 World 与资产；
- 同一 Event 形成多个 Edition/Artifact，但 Anchor、进度和版本不互相污染；
- Workflow Package 的共用段、专业段和迁移策略分离。

### W82d — Visual Novel / Game Vertical Slice

- Blueprint/Design Bible/Asset/Code/Build/Playtest 形成最小闭环；
- 复用外部引擎或 CLI/API，不建设 Mazz Game Engine；
- 构建失败、工具缺失、取消和恢复都有真实证据。

### W82e — Workflow Lifecycle & Local Library

- create/import/export/fork/diff/migrate/deprecate；
- Capability compatibility 与缺件预览；
- 本地 Workflow Library、运行历史和可复用 Artifact provenance。

### W69m — Workflow Publication & Public Market

- Workflow Promotion、Publication、Hub 页面、搜索/收藏/Fork；
- Workflow/team/cost/quality/repair/compatibility 的透明市场视图；
- 公共包回到本地先做权限、许可证、Capability 和 migration 检查。

W69m 是 W82 的公共投影，不是第二个 Compiler 或 Factory Runtime。

## 11. Hard Validation Sample D

```text
Existing World + Idea
→ choose “3-minute animation short”
→ compile Workflow Package
→ materialize Seats / Artifact DAG / Gates
→ Model + Agent + FFmpeg/Blender + Human mixed execution
→ fail one shot gate
→ replace executor and rerun only affected branch
→ produce master.mp4 + complete provenance/cost ledger
→ promote Publication + Workflow Publication
→ another user inspects, forks, checks local capability and recompiles
```

退出条件：全过程可展开；角色/World 约束可追；单镜头重做不全量重跑；缺工具和取消可恢复；最终文件、工件、成本、许可证和人工决定可审计；Hub 不持有唯一源资产。

Sample D 未通过，不得宣称 Media Production Workflow 或“灵感到动画”已经落地。

## 12. 依赖与边界

| 前件 | W82 消费内容 | 不得误写 |
|---|---|---|
| W66 Harness | Agent executor 与生命周期 | Terminal/Provider 不冒充 Seat |
| W68/W73 Factory | 任务、工件、Gate、预算、生产记录和运行时 | W82 不另造 Factory |
| W72 Asset/Capability | Workflow/Artifact 身份与 Capability contract | 不建 Universal Asset DB |
| W74c Promotion | Workflow/Artifact/Public Evidence 显式升格 | 不自动发布项目 |
| W79 External Tool | Blender/FFmpeg/engine/CLI 等结构化执行 | 不揉入外部工具源码或克隆 UI |
| W69 | Workflow 公共投影、发现、Fork、Charts/Market | Hub 不执行本地生产线 |
| W80 | 可选的 World simulation/effect evidence | W82 不依赖 W80 才能生产 |

## 13. 永久禁区

```text
× Idea → one opaque prompt → finished binary
× Seat = Model / Provider / Harness
× Workflow Package = 运行时数据库
× 全部 Artifact 塞入一个通用 JSON
× 为动画重造 NLE / 为游戏重造 Engine / 为音频重造 DAW
× Computer Use 取代稳定 CLI/API
× AUTO Routing 隐藏证据与覆盖权
× 一次 Gate 通过 = Human Final / Publication / Canon
× 局部修改默认全项目重跑
× 公共 Workflow 自动读取私有 World、密钥或素材
× Hub 成为 Workflow 或工件唯一真相
× 为 Benchmark 污染真实生产线
```

## 14. Final Definition of Done

首个正式 Workflow Compiler 只能在以下条件同时满足时声明成立：

1. Workflow Package 可读、可 diff、可版本化、可迁移；
2. 同输入与锁定路由可生成可比较 Execution Plan；
3. Seat/Artifact/Gate/Executor/Capability 在 schema 与 UI 中分离；
4. Artifact DAG 支持局部失效、局部重做和断点恢复；
5. 至少一个真实行业 vertical slice 跑到可交付成品；
6. 至少一个 Seat 证明 Executor 可替换；
7. 成本、耗时、版本、许可证、来源和人工决定可追；
8. 缺工具、失败、取消、重开均不留下幽灵进程或伪成品；
9. Workflow 的本地真相与 Hub 公共投影可分别撤回和导出；
10. Sample D 全链通过。

## 15. 当前停止线

本文件只完成 W82 Design Capsule、W69 第六柱接口与施工拆波。W71 内不得据此引入模型、外部工具、后台服务、Workflow Runtime、动画/游戏入口或公共市场。

下一步只允许在 W71 RC 后经维护者独立批准，先冻结 W82a Contract/Compiler ADR；不得直接从“做成动画”按钮开工。
