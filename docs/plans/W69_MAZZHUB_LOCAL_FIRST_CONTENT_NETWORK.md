# W69 MazzHub Next Architecture
## Local-first Content Network / 本地优先公共内容网络
### World Branch Governance × Transparent AI Production Market

> 状态：`DESIGN REGISTERED / POST-W71 / NOT APPROVED FOR IMPLEMENTATION`
> 版本：v1.1
> 登记日期：2026-08-15
> 基础材料：维护者《MazzHub 内容生态升格纲要》，SHA-256 `089FD81DDFC5F07829199F9A7DCA6250E4AC902E1E92F4FEFDAD46EF15837195`
> 增量材料：维护者《World Branch Governance × Transparent AI Production Market》，SHA-256 `E5DAF440261A56AAE97EF99B8453298D1D76D0205A0D9C4A90A27AA0E2A2D127`
> 跨波次真源：`C:\Users\Administrator\Downloads\交付区\Mazz 当前未落地全景-W71归并版.md`

## 0. 升格结论

W69 不再解释为“Hub + 模板市场 + 若干社区功能”，而定义为：

> Mazz 用户把本地资产显式 Promotion 为 Publication 后形成的公共投影、发现、社区与分发网络。

四句长期产品宪法：

```text
本地是家。
MazzHub 是广场。
Publication 是作品身份。
P2P / HTTP / LAN / NAS / VPS 是路。
```

四者不能互相吞并。Hub 不拥有私有工作区，URL 不充当作品身份，P2P 不消灭 Origin，World 不成为所有内容的强制父级。

产品骨架由上一版四柱升格为五柱，Publication 是贯穿五柱的基础对象，而不是第六个功能模块：

```text
Factory                生产能力
World                  可共享、可继续生长的上下文
Charts                 透明公共内容发现
AI Production Market   可审计的 AI 劳动履历与派工视图
P2P Content Fabric     用户节点参与的混合内容分发
```

```text
                         MAZZ
                          │
          ┌───────────────┴───────────────┐
          │                               │
     Private Plane                    Public Plane
      Local Mazz                       MazzHub
          │                               │
   Workspace / Library                Discovery / Community
   Factory / Mindmap                  Creator / Work / Charts
   本地资产所有权                      Comment / Danmaku / Follow
   Production Records                AI Production Market Views
          │                               │
          └──────── Publication ──────────┘
                          │
                 Distribution Plane
                          │
          HTTP / P2P / LAN / NAS / VPS
```

## 1. 三个平面与真相边界

### 1.1 Private Plane

本地 Mazz 持有：

- 草稿、未发布版本、Factory 中间工件；
- Series Bible、私有素材、工作区组织；
- 本地 Cognition、Workspace Event Ledger 与个人行为证据；
- 用户选择不公开的资产、关系和世界设定。

`Private Workspace ≠ Public Profile`。任何数据进入 Hub 必须经过显式 Promotion，不允许“登录 Hub 即同步整个工作区”。

### 1.2 Public Plane

MazzHub 只消费已经公开的 Publication 及其明确公开的 Creator、Work、World、Branch、社区事件和派生统计。Hub 是可替换公共投影，不是本地源文件或作品身份的唯一真相。

### 1.3 Distribution Plane

内容字节可由 HTTP Origin、Mazz/Web Peer、作者节点、读者缓存、LAN、NAS、VPS 等混合提供。Discovery metadata 与 Content bytes 分离，Hub 可以保存可靠副本，但不能被模型定义为唯一副本。

## 2. 核心对象模型

### 2.1 Work / Publication / Edition / Version

```text
Work                         逻辑作品本体
└─ Publication               某次公开发布状态
   ├─ Text Edition           同一作品的媒介表达
   │  ├─ Version 1           某 Edition 的历史版本
   │  └─ Version 2
   ├─ EPUB Edition
   ├─ Comic Edition
   ├─ Audio Edition
   └─ Video Edition
```

文章、视频、音频、EPUB、漫画不得各自发展成互不相识的帖子模型。Standalone Work 可以没有 World；World 只服务于具有持续实体、关系、状态和规则的作品群。

### 2.2 Publication Contract v0 候选字段

```text
publicationId
workId
creatorId

editionType
version

manifest
metadata

createdAt
publishedAt

visibility
provenance
license

contentRoot
contentIds
```

硬不变量：

1. `publicationId != URL`；URL 只是某个 Hub 或个人站入口；
2. Publication 身份可被多个 Hub、个人主页、NAS、VPS 和 P2P 网络共同引用；
3. Hub 失效不应导致 Publication 失去身份；
4. Publication 是版本化公开状态，不覆盖本地 Work、Edition 或草稿历史；
5. License、provenance 与 visibility 是一等字段，不能后补成备注。

### 2.3 动态事件与不可变内容分离

```text
Publication
├─ Content Manifest          Versioned / Mostly Immutable
└─ Event Feed               Comment / Reply / Danmaku /
                            Reaction / Moderation Event
```

新增评论或弹幕不得重发整部 Publication。事件必须绑定 Publication/Version 与媒体时钟或稳定 Anchor，并具有独立权限、审核和删除语义。

### 2.4 World Governance 与 AI Production Market 一等对象

以下对象需要在未来 ADR 中拥有稳定身份和版本，不能全部塞进 `content.metadata JSON`：

```text
World / CanonVersion / Branch / ForkPoint / AuthorityRelation
CanonProposal / CanonMerge

ProductionRun / WorkerProfile / TeamProfile
MetricDefinition / RankingFormula / RankingView
```

其中 `ProductionRun` 的本地事实层属于 Factory/W73；W69 只接收用户显式发布、可撤回、可导出的 evidence projection。Hub 不得成为生产记录唯一真相。

## 3. 成熟内容站的公共关节

W69 的五柱不能替代内容站最低闭环。W69 必须按阶段补齐：

| 能力 | 最低作用 | 首轮要求 |
|---|---|---|
| Creator / Profile | 稳定创作者身份与作品聚合 | 必需 |
| Work / Publication Page | 作品稳定落点 | 必需 |
| Follow / Subscription | 持续人与人/作品关系 | 必需 |
| Search / Topic / Tag | 主动与分类发现 | 必需 |
| Series / Collection | 连载、系列、合集 | 必需 |
| Favorite / Collection | 长期保存 | 必需 |
| Watch/Read Later | 临时消费队列 | 必需 |
| Progress / History | 阅读播放连续性 | 必需 |
| Comment / Reply | 最低社区关系 | 必需 |
| Danmaku | 媒体公共现场感 | 视频阶段 |
| Notification Inbox | 关注、回复、更新闭环 | 必需 |
| Creator Studio | 发布、版本与互动管理 | 发布闭环必需 |
| Analytics | 创作者反馈 | Charts 后接入 |
| Report / Block / Permission | 公共空间治理 | 上线前必需 |
| Monetization | 商业化扩展 | 后置，但 schema 不堵死 |

私信、群聊和复杂实时社交后置。公开 Comment/Danmaku Event Feed 不等于多人共看 Room，更不授权把 W69 做成 Discord。

## 4. 五根支柱

### 4.1 Factory：Creator-side Production Infrastructure

Factory 不是“AI 写作按钮”，而是生产基础设施：

```text
Idea → Workspace → Factory → Draft → Review → Gate
     → Human Final → Artifact → Promotion → Publication → MazzHub
```

早期价值：

1. Factory Finished → Promote → Create Publication → Publish，避免重复导出上传和填写元数据；
2. 一个 Work 可由 Factory 产出 EPUB/Audio/Comic Script/Video PV 等多个 Edition；
3. Hub 的完读、完播、收藏、评论和弹幕经 Creator Insights 回到本地，再进入下一版 Factory；
4. W69 只能消费 W68/W73 的工件与 Gate，不能在 Hub 内另造第二套 Factory。

### 4.2 World：可继续运行的创作上下文

```text
World Package
├─ Canon
├─ Locked Facts
├─ Timeline
├─ Characters
├─ Locations
├─ Institutions
├─ Relations
├─ Rules / Geography
├─ Style / Method Constraints
├─ Existing Publications
├─ Public Assets
└─ Optional Factory Blueprint
```

World 是可选对象。教程、歌曲、散文和普通视频可以只有 Publication；只有持续存在的实体、关系、状态和规则才进入 World。

消费到生产的最小闭环：

```text
Hub Discover World
→ Open World in Mazz
→ Acquire public World Package
→ Create Local Workspace
→ Fork
→ Factory Ready
→ Create
→ Publish as Branch
```

### 4.3 Charts：透明发现坐标

Discovery 至少并列四路：

```text
Following | For You（可选） | Charts | Explore
```

Charts 不降格为首页“热门榜”，而是可解释公共事实投影：

- 综合、新作、上升、新作者、分类、媒介榜；
- 完读/完播、收藏转化、讨论增长、重复消费榜；
- 世界、新世界、世界增长、世界衍生榜；
- Branch、角色、跨媒介作品榜；
- Canon Adoption、World Migration、Derivative Growth 与消费→创作转换榜。

排名页面应展示指标、变化、时间衰减和计算规则。`Charts = 公共事实投影`，不是黑盒裁判。Attention Value 与 Creation Value 分开，播放量不能覆盖 Fork、衍生数和消费→创作转化率。

### 4.4 P2P Content Fabric：通用分发平面

```text
MazzHub Control / Discovery
          ↓ Publication ID
      Content Manifest
          ↓
 HTTP Origin ─ Web Peer ─ Mazz Peer
      └──── Hybrid Fetch ────┘
               ↓
         Local Cache / LAN / NAS
```

Publication 默认建模为可复制内容图：

```text
Publication → Manifest → Content-addressed Blocks
            → Availability → Retrieval → Renderer
```

格式调度策略：

- Text：小块、积极缓存；
- EPUB/Comic：章节/页懒取；
- Audio：时间段；
- Video：rendition + segment scheduler。

视频验收不是显示 Peer 数，而是无感完成起播、多清晰度、Seek、弹幕时钟、Peer/Origin 自动回退和本地片段去重。Peer/分片细节只进入 Nerd Panel。

Availability Policy 必须保留作者 Seed、公共 Seed、可选 VPS/NAS 和极冷内容的 Persistent Seed/Origin。原则是 `Direct when possible, fallback when necessary`，不是取消服务器。

### 4.5 Transparent AI Production Market：真实劳动履历与透明派工

AI Production Market 不是厂商广告页，也不是手填“综合智能 92”的模型榜。其底层是本地 Factory 真实工作产生的可审计 Production Record Ledger；排行榜、Worker Profile 与 Router 都只是其版本化投影视图。

```text
Factory Run
→ Local Production Record
→ explicit evidence projection
→ Metric / Sample Set / Ranking Formula
→ Worker / Team / World Compatibility View
→ explainable routing recommendation
→ next Factory Run
```

真实生产单位必须保持：

```text
Worker = Model × Provider × Harness × Seat × Governance
       × Domain × World Type × Task Type × Budget × Time
```

`Model != Worker`，`Provider != Harness`，`Model != Seat`。排行榜不物化这个巨型张量为一个永久总分，而是对带版本和上下文的真实记录做查询。

Production Run 最小审计链：

```text
identity      runId / timestamp
context       worldId / worldVersion / branchId / taskType
organization  seat / harness / governance
executor      model / provider / version
constraints   canonLocks / rules / inputArtifacts
output        artifact / machineReport / reviewReport / revisionHistory
economics     tokens / landedCost / wallTime
decisions     humanAccepted / publicationId? / canonProposalId?
downstream    authorSignals? / audienceSignals? / canonMergeResult?
```

任一市场结论必须可以钻回：

```text
Ranking → Metric → Sample Set → Production Run → Task
→ World/Version/Canon Locks → Input → Harness/Seat/Model
→ Output → Machine/Reviewer Verdict → Revision → Human Decision
→ Publication / Author / Audience / Canon outcome
```

模型内部可以是黑箱，但“Mazz 为什么做出这个评价与推荐”不能是黑箱。

至少分开以下测量，不允许由单一 Overall Score 吞并：

- Raw Ability、Governance Uplift、Final Quality、Governance Dependency；
- Reliability、Landed Cost、Latency、Revision Cost、Canon Compliance；
- role-specific capability；
- Production Score、Author Score、Audience Score 三张互不代替的成绩单。

同一真实任务可在 Raw / Light / Standard / Full Governance 下形成 Factory Amplification Curve。不同 Worker 可以自然显露天才型、制度增益型、稳定苦力型、领域专家型、审校型和创意型，不把差异抹平成一个漂亮分数。

Ranking Formula 必须公开、版本化、带 effective date，并允许按旧数据重算与用户自定义权重。默认提供 Pareto Frontiers，而不是伪造唯一“最佳”：成本、质量、Canon 风险、Audience Pull 分别会产生不同前沿。

Factory Router 可以提供 `AUTO`，但必须显示：

- 同类 World/Seat 样本数、置信度与版本窗口；
- Canon violation、质量、成本、延迟和趋势；
- 推荐与备选的可量化差异；
- 用户接受、换 Worker、改权重、禁 Provider、锁模型的控制权。

团队榜优先观察 Complementarity、Error Correlation、Detection Coverage、Governance Uplift 与 Final Landed Quality。两个单项第一不自动组成最佳团队。

World 可以具有 Evaluation Value，但 Benchmark 只能从真实生产中涌现：`Benchmark Emerges From Production`。不得为刷榜把创作世界改造成固定考试集。AI Challenge 可以同时成为 Publication、Community Event 与匿名盲评样本，但 Challenge Winner、AI Rank、Factory Pass 均不自动成为 Canon。

### 4.6 双自增强环与权力拓扑

五柱不是并列功能，而是两个在 Hub 汇合的闭环：

```text
Production Loop
World → Factory → Production Records → AI Market / Router
      → Better Production → Publication / Branch → Richer World

Distribution Loop
Publication → Audience → Mazz Nodes → P2P Seed / Cache
            → Better Delivery → More Audience
```

增长不能消灭权力边界：Root Author 持有 Canon Authority，Derivative Creator 持有 Branch Authority，Audience 持有 Attention Authority，MazzHub 负责公开发现规则，Charts 负责公共测量，Factory 负责生产治理，AI Worker 负责执行，Peers 负责复制/分发，User 始终持有本地资产。

## 5. World Branch Governance

### 5.1 四个概念绝不混写

```text
Canon ≠ Popularity ≠ Quality ≠ Permission
```

三种权力分离：

- Creator Sovereignty：Root Authority 决定 Canon；
- Derivative Freedom：获许可创作者决定自己的 Branch；
- Audience Sovereignty：观众决定关注、评价和流量。

Authority Status 候选：

```text
Canonical
Official Alternate
Authorized Derivative
Community Derivative
Private Fork
```

它只表达与 Root Authority 的关系，不表达质量。Audience Signals 是完全独立的 views/completion/favorites/ratings/discussion/derivativeCount/branchGrowth 等轴。

### 5.2 Fork 与 Merge

宪法级原则：

> Fork 权尽量自由，Merge 权严格归属。

热门 Branch 不自动成为 Canon，非官方 Branch 也不因此被压制发现。只有 Root Authority 可以推进 Canon Head。

Canon Merge 采用 Semantic Cherry-pick，不要求整条 Branch 转正：

```text
Branch Proposal
├─ new / changed facts
├─ new entities / relations
└─ supporting artifacts
        ↓
Canon Diff → Locked Fact / Timeline / Relation /
World Consistency / Impact Report
        ↓
Accept | Reject | Partial Merge
```

Merge 后 Branch 不删除；进入 Canon 的 Fact 保留 `derivedFrom / creator / mergedBy / canonVersion` provenance。

### 5.3 两张世界地图

每个 World 同时展示：

- Authority Map：Canon / Authorized / Community；
- Audience Map：各世界线的注意力、参与和创作人口。

官方历史与文化偏好可以不同，系统不得拿其中一张覆盖另一张。

### 5.4 Factory 必须识别 Branch Context

Factory 任务必须显式知道自己属于 Canon Production、Official Alternate、Authorized/Community Branch 或 Private Fork。检测到与 Canon 的 divergence 时，应建议创建带 `baseCanonVersion / forkPoint` 的 Branch，而不是拒绝创作或静默覆盖 Root Canon。

原则是：不禁止创作，只禁止偷偷修改别人拥有的 Canon。

### 5.5 Promotion 的统一哲学

World 回流沿用 Mazz 的通用 Promotion 语义：候选由机器、社区和生产过程产生，关键升格由具备对应权力的人确认。

```text
Shadow Relation → Explicit Relation
Draft → Artifact → Publication
Finding → Decision
Branch Fact → Canon Fact
```

Canon Merge 提升事实而不吞并 Branch。一个 Fact 被 Partial Merge 只给该 Fact 带来 Canon adoption signal，不能把整条 Branch 或参与 Worker 记成“全量 Canon Success”。

## 6. 与现有波次的唯一边界

| 既有方向 | 与 W69 的关系 | 禁止混写 |
|---|---|---|
| W64 AI/人格陪看 | 可消费公开 Publication；仍是 AI 陪伴体验 | 不等于 Comment/Danmaku/Room |
| W65 网络资源 | 外部资源发现/获取 Adapter | 不等于 Publication Content Fabric |
| W66 Agent Harness | 可执行任务的受控能力与 executor 版本证据 | Provider/Model/Harness/Seat 不得混写 |
| W68/W73 Factory | 本地生产、审校、Production Run 与 Router 执行的事实层 | Hub 不另造 Factory，不成为生产履历唯一真相 |
| W72 Asset/Capability | Publication/World/Worker evidence 的身份、来源与能力前件 | 不建 Universal Asset DB |
| W74c Promotion | Private → Public 与 Production Evidence Projection 的显式闸 | 不自动公开工作区、输入、私有成本或完整运行史 |
| W75/W78 Anchor/Evidence | 评论、弹幕、引用的稳定地址 | Chunk 不成为内容本体 |
| W76 Node/Placement | Collection/World/Branch 多重组织前件 | 不复制 Publication 本体 |
| W77 Relation Promotion | Branch/Canon 关系证据与升格前件 | 推断关系不直接成为 Canon |
| W80 Civilization Model | 未来可生成/验证 World 事实 | World Package 不依赖 W80 才能存在 |
| W81 Event Ledger | 私有个人工作运行史，可为本地 Factory 提供只读证据 | 不替代 Production Run Ledger，不把个人行为默认投影到 Hub |
| 旧 W69 模板市场 | 降为 Publication/Capability 的一个市场与 registry 分支 | 不再代表 W69 全部定位 |

## 7. W69 分波施工规格

W69 只能在 W71 RC 后单独批准，并按以下顺序拆解；后一波不得反向偷渡到前一波。

### W69a — Publication Contract & Identity

- 冻结 Work/Publication/Edition/Version/Creator ID；
- Manifest、license、provenance、visibility、删除/撤回/版本语义；
- 多 Hub/个人站/离线 manifest 指向同一 Publication fixture；
- ADR 证明 URL、Hub row、文件路径均不是 Publication Identity。

依赖：W72 Asset Identity、W74c Promotion 契约。退出 Gate：离开某 Hub 后身份与本地作品仍可验证。

### W69b — Mature Hub Joints

- Creator/Profile、Work/Publication Page；
- Follow/Search/Tag/Series/Collection/Favorite/Later/Progress/History；
- Comment/Reply/Notification；
- Creator Studio 最小发布与版本管理；
- Report/Block/Permission 最低治理。

退出 Gate：一个真实 Creator/Work 从发现到关注、消费、评论、通知、收藏形成闭环。

### W69c — Charts as Discovery Primitive

- Following/For You/Charts/Explore 四路分离；
- 指标来源、窗口、衰减、反作弊、可解释页面；
- Attention 与 Creation 两类榜分开；
- 本地 Factory QC 事实层只经明确 public projection 进入 Hub。

退出 Gate：任一排名可展开数据来源与计算规则，无法用 Official 字段直接提升推荐。

### W69d — Local Publish → Hub Projection

- Local Asset / Factory Final → Promotion → Publication；
- Creator Studio 接收本地 manifest，不要求重复上传/填表；
- 撤回 Public Projection 不删除本地 Work；
- Hub 不可读取草稿、中间工件和私有 World 字段。

退出 Gate：本地成品一键发布、更新版本、撤回投影和离线恢复均有真文件实证。

### W69e — Hybrid P2P Video Pilot

样本 A：

```text
Local video → Publish → Hub Discover → Web play
→ HTTP first segment → P2P later segments
→ Origin fallback → Mazz cache/seed
```

退出 Gate：冷启动、Seek、清晰度、Peer/Origin 故障、缓存去重、极冷可用性和版权撤回全部通过；用户主界面不暴露网络实现细节。

### W69f — Publication Cross-media

- 复用同一 Publication/Manifest 泛化 Text、EPUB、Comic、Audio；
- Edition/Version/Progress/Comment Anchor 不互相污染；
- 大块、章节、页与时间片按格式懒取。

### W69g — World Package & Fork-to-Factory

样本 B：

```text
Public World → Hub Discover → Open in Mazz → Fork
→ Local Workspace → Factory → Community Branch Publication
```

退出 Gate：World 可选、公开字段可审计、私有字段不泄露、Fork 有新身份且不修改 Root。

### W69h — Branch Governance & Canon Pull Request

- Authority/Audience 双轴；
- Canon Proposal、Diff、Locked Fact/Timeline/Relation/Consistency/Impact Check；
- Accept/Reject/Partial Merge；
- Branch 永久保留，semantic cherry-pick 保留 provenance。

退出 Gate：热门 Community Branch 不自动 Canon；Partial Merge 只改变被采纳事实。

### W69i — World/Branch Charts & Community Completion

- World/Branch/Character/Cross-media/Creation-conversion Charts；
- Creator Analytics、完善审核治理；
- 私信、群聊、实时 Room、Monetization 仅在独立价值与安全评估后进入。

### W69j — Production Record Contract & Evidence Projection

- W73 本地冻结 ProductionRun、WorkerProfile、MetricDefinition、RankingFormula、RankingView 的版本契约；
- Model/Provider/Harness/Seat/Governance/World/Task/Budget/Time 全维上下文在位；
- Local Record 与 Public Evidence Projection 分离，逐字段同意、脱敏、撤回和导出；
- 任一公开指标可追到样本、运行、输入约束、工件、审校、人类决定与下游结果；
- Model/Harness/Formula/Metric/World Canon 均带版本与 effective date。

依赖：W66/W72/W73/W74c 与 W69a。退出 Gate：Hub 下线后本地生产履历仍完整；公开投影可导出并按公开公式独立重算。

### W69k — Transparent Market Views & Auditable Router

- Production/Author/Audience 三榜分离；Raw/Governed/Final/Dependency 与成本、可靠性、延迟、返工、Canon Compliance 分轴；
- Factory Amplification Curve、Worker Profile、World × Task × Worker Compatibility；
- 公式公开、版本化、可改权重，提供 Pareto Frontiers 而非单一总榜；
- AUTO Router 给出样本量、置信度、推荐理由、备选差异和版本窗口；
- 用户可换 Worker、改权重、禁 Provider、锁模型，Router 不越权执行 Canon 决策。

依赖：W69c、W69j 与 W73 本地 Router。退出 Gate：同一证据可由用户重算出一致视图；AUTO 每次有可复验解释和人工覆盖路径。

### W69l — Team Market, World Staffing & Challenge

- TeamProfile 记录互补性、错误相关、检测覆盖、治理增益与最终落地质量；
- World-specific Staffing 按 Architecture/Expansion/Voice/Review/Canon Audit/Media Adaptation 等 Seat 推荐；
- World Evaluation Value 只从真实生产涌现，不为 benchmark 污染创作世界；
- AI Challenge 支持真实 World Task、匿名盲评、揭榜与细粒度 adoption/merge 信号；
- Challenge Winner、Audience #1、AI #1、Factory Pass 均不自动 Canon。

依赖：W69g–W69k 与足量跨版本真实记录。退出 Gate：低错误相关团队可在盲样本中胜过简单拼接单项第一；任何结果仍服从 Root Authority。

## 8. 三个 Hard Validation Samples

W69 不能以页面数量结案。必须跑通三个端到端样本：

1. **Content Fabric Sample A**：证明内容身份、Hub 发现、HTTP/P2P 混合取件、本地缓存与 Seed、Origin fallback；
2. **World Network Sample B**：证明公开 World 可进入本地、Fork、Factory 生产、Branch 发布与 Canon Partial Merge；
3. **Production Market Sample C**：同一真实 World Task 在不同 Governance 下产生本地记录，经显式投影形成可重算榜单；AUTO Router 显示证据与备选，用户覆盖后继续生产，且任何排名、盲评或 Factory Pass 都不能自动改变 Canon。

A 证明 Content Fabric，B 证明 World Network，C 证明 Transparent AI Production Market。对应支柱的样本未跑通，不得宣称该支柱成立；A/B/C 未全部跑通，不得宣称五柱闭环完成。

## 9. 数据、隐私、治理与退出能力

- Public Projection 必须逐项可见、可撤回、可导出；
- Production Record 默认本地；公开样本必须明确列出输入、约束、工件、成本、审校与下游信号中哪些字段被投影，支持 CSV/JSON/Parquet 等可独立分析格式；
- 删除 Hub 账号与删除本地资产是不同操作；
- 评论/弹幕/Reaction 是可审核 Event Feed，不修改 Publication blob；
- 作者公开衍生许可不等于放弃 Canon Authority；
- 读者缓存和 Seed 必须遵守撤回、许可、地区与治理策略；
- 个性化推荐可选，Charts 提供透明非个性化公共坐标；
- 多 Hub federation 只有在 Publication Identity 与权限模型稳定后研究；
- Monetization schema 可以预留权利与结算引用，但不得阻塞早期闭环。

## 10. 永久禁区

```text
× Hub URL = Publication Identity
× Hub database = 作品唯一真相
× Factory = AI 写作按钮
× World = 所有内容必须套的万能容器
× Popularity = Canon
× Official = 推荐优先级
× Fork = 修改原世界
× Open Derivative = 原作者失去 Canon Authority
× P2P = 取消所有 Origin
× Charts = 首页热门侧栏
× 本地状态默认公开到 Hub
× Publication blob 与评论/弹幕 Event Feed 混写
× Hub 成为不可导出的 Production Record 唯一真相
× One Overall AI Score
× Provider = Worker / Model = Seat
× AI Rank / Audience Rank / Factory Pass → Canon
× Official Status → 默认排名加权
× AUTO Routing = Hidden Algorithm
× Benchmark Tasks 取代真实生产
× Merge = 删除或吞并 Branch
× Universal Graph / Universal DB
```

继续遵守：能力桥接、身份清晰、状态分层。

## 11. 最终定义

> MazzHub 是建立在本地创作环境之上的公共内容网络：用户可以生产作品、公开作品、分享可继续创作的世界，让其他用户消费、Fork、衍生和再发布；Charts 提供透明的公共发现坐标，Factory 提供生产能力，原作者保留 Canon 定义权；真实 Factory 劳动形成可审计、可重算的 AI Production Market 并反哺透明派工，P2P 与本地节点共同承担内容分发。

压缩定义：

> 作者定义什么是真的，创作者产生什么可能，观众决定喜欢什么，AI 负责劳动，Factory 负责治理，排行榜只诚实记录它们实际干得怎么样。

## 12. 当前停止线

本文件完成 Design Capsule 与施工拆波，不是 W69 开工许可。当前允许动作仅为：

- 回写跨波次未尽全景；
- 在 W71 之外经维护者批准后冻结 W69a Publication Contract ADR；
- 用纸面 fixture 检查与 W72/W74c 的身份和 Promotion 边界。

未经独立授权不得建设 Hub 服务、账号系统、中心数据库、P2P daemon、公共 Seed、World runtime、Production Record 公共服务、排行榜、AUTO Router、AI Challenge 或正式入口。
