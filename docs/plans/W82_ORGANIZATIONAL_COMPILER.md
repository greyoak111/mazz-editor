# W82 Organizational Compiler
## Production Organization Compiler / 生产组织编译器

> 状态：`W82a FOUNDATION LANDED / W82b–W82h NOT STARTED`
> 版本：v0.6
> 登记日期：2026-08-18
> W82a 落地日期：2026-08-19
> 基础材料：维护者《Media Production Workflows / Industry Workflow Compiler 增量》，SHA-256 `92736DB6477616CD15321BC6A9168680DADB1CACE57F7863BDD8D4A2886E4679`
> 升格材料：维护者《Production Organization Compiler / Organizational Compiler 增量》，SHA-256 `EF11DB0F77AFE04610A2FA55E62DE6B3703A1D50E460057AF33B27417595212E`
> 技术补遗：维护者《从内容网络、World、组织编译器到 .maz 生产资料标准》，SHA-256 `79A1588A2971E134B6CEB1CFD02AC4D27AB4981968A0E46285DEA0EE3D039408`
> 严格增量 II：维护者《Secure Production Assets / Expert Capability Encoding》，SHA-256 `98EDCEBFE850836AD9ED96AC3D99F9C43BAD72BC6E5EFE22D547871CDCE450C0`
> 三工程修正：维护者《Mazz 技术路线升格：从 Agent Harness 到“三工程”与组织运行时》，SHA-256 `0908423812CCC4DA07BDE35E4980569FA19C2869FB04EB2CA7EBFD24D3B89E80`
> 公共生态接口：[`W69_MAZZHUB_LOCAL_FIRST_CONTENT_NETWORK.md`](./W69_MAZZHUB_LOCAL_FIRST_CONTENT_NETWORK.md)
> 跨波次真源：`C:\Users\Administrator\Downloads\交付区\Mazz 当前未落地全景-W71归并版.md`

## 0. 升格结论

W82a 已按维护者独立批准落地纯 Foundation：严格 Workflow Package / Compile Request / Execution Plan、组织考古、Staffing/Delegation 硬边界、Artifact DAG、显式人工 Routing、Authority Separation、Evidence-backed Transition 与 Expert Capability Composition。软件发布和实证研究只作为同一内核的纸面 fixture，不执行进程、不发布产品，也不等于 W82b/W82c vertical slice 已施工。实现与证据见 [`W82A_ORGANIZATIONAL_KERNEL_SPEC.md`](../engineering/W82A_ORGANIZATIONAL_KERNEL_SPEC.md) 和 [`W82A_ORGANIZATIONAL_KERNEL_CHECKPOINT_2026-08-19.md`](../engineering/W82A_ORGANIZATIONAL_KERNEL_CHECKPOINT_2026-08-19.md)。

媒体只是最容易看懂 Factory 威力的 acceptance domain；“从灵感做到动画、游戏”仍是重要样本，但不再定义 W82 的上限。W82 的真实对象升格为：

> 把人类已经验证过的生产组织，提炼为必要的职责、证据、权限、交接、验收和恢复结构，再编译成 Code / Tool / AI / Agent / Human 可以共同执行的组织计划。

适用边界不是“所有行业”，而是：

> 主要输入、中间状态和交付物能够数字化，主要工具能够被计算机调用，关键状态能够被验证或由明确责任主体签发的生产活动。

输入与输出固定表达为：

```text
Goal + Constraints + Assets + Industry Method + Budget
                         ↓ compile
Seats + Teams + Artifacts + Gates + Authority
Executors + Routing + Recovery
                         ↓ W73 runtime
Finished Product + Provenance + Production Record
```

它同时成为 MazzHub 的第六柱，但公共与本地职责必须分开：

```text
W82 / Local Mazz
Production Method → Organization Archaeology → Workflow Package
→ Organizational Compiler → Execution Plan

W73 / Local Factory
Execution Plan → Factory Runtime → Artifact / Final / Production Record

W69 / MazzHub
Workflow Publication → Discovery / Fork / Charts / Market Projection
```

W82 不建设动画引擎、游戏引擎、NLE、DAW、IDE、科研平台、ERP 或“超级 Agent”。它复用现有工作台、W73 Factory Runtime、W66 Harness 与经 W79 接入的结构化工具，把它们组织成可复验生产线。

### 0.1 三工程定位与实证纪律

W82 属于三门正交工程中的“组织工程”，不吞并另外两门：

```text
人的思维工程     Method / Rule / Heuristic / Training Asset
机器的智能工程   Model / Perception / Reasoning / Memory / Agency
组织工程         Seat / Staffing / Delegation / Authority / Gate / Recovery
```

Mazz 是三工程的真实试验场，不是理论已经成立的证明。未来以同一任务、近似相同模型/预算比较 Raw Agent、Method Asset、Rule Pack、Gate/Regression 与完整 Factory，记录质量、事故复发、返工、Human Attention、成本和恢复；没有跨域真实样本时只能称研究假说。

## 1. 产品原则：实例化生产组织，不是黑箱一键生成

目标链：

```text
Intent / Goal
→ Constraints / Assets / Project Context / Budget
→ choose deliverable and method
→ compile Production Organization
→ Seats + Artifacts + Gates + Routing
→ Model / Agent / Script / OSS Tool / Human 分别上岗
→ intermediate artifacts + local repair
→ finished product + provenance + production record
→ optional Promotion / Publication
```

Mazz 不需要宣称基础模型优于专用生成平台。可持续优势是：

- 过程可见、可拆、可暂停、可恢复；
- 每个中间工件可版本化、复用和局部重做；
- Executor 可替换，不被单一模型、Provider 或平台锁死；
- 成本、耗时、来源、许可证和人工介入可追；
- Project Context、World、仓库、证据集与历史资产可在同一生产族中共享；
- Gate 在每次交接处阻断一致性、质量、预算和权利问题。

用户表达“我要什么成品”，系统负责实例化适当组织；用户不必先学会创建多少个 Agent。不得把 `Intent → Finished Product` 偷换成 `Intent → one opaque prompt → binary output`。

## 2. 组织考古：编译必要结构，不是照抄组织架构

设计方法固定为：

```text
职业 / 岗位          → Seat
部门 / 项目组        → Team / Cell
岗位职责             → Seat Policy
项目经理 / 制片      → Orchestrator
委托 / Brief         → Blueprint / Task
交接物               → Artifact Contract
上下游交接           → State Transition
质检 / 审稿 / Review → Gate / Reviewer
总监 / 主编 / 委员会 → Authority / Arbitrator
返工                 → Revision Loop
事故复盘             → Finding → Rule / Gate
排班 / 派工          → Router / Scheduler
最终签发             → Human Final
制作工具             → Capability / Executor
生产运行             → W73 Factory Runtime
行业 SOP             → Workflow Package
```

历史岗位必须先分成两类：

```text
A. 生产真正需要的边界
   独立判断 / 专业能力 / 权力分离 / 独立复核
   法律责任 / 不同工具 / 不可逆行动

B. 旧技术与交易成本制造的摩擦
   搬文件 / 转格式 / 传话 / 重复统计 / 复制数据 / 填重复表格
```

A 类才保留为 Seat、Gate、Authority 或 Human Final；B 类应由数据流、确定性工具或自动化消除。禁止把一家公司的 87 个职位机械翻译成 87 个 Agent。

设计纪律是：

> Compile the invariant structure of production；管边界，不管手脚。

Workflow 固化“能读什么、能改什么、必须交付什么、谁独立检查、失败回哪、谁最终签字和预算多少”，不把岗位内部动作写成大型 Prompt 流程图。另遵守：**能证明的不推理，能计算的不生成。**

核心纪律：

```text
Seat != Model
Seat != Executor
Seat != Harness
Agent != Harness
Executor != Harness
Harness != Tool
Sub-Agent != Child Seat
Staffing != Tool Routing
Delegation != Authority Transfer
Qualification != Delegable Credential
Multi-Agent != Factory
Capability != Executor
Workflow Package != Running Workflow
Artifact != Publication
Factory Pass != Human Final
Organizational Compiler != Factory Runtime
Human Final != automated Gate
```

Executor 可以是 Human、Model、Agent、Script、外部 Tool、Supplier；远期还可能是 Robot、CNC、PLC、Vision 或 Warehouse。Seat 表达职责和交接契约，不随 Executor 更换而改变。物理 Executor 只在 W86 独立安全架构获批后进入，当前 W82 只冻结类型边界。

```text
Seat != Model
Seat != Machine
Seat != Supplier
Capability != Executor
```

同一“表面检测”Seat 可以由 Vision Machine A、Machine B 或 Machine B + Human inspection 承担；更换执行者不能偷改 Artifact Contract、Gate、Authority 或 Safety requirement。

### 2.1 Staffing、Child Seat 与 Delegation Graph

正式关系固定为：

```text
Seat（职责、交付、权力、责任）
  ↓ Staffing / Delegation
Executor（Human / Agent / Script / Supplier）
  ↓ Harness / Runtime
Tool / Capability
```

同一 Seat 因工作量增加而临时加入多个 Executor，不自动生成 Child Seat。只有出现独立职责、独立输入、独立 Artifact、独立 Gate 与独立 Authority/Responsibility，才编译为 Child Seat。

W82 负责编译 Work Package、允许的 delegation depth、subcontract policy、responsibility owner 与 Authority boundary；W73 才能把实际委托每一跳保存为 Production Run 内的 Delegation Graph。嵌套委托必须禁止 cycle 和隐式 subcontract，每一跳有 provenance 与全链成本；Authority、Qualification 均不随转包继承，最终 Executor 必须取得有效 Task Contract，Parent Seat 默认保留责任。W73a–h 当前完成态不含这项未来扩展，不能反写为已落地。

## 3. Workflow Package 一等资产

候选包络：

```text
workflowId
name
version
industry
deliverableType
methodSource
organizationArchaeology

inputs
projectContextRequirements
budgetProfiles

teams
seats
artifactContracts
gates
riskClasses
authorityMatrix
routingPolicies
recoveryPolicies

capabilityRequirements
toolchainConstraints
evidenceRequirements
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

Package 必须是可读、可 diff、可版本化、可迁移的本地资产。`organizationArchaeology` 必须记录岗位为何保留、合并或消失，以及哪些边界来自专业、责任、权力分离、工具或法规。领域文件和实际工程目录仍是真相；Workflow Package 只编排职责、交接、Authority 和 Gate，不把所有产物塞进通用 JSON。

## 4. Compiler 与 Runtime 的边界

Organizational Compiler 输入 Package、Project Context、目标、约束、预算和本机 Capability，输出确定的执行计划：

```text
Workflow Package
  + Project / World / Repository / Evidence Snapshot
  + Target Deliverable
  + Constraints / Risk Class
  + Budget / Quality Profile
  + Capability Probe
        ↓ compile
Execution Plan
  ├─ Team / Cell Instances
  ├─ Seat Instances
  ├─ Artifact DAG
  ├─ Gate Schedule
  ├─ Authority / Human Final Schedule
  ├─ Routing Candidates
  ├─ Budget Envelope
  └─ Recovery / Resume Points
```

Compiler 不直接执行工具、批准现实行动或持有运行事实。W68/W73 Factory Runtime 调度 Seat，W66 Harness 执行 Agent，W79 Capability Adapter 执行 Blender/FFmpeg/编译器/统计工具等确定性能力，人类步骤进入明确待办、验收卡和责任签发。

编译必须确定性：同一 Package version、输入快照、Capability profile 和 routing lock 应产生可比较计划。AUTO 路由如受 W69k 市场视图影响，必须记录公式、证据窗口、候选与人工覆盖。

W82 只决定“什么组织适合稳定地产生目标交付物”；W73 决定“这次运行现在处于什么状态”。两者不得共享一套含混数据库，也不得让 Compiler 冒充 Orchestrator。

### 4.1 Evidence-backed State Transition / 证据支持的状态迁移

完成不是 Executor 的一句声明。任何正式迁移都必须区分：

```text
Verification   事实、格式、schema、数值是否满足规则
Review         是否存在缺口、冲突、遗漏或风险
Evaluation     多个合法方案中哪个更优
Authority      谁有资格使结果生效
```

前三项可以逐步由 deterministic check、独立 AI review、adversarial review 或 external/formal check 承担；Authority 不能被“前三项全绿”自动吞并。

```text
Produce
→ Deterministic Verification
→ Independent Review
→ Adversarial / Formal Check
→ Evidence Bundle
→ Authority Decision
→ State Transition
```

Machine Governance 的目标不是继续提醒模型守纪律，而是把 repository/symbol evidence、Blueprint Authority、reuse inventory、mandatory test gate、architecture lock、UNKNOWN/BLOCKED、diff scope 和 destructive action authority 编译成“没有证据或权限就没有生效权”。

### 4.2 Expert Capability Composition / 专家能力资产编排

W82 不把“专家”压成统一风格模板，而把可外置部分表达为接口化能力：

```text
Expert Capability Asset
├─ attention / decision / negative knowledge
├─ Artifact Contract / Gate / exception policy
├─ examples / failure experience / routing preference
└─ Authority boundary
```

标准化对象是能力的表达、调用、验证和组合方式，不是导演、研究员、审稿人或工程师的创造风格。Director A 与 Director B 应保留不同 identity、方法、证据和适用域。

当 Artifact Contract、Seat Boundary、Authority 与 Capability Interface 兼容时，Compiler 可以把 A 的结构能力、B 的人物能力、C 的剪辑判断、D 的成本控制和 E 的审稿能力组合为同一 Production Organization；组合不复制内部实现，也不扩大原资产权限。

专家不可或不应编译的剩余部分进入 Human Authority / Exception Executor：大量常规判断可由规则、Gate、Tool 或模型执行，关键异常和最终裁决仍提交合格责任主体。Human 不是默认占满全流程的工位，也不是可被“80% 已自动化”吞并的尾注。

运行事故只能先进入 W73 Production Ledger / Finding，再经明确 Authority 升格为 Rule、Gate、Routing 或新版本 Expert Capability。使用次数、通过率或市场排名不得自动改写方法。

## 5. Artifact DAG 与局部重做

生产线的价值来自可检查的中间工件，不来自最后一个文件。媒体链只是最直观的例子：

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

软件工程中的需求、设计、PR、测试报告和构建物，研究中的文献、假设、数据、统计脚本和审稿意见，也必须进入同一套 Artifact/State Transition/invalidates 纪律；不能因为不是媒体文件就退回聊天记录。

## 6. Project Context 是共享生产状态，World 是其中一种

W82 不要求所有行业使用 World。共享上下文可按行业表现为 Repository、Research Corpus、Building Brief、Accounting Period、Dataset 或 World：

```text
Project Context
├─ Goal / Constraints / Risk / Budget
├─ Stable Facts / Evidence / Decisions
├─ Assets / Artifacts / Versions / Rights
├─ Methods / Rules / Applicable Standards
└─ Run / Finding / Recovery References
```

内容行业中，World 不只是小说防吃设定工具，而是 Novel → Comic → Audio → Animation → Visual Novel → Game 的共享 Production Context：

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

跨媒介转换不得静默改写 Canon。每个媒体 Workflow Run 必须标明 Canon/Branch Context、World version、锁定事实和 adaptation policy；非媒体 Run 同样必须钉 Repository/Data/Evidence/Standard 的版本与锁定区。

## 7. 四类代表性行业蓝图

### 7.1 Software Release Organization

```text
Product / Requirement → Architecture → Development → Code Review
→ Test → Security → Release Approval → Package → Operations / Recovery
```

需求、设计、PR、测试报告和构建物是 Artifact；Code Review、CI、测试和 release approval 是 Gate；开发者不得自行批准生产发布，必须形成 Authority Separation；失败发布必须进入可复验 Recovery State。W82 不建设 IDE、CI 平台或运维平台，只编译其组织与交接结构并调用现有能力。

### 7.2 Research / Evidence Organization

```text
Research Question → Literature → Hypothesis → Method → Data
→ Analysis → Adversarial Review → Replication → Revision → Publication
```

文献与数据是 Evidence；统计脚本是 deterministic executor；论文是 Artifact；同行质疑、复现和编辑签发是不同 Gate/Authority。模型不得替代可计算统计或把无来源判断冒充证据，研究负责人仍持有 Human Final。

### 7.3 Animation / Short Video

传统 Producer/Director/Script/Storyboard/Character/Layout/Animation/Background/Lighting/Composite/Voice/Music/Edit/QC 被编译为 Seat、Artifact、Gate 和 Executor。

Storyboard Seat 示例：

```text
Input   script / world canon / shot constraints
Output  storyboard asset
Gate    character continuity / geography / shot coverage /
        duration / dialogue timing
```

Executor 可替换为 Image/Video Model、Blender Script、FFmpeg、Agent 或 Human，不改变 Seat 契约。

### 7.4 Visual Novel / Game Vertical Slice

```text
Idea → Game Blueprint → Design Bible
     → Prototype Gate
     → Map / Character / Dialogue / Quest / UI / Audio / Code
     → Integration → Playtest / QA → Build
```

首轮只验证一个可运行 vertical slice，不建设通用游戏引擎。Mazz 管理 Blueprint、资产、代码、外部构建工具、测试和交接；渲染/运行仍由现有引擎或结构化工具 Capability 完成。

建筑/工业设计、出版、会计、数据项目、课程、翻译本地化、市场研究、咨询和 3D 制作只登记为后续方法包候选。涉及结构安全、财务签发、法律责任、采购或其他不可逆现实行动时，W82 只能编排数字层；合格人类或实体系统必须占据对应 Authority/Human Final，不得自动越权。

## 8. 本地优先、版本与复现

Workflow 生产的源资产、计划、日志和中间工件默认本地。Hub 只能接收显式 Promotion 的 Workflow Publication、可公开样本和统计。

每次运行必须钉住：

```text
Workflow Package version
Project / World / Repository / Evidence versions
Artifact Contract versions
Seat Policies
Authority Matrix / risk class
Model / Provider / Harness / Tool versions
Routing Formula / overrides
Budget profile
License / provenance snapshot
```

“可复现”不要求随机模型逐字节相同，而要求能重建组织、输入、版本、参数、决策、工件链和差异，并能解释为什么无法完全重现。

## 9. 与 W69 第六柱和 AI Production Market 的公共接口

MazzHub 的公共对象由 Publication、World、Creator、AI Worker 扩展到 Production Workflow。第六柱因此从 `Media Production Workflows` 升格为 `Production Organization Workflows`，媒体是首个用户可见域而不是能力边界：

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

公共页面展示输入要求、组织考古说明、Seat/Team/Artifact/Gate/Authority 图、支持的目标、风险级别、版本、许可证、成本/耗时区间、真实 Production Records 与兼容性。不得上传私有 Project/World、Repository、数据、密钥、未授权素材、完整运行史或本机路径。

Workflow 排名属于 W69k/l 市场视图：比较“完成某类交付物的生产组织”，而不是只比较单模型。Worker Market 允许同一 Worker 在小说人物、Code Review、数据清理、视频分镜等 Seat 上呈现不同能力与成本；不得推出脱离 Seat/Workflow/Governance/Context 的跨行业总分。Official workflow 不默认获得排名加权，Fork 热门也不自动覆盖原 Workflow。

## 10. 施工拆波

### W82a — Organizational Kernel, Archaeology & Transition Contract

状态：`FOUNDATION LANDED`。以下项已由纯函数内核和契约测试冻结；运行事实仍归 W73，Agent Harness 归 W66，外部工具执行归 W79。

- 冻结三工程边界与 `Seat → Staffing/Delegation → Executor → Harness → Tool` 关系；
- 冻结 Sub-Agent/Child Seat 判定、Work Package、delegation depth/cycle/provenance/cost/liability/qualification/authority contract；
- 冻结 Goal/Constraint/Asset/Method/Budget 输入与 Team/Seat/Artifact/Gate/Authority/Executor/Routing/Recovery 输出；
- 冻结组织考古记录：岗位保留、合并、消失的理由和证据；
- 冻结 Verification/Review/Evaluation/Authority 分层与 Evidence-backed State Transition；
- 冻结 Expert Capability Asset、Human Authority remainder、组合兼容与生产史升格边界；
- 冻结 UNKNOWN/BLOCKED、权限拒绝、破坏性动作和异常恢复为合法状态；
- Package validation、确定性编译、Artifact DAG、预算和恢复点；
- 纸面 fixtures 证明 Seat/Model/Harness/Capability 分层，以及 Compiler/Runtime 分权。

### W82b — Software Release Organization Slice

- 用 Mazz 自身一个非生产性 specimen 验证 Requirement → Build → Review → Test → Security → Release；
- 开发、复核、发布授权分离，失败进入 Recovery State；
- 复用 Git、测试、builder 和审计工具，不建设 IDE/CI/运维平台；
- 先通过本地 fixture，绝不自动推送、发布或触碰外部生产环境。

### W82c — Research / Evidence Organization Slice

- Question → Literature → Method → Data → Analysis → Adversarial Review → Replication → Report；
- Evidence、deterministic calculation、model judgment 与 Human Final 分离；
- 缺引文、统计失败、复现失败和方法变更触发局部回退而非整项重做。

### W82d — Animation Short Vertical Slice

- 选择 30–180 秒动画短片作为第一个媒体完整样本；
- Script → Storyboard → visual/audio → timeline → QC → master；
- 至少两种 Executor 可在同一 Seat 契约下替换；
- 局部镜头重做不重跑无关工件。

### W82e — Cross-media Workflow Family

- Novel/Comic/Audio/Animation 共享 World 与资产；
- 同一 Event 形成多个 Edition/Artifact，但 Anchor、进度和版本不互相污染；
- Workflow Package 的共用段、专业段和迁移策略分离。

### W82f — Visual Novel / Game Vertical Slice

- Blueprint/Design Bible/Asset/Code/Build/Playtest 形成最小闭环；
- 复用外部引擎或 CLI/API，不建设 Mazz Game Engine；
- 构建失败、工具缺失、取消和恢复都有真实证据。

### W82g — Workflow Lifecycle & Local Library

- create/import/export/fork/diff/migrate/deprecate；
- Capability compatibility、Authority requirement 与缺件预览；
- 本地 Workflow Library、运行历史和可复用 Artifact provenance。

### W82h — Intent-to-Organization UX

- 用户从目标交付物、约束、资产和预算出发，不从“创建几个 Agent”出发；
- 展开编译出的组织、责任、预计成本、工具缺口、人工签发点与风险；
- 编译前可换 Method/Workflow，运行前可换 Executor，但不能绕过强制 Authority/Gate。

### W69m — Workflow Publication & Public Market

- Workflow Promotion、Publication、Hub 页面、搜索/收藏/Fork；
- Workflow/team/seat/cost/quality/repair/compatibility 的跨行业透明市场视图；
- 公共包回到本地先做权限、许可证、Capability 和 migration 检查。

W69m 是 W82 的公共投影，不是第二个 Compiler 或 Factory Runtime；W69m 的跨行业目录也不把 MazzHub 变成企业生产数据托管平台。

## 11. Hard Validation Sample D — Media acceptance

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

Sample D 未通过，不得宣称 Media Production Workflow 或“灵感到动画”已经落地；Sample D 通过也只能证明媒体 vertical slice，不能单独证明 Organizational Compiler 成立。

## 12. Hard Validation Sample E — Cross-domain invariance

```text
same Organizational Kernel
├─ Software Release fixture
│  Requirement → Change → Review → Test → Security → Release Candidate
│  → reject one gate → local repair → authorized specimen
└─ Research Report fixture
   Question → Evidence → Method → Analysis → Adversarial Review
   → fail replication → local repair → human-signed report

both runs must expose
Seat / Artifact / Gate / Authority / Executor / Routing / Recovery
```

退出条件：两个互不相邻行业使用同一内核而无需厂商分支；行业差异保留在 Method/Workflow Package；软件开发者不能自批发布，研究分析者不能自证方法有效；确定性工具不被模型推理替代；失败只回退受影响分支；全过程默认本地且 W73 持有运行真相。

Sample E 未通过，不得使用“Organizational Compiler”“跨行业数字劳动力市场”或“从 Intent 实例化生产组织”的正式产品表述。

## 13. 依赖与边界

| 前件 | W82 消费内容 | 不得误写 |
|---|---|---|
| W66 Harness | Agent executor、Doctrine/Tool reality、Session 与生命周期 | Terminal/Provider 不冒充 Seat；W66 不拥有 Staffing/Run |
| W68/W73 Factory | 任务、工件、Gate、预算、生产记录、实际 Staffing/Delegation 与运行时 | W82 不另造 Factory 或运行数据库；嵌套 Delegation 仍是未来扩展 |
| W72 Asset/Capability | Workflow/Artifact 身份与 Capability contract | 不建 Universal Asset DB |
| W74c Promotion | Workflow/Artifact/Public Evidence 显式升格 | 不自动发布项目 |
| W79 External Tool | Blender/FFmpeg/engine/CLI 等结构化执行 | 不揉入外部工具源码或克隆 UI |
| W69 | Workflow 公共投影、发现、Fork、Charts/跨行业 Worker Market | Hub 不执行本地生产线或托管私有生产事实 |
| W80 | 可选的 World simulation/effect evidence | W82 不依赖 W80 才能生产 |
| W84 `.maz` Standard | Workflow/organization 包的可移植 Definition profile | `.maz` 不保存 W73 Runtime Instance |
| W85 Context Compiler | 为 Seat 编译可寻址上下文与覆盖证明 | 长上下文不等于 Plan/State/Coverage |
| W86 Physical Production | 远期 Robot/CNC/PLC/Supplier executor 与安全边界 | W82/W73 无权绕过 Safety Kernel 或直控设备 |

## 14. 永久禁区

```text
× Idea → one opaque prompt → finished binary
× 机械复制传统 org chart / 一个旧岗位 = 一个 Agent
× Seat = Model / Provider / Harness
× Seat = Executor / Sub-Agent = Child Seat
× Delegation 自动转移 Authority、责任或 Qualification
× 隐式 subcontract、无限 delegation depth 或 delegation cycle
× Workflow Package = 运行时数据库
× 全部 Artifact 塞入一个通用 JSON
× 为动画重造 NLE / 为游戏重造 Engine / 为音频重造 DAW
× 为软件重造 IDE/CI / 为科研重造全栈研究平台 / 为企业重造 ERP
× Computer Use 取代稳定 CLI/API
× AUTO Routing 隐藏证据与覆盖权
× 一次 Gate 通过 = Human Final / Publication / Canon
× AI/Agent 自动取得法律签字、财务签发、生产发布或不可逆现实行动权
× Executor 自报“完成”直接推动正式 State Transition
× Verification / Review / Evaluation 全绿自动取得 Authority
× 局部修改默认全项目重跑
× 公共 Workflow 自动读取私有 Project、World、Repository、数据、密钥或素材
× Hub 成为 Workflow 或工件唯一真相
× 脱离 Seat/Workflow/Governance/Context 制造跨行业 Worker 总分
× 为 Benchmark 污染真实生产线
```

## 15. Final Definition of Done

首个正式 Organizational Compiler 只能在以下条件同时满足时声明成立：

1. Workflow Package 及组织考古记录可读、可 diff、可版本化、可迁移；
2. 同输入、方法、能力快照与锁定路由可生成可比较 Execution Plan；
3. Team/Seat/Artifact/Gate/Authority/Executor/Capability 在 schema 与 UI 中分离；
4. Compiler 与 W73 Runtime 不共享含混所有权，运行事实只有一个本地真源；
5. Artifact DAG 支持局部失效、局部重做和断点恢复；
6. 至少两个互不相邻行业 vertical slice 跑到可验收交付物，其中至少一个非媒体；
7. 至少一个 Seat 证明 Executor 可替换，至少一个高风险动作证明 Authority 不可被自动绕过；
8. 可计算/可验证步骤由确定性工具或证据 Gate 承担，而非模型假装确定；
9. 成本、耗时、版本、许可证、来源、人工决定和 Recovery 可追；
10. 缺工具、失败、取消、重开均不留下幽灵进程、越权动作或伪成品；
11. Workflow 的本地真相与 Hub 公共投影可分别撤回和导出；
12. 任一正式完成态都有 Evidence Bundle、Authority owner 与可解释 State Transition；
13. 至少两个不同 Expert Capability Asset 可在不混写 identity、style、permission 与 Authority 的情况下组合、替换和局部回退；
14. 生产事故只有经 Finding → Authority → Rule/Gate/Version 链才可修改 Workflow Definition；
15. Sample D 与 Sample E 全链通过。
16. Staffing/Delegation 的每一跳可追到 Work Package、Executor、成本、Authority、Qualification 与责任 owner；required child result 未收齐不能 COMPLETE。
17. 至少一组 Raw Agent / Governed Agent 对照只按可重算证据报告，不以模型自评证明三工程假说。

## 16. 当前停止线

本文件已完成 W82 v0.6 Design Capsule 与 W82a 纯 Foundation。W82a 只编译组织计划并评估证据跃迁，不执行模型、外部工具、后台服务、Workflow Runtime、嵌套 Delegation Runtime、专家资产市场、软件发布/研究/动画/游戏入口、跨行业 Worker Market、物理 Executor 或公共市场。

W82b–W82h 仍未施工，必须继续服从跨波次真源和维护者独立批准。不得把双领域纸面 fixture 反写为真实软件发布/研究生产线，更不得直接从“做成动画”“发布 repo”或“生成研究报告”按钮开工。
