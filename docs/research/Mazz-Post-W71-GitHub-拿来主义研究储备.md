---
title: Mazz Post-W71 GitHub“拿来主义”研究储备
status: Post-W71 / Research Reserve
source_scope: 当前对话最近两轮 GitHub 侦察结果
verified_at: 2026-08-15
not_w71_scope: true
---

# Mazz Post-W71 GitHub“拿来主义”研究储备

> **状态：Post-W71 / Research Reserve（研究储备）**
> 本文不是 W71 当前实施清单，不应据此向 W71 增加依赖、验收项、迁移任务或交付承诺。文中的 P0/P1 只表示 **W71 结束后的研究优先级**。

## 0. 范围与边界

本文只整理当前对话中最近两轮 GitHub 侦察得到的增量战利品，重点回答六个问题：

1. 哪些开源项目值得“拿来主义”；
2. 真正值得复用的是代码、数据模型、算法、测试病例，还是事故经验；
3. 它们能给 Mazz 的现有 `Asset / Anchor / Event / Episode / Multi-parent Context / Shadow Relation / Search / Factory / Harness` 骨架补上什么；
4. 哪些许可证允许认真复用，哪些只能做 sidecar、clean-room 重写或设计参考；
5. 项目之间怎样“做乘法”，而不是把 Mazz 变成开源项目陈列柜；
6. W71 结束后，下一批 repo 应该按什么顺序拆、拆什么、产出什么。

**明确排除：**“浏览器历史记录 / Personal Web Graph / Tab parent graph”作为主体方案已在其他上下文单独出库，本文不重复收录 TabTreeTracker、Nyxt 等主线；仅在讨论 ActivityWatch 的跨 Surface Event Ledger、ArchiveBox/Pydoll 的通用采集，以及其他战利品的接口边界时保留必要交叉说明。

## 1. 结论先行

这两轮侦察最值钱的不是又发现了二十多个功能，而是确认了五条可以长期约束 Mazz 的架构原则。

### 1.1 只统一契约，不强行统一实现

Mazz 应自己守住的不是 EPUB parser、全文引擎、OCR、网页归档器或中文分词器，而是这些跨 Surface 契约：

- `Asset Identity`：资产是谁；
- `Anchor`：证据具体在哪里，以及内容变化后怎样重定位；
- `Event / Episode`：机器事实与人类可读工作段落如何分层；
- `Node / Placement`：同一对象与其多个组织位置分离；
- `Relation + provenance`：关系为什么存在、由什么证据支持；
- `Promotion`：哪些可重建推断值得升格为长期结构；
- `Source of Truth / Rebuildable View`：谁是真相，谁只是可删除重建的旁路索引。

### 1.2 通用后台管线应收敛为四段

```text
Collector → Extractor → Enricher → Promoter
```

- **Collector** 只观察发生了什么，写入原始事实或指向原始事实的引用；
- **Extractor** 用确定性方法从 Asset/Event 中抽结构、文本、位置和元数据；
- **Enricher** 追加 OCR、实体、embedding、视觉描述、候选关系等可重建语义；
- **Promoter** 才允许把高价值结果写入长期组织结构、显式关系或用户可见知识。

这个分层能避免“每个模块都自己记历史、自己 OCR、自己 embedding、自己升格”的重复建设，也能把模型错误限制在可删除重建的旁路层。

### 1.3 原始数据是证据，索引与图是解释

建议坚持：

```text
文件 / EPUB / CBZ / URL / Session JSONL / Event
                    = Source of Truth

FTS / Vector / Episode / Shadow Relation / Analytics
                    = Rebuildable View
```

这条原则由 TwiCC、Pensieve、ArchiveBox、ActivityWatch 等项目从不同角度反复验证。Mazz 不应为了“统一”而接管外部工具的内部状态，也不应让 embedding、摘要或知识图谱成为唯一真相。

### 1.4 先便宜、确定、可审计，再升级模型

推荐默认阶梯：

```text
规则/格式解析
  → cheap local NLP / OCR
  → FTS / phrase / facet
  → embedding / visual retrieval
  → strong model on demand
```

模型只处理确定性工具覆盖不了、且价值足以支付成本的尾部问题。

### 1.5 许可证决定“怎么学”，不只决定“能不能用”

宽松许可项目可以进入认真复用候选；MPL/AGPL/source-available 项目仍然很有价值，但价值更多来自 schema、接口分类、行为测试、失败模式与 UX 事故，而不是把代码焊进 Mazz Core。

## 2. 研究优先级总表

优先级定义：

- **P0**：Post-W71 第一批拆 repo；目标是形成 ADR、契约和测试语料，不等于马上集成。
- **P1**：在 P0 契约稳定后做小型 PoC/benchmark；默认 sidecar 或 adapter。
- **P2**：保留接口和演进坑位，不急于引入依赖。
- **R**：主要作为设计/事故/边界病例库；默认不复用代码。
- **X**：本增量文档明确排除的主体方向。

| 方向 | 候选 | 优先级 | 最值得拿的原语 | 建议接法 | 许可证/主要风险 |
|---|---|---:|---|---|---|
| 工作事件账本 | [ActivityWatch](https://github.com/ActivityWatch/activitywatch) | P0 | Watcher / Bucket / Event / Heartbeat / Query | 拆 schema 与连续事件合并；不直接搬整套产品 | MPL-2.0；文件级 copyleft，复制前需逐文件审计 |
| 多父组织 | [Trilium](https://github.com/TriliumNext/Trilium) | P0 | `Node ≠ Placement`、clone 平权、hoist、继承、面包屑 | 作为 Mazz 多父 DAG 的病例库和测试生成器 | AGPL-3.0；不直接复制进宽松许可 Core |
| 背景索引 | [Pensieve](https://github.com/arkohut/pensieve) | P0 | `serve / record / watch`、backpressure、幂等重建、上下文回看 | 拆任务生命周期和吞吐控制，做 sidecar 原型 | Apache-2.0；隐私、磁盘和算力成本高 |
| 电子书/漫画适配 | [foliate-js](https://github.com/johnfactotum/foliate-js) | P0 | book interface、renderer、CFI、search、progress、annotation | pin commit + Mazz adapter，不裸追 latest | MIT；API 明确不稳定，EPUB 内容安全需 CSP |
| 抗变化 Anchor | [Readium Annotations](https://github.com/readium/annotations)、[Readium Web](https://github.com/readium/web) | P0 | 多 Selector、text quote/position、spatial/temporal selector、Annotation Set | 把 Selector 思路映射到 Mazz Asset Identity + provenance | BSD-3-Clause；规范仍在演进，不能假设所有阅读器互通 |
| 资源采集/归档 | [ArchiveBox](https://github.com/ArchiveBox/ArchiveBox)、[abx-dl](https://github.com/ArchiveBox/abx-dl) | P0 | URL→多 extractor、结果清单、插件注册、失败隔离、可重跑 | 只借 extractor contract；Mazz 保留自己的 Asset/Anchor | MIT；运行栈较重，浏览器隔离与归档安全复杂 |
| 双时间历史 | [Memento](https://github.com/shane-farkas/memento-memory) | P0 | valid time / transaction time、矛盾、版本、source audit | 先偷 schema 和测试，不依赖项目成熟度 | MIT；项目年轻，LLM 抽取质量与 benchmark 需独立复核 |
| 时间关系图 | [Graphiti](https://github.com/getzep/graphiti) | P1 | Episode→Entity/Relation、有效区间、provenance、混合检索 | 拆算法；不要让 Core 绑定其图数据库和 LLM 栈 | Apache-2.0；基础设施与推理成本较高 |
| 图像区域标注 | [Annotorious](https://github.com/annotorious/annotorious) | P1 | point/shape/region UI、W3C Annotation 兼容思路 | 作为 Region Anchor 编辑器或纠错层 | BSD-3-Clause；坐标归一化、缩放/裁剪迁移需自行补齐 |
| 文档解析 | [OpenOCR / OpenDoc-0.1B](https://github.com/Topdu/OpenOCR) | P1 | 轻量 layout→统一文字/公式/表格识别 | cheap extractor；低置信才升级强模型 | Apache-2.0（代码）；权重、训练数据与依赖另审 |
| 视觉检索 | [ColPali / ColQwen](https://github.com/illuin-tech/colpali) | P1 | 页面图像 multi-vector、late interaction、保留版式 | 视觉旁路召回，不替代 OCR/文本索引 | engine MIT；每个模型权重许可、显存和索引体积另审 |
| 全文/向量索引 | [sqlite-vec](https://github.com/asg017/sqlite-vec)、[Tantivy](https://github.com/quickwit-oss/tantivy) | P1 | SQLite 内向量旁路；BM25/phrase/facet/增量索引 | SQLite 管身份；Tantivy/vec 都是可重建索引 | MIT/Apache-2.0、MIT；sqlite-vec pre-v1，规模与 ABI 要实测 |
| 便宜本地 NLP | [Transformers.js](https://github.com/huggingface/transformers.js)、[jieba-rs](https://github.com/messense/jieba-rs) | P1 | 本地 embedding/NER/分类；中文分词/关键词 | Enricher 第一层；模型可替换且不直接 Promotion | Apache-2.0、MIT；模型权重许可与 WASM/ONNX 体积另审 |
| Agent 运行史 | [TwiCC](https://github.com/twidi/twicc) | P1 | provider JSONL 为真相、SQLite 为可重建视图、watch/re-sync | W66 Harness/Factory 的 Session Index 病例 | MIT；上游 JSONL 私有格式易漂移，Windows 原生支持不足 |
| Raw→Episode | [Dayflow](https://github.com/JerryZLiu/Dayflow) | P1 | 把屏幕活动压成人类可读 Episode、daily/weekly review | 只借 episode segmentation 与 review UX | MIT；当前偏 macOS，屏幕权限和隐私风险高 |
| 个人时间线查询 | [Personal Timeline](https://github.com/facebookresearch/personal-timeline) | R | 多源 importer、retrieval vs view-based QA、聚合问题 | 尸体解剖：研究 Event→视图→聚合查询 | Apache-2.0；2025-11-01 已归档，只作病例库 |
| 网页抽取协议 | [Pydoll](https://github.com/autoscrape-labs/pydoll) | P1 | Rendered Surface→Pydantic typed extraction、network/HAR | 偷 extraction contract；优先复用 Mazz 现有 Browser Surface | MIT；Python sidecar、站点 ToS/反自动化边界、维护集中度 |
| Source Adapter | [Zotero Translators](https://github.com/zotero/translators) | R | Web/Import/Export/Search 分类、detect/do、优先级、站点 fixture | clean-room 设计 Mazz Translator Registry | Zotero 默认 AGPL-3.0，单文件可能异质；逐文件审计 |
| 归档积木 | [Monolith](https://github.com/Y2Z/monolith)、[Readability](https://github.com/mozilla/readability) | P1 | rendered DOM→单 HTML；正文/标题/作者/时间抽取 | 作为 Archive extractor；输出必须隔离和清洗 | CC0-1.0、Apache-2.0；归档回放有 XSS/隐私风险 |
| 强归档参考 | [SingleFile](https://github.com/gildas-lormeau/SingleFile) | R | 单文件归档完整性、资源内联边界 | 外部工具或行为参考，不直接并 Core | AGPL；商业复用需另行许可评估 |
| 纵向分析 | [DuckDB](https://github.com/duckdb/duckdb) | P2 | 冷事件 Parquet + in-process OLAP | 与 operational SQLite 分层；按需分析 | MIT；新增 native 依赖与打包体积，明确非 W71 |
| 联邦检索 | [Mango Finder](https://github.com/moyangzhan/mango-finder) | R/P2 | 各设备本地索引、局域网联邦查询、文/图/音统一搜索 | 只保留 Search Federation 接口坑位与 UX 参考 | PolyForm Noncommercial + 内部使用例外；不可直接进入商业分发 |
| 关系调试 UI | [xyflow / React Flow](https://github.com/xyflow/xyflow) | P2 | 可视化实体、推断边、confidence、evidence | 开发者 Relation Inspector，不替换正式 Mindmap | MIT；避免产品层再造第二套组织系统 |
| 全量屏幕记忆 | [screenpipe](https://github.com/screenpipe/screenpipe) | R | accessibility tree 优先、OCR fallback、确定性数据权限、事件驱动采集 | 仅作产品/权限/事故参考 | Screenpipe Commercial License，source-available；商业使用需许可 |
| 浏览路径主线 | TabTreeTracker / Nyxt 等 | X | tab parent graph | 已在其他上下文出库，本文不展开 | 范围排除 |

## 3. 可复用架构原语

### 3.1 Event Ledger：ActivityWatch 的五件套

[ActivityWatch](https://github.com/ActivityWatch/activitywatch) 最值得拿的不是时间追踪 UI，而是：

```text
Watcher → Bucket → timestamped Event → Heartbeat → Query
```

与 Mazz 的结合点：

- Editor、Terminal、Search、Mindmap、Player、Library、Factory、Harness 各自产生自己的 watcher/event；
- Collector 不解释用户意图，只写可审计事实；
- heartbeat 用于合并连续状态，避免每秒制造重复事件；
- Query 层负责过滤、合并、分组和变换，不污染采集协议；
- Episode 是 Event Ledger 的下游人类阅读层，不反写或替代原始 Event。

拆 repo 时要重点研究：乱序事件、跨时区、睡眠/唤醒、AFK、窗口标题抖动、连续 heartbeat 合并、bucket schema 演进、导出/重建和 query semantics。

### 3.2 `Node ≠ Placement`：Trilium 的多父大型实证

[Trilium](https://github.com/TriliumNext/Trilium) 的 cloning 实际证明：所谓“原件”和“克隆件”并不存在，所有位置都只是同一 Note 的平等 Placement。

映射到 Mazz：

```text
Node / Asset / Concept
      1
      │
      ├── Placement A（项目视角）
      ├── Placement B（主题视角）
      └── Placement C（Episode/产出视角）
```

真正值得偷的是边界病例，而不是树形 UI：

- 删除一个 Placement 与删除 Node 的区别；
- 移动、复制、链接、hoist 的语义；
- 循环检测和祖先查询；
- 属性继承在多父冲突时如何决议；
- 搜索结果、面包屑、返回导航如何选择路径；
- 同一 Node 在多个父级下的排序、展开状态与权限；
- 版本历史属于 Node 还是 Placement。

建议把这些行为 clean-room 改写成 Mazz 的 DAG 测试语料，绝不复制 AGPL 实现代码。

### 3.3 可控后台索引：Pensieve 的 backpressure

[Pensieve](https://github.com/arkohut/pensieve) 将运行拆成 `serve / record / watch`，watcher 会依据实际索引速度动态提交任务。这给 Mazz 的价值远高于“全量截屏”：

- 采集与索引生命周期分离；
- ingestion 幂等；
- 后台队列有 backpressure、暂停、恢复和重建；
- 电池、前台负载、磁盘配额可成为调度输入；
- OCR、VLM、embedding 可以分别失败和重跑；
- 结果旁边保留时间前后文，便于回忆而不是只显示孤立命中。

Mazz 应复用这套运行原则，但不默认复制“每五秒截屏”的产品边界。屏幕记录属于高敏感可选 Collector，绝不能成为 Personal Operational Index 的前提。

### 3.4 稳定 Anchor：Readium × Foliate-js × Annotorious

[Readium Annotations](https://github.com/readium/annotations) 提供的关键思想是：同一个 Target 可以保存多个 Selector，让系统在内容发生小变化后选择最可靠的重定位方式。

建议的 Mazz Anchor 形态：

```text
Mazz Anchor
  = Asset Identity
  + selector[]
      - exact quote + prefix/suffix
      - text position
      - structural path / CFI
      - page / region bbox / polygon
      - media time range
  + provenance
  + resolver version
  + confidence / repair history
```

[foliate-js](https://github.com/johnfactotum/foliate-js) 负责证明 EPUB/MOBI/CBZ 等格式如何落到统一 book/renderer/search/progress 接口；[Annotorious](https://github.com/annotorious/annotorious) 可以承担图片/漫画区域的交互式创建与纠错。

这三者相乘后，文本高亮、EPUB CFI、漫画格、图片区域、音视频时间段可以共享一套上层 Annotation/Anchor 思维，而不是每种媒体重新发明地址系统。

### 3.5 双时间关系：Graphiti × Memento

仅有 `created_at` 不足以描述长期知识。需要至少区分：

- **valid time**：事实在现实/世界/工作区中何时成立；
- **transaction/knowledge time**：系统何时知道或记录这件事。

例如：

```text
bug 自 8 月 1 日已经存在      = valid_from
8 月 7 日才被日志或人发现      = known_from
8 月 9 日被修复                = valid_to
8 月 10 日系统才摄取修复记录    = known_to / superseded_at
```

[Graphiti](https://github.com/getzep/graphiti) 值得拆 Episode→Entity/Relation、时间有效区间、provenance 和 hybrid retrieval；[Memento](https://github.com/shane-farkas/memento-memory) 值得拆 SQLite bitemporal schema、矛盾检测、实体消歧、历史版本和 source audit。

Mazz 不应在研究阶段直接绑定 Neo4j/FalkorDB 等图数据库。先把时间语义和证据链写进自己的接口，再决定存储形态。

### 3.6 Source of Truth 与旁路索引：TwiCC

[TwiCC](https://github.com/twidi/twicc) 的核心设计与 Mazz 非常契合：Claude Code/Codex 原生 JSONL 继续是真相，TwiCC 只建立可以删除重建的 SQLite 索引。

对 W66 Harness / Factory 的启发：

- Provider session 文件不迁入 Mazz 私有格式；
- adapter 负责容错解析和 schema version detection；
- Mazz index 只存查询、关联和 UI 所需的派生视图；
- 重扫必须幂等；截断、部分写入、文件重命名和归档迁移必须可恢复；
- Session、Files、Git、Terminal、Artifacts、Orchestration 作为可关联视图，不冒充 Provider 原始状态。

### 3.7 搜索底座：精确、全文、语义、关系必须并存

推荐层次：

```text
exact / regex / identifier
        ↓
FTS / BM25 / phrase / facet
        ↓
semantic vector / visual multi-vector
        ↓
relation / temporal rerank
```

- [sqlite-vec](https://github.com/asg017/sqlite-vec) 适合本地、可重建的中小规模向量旁路，但仍是 pre-v1，不能当无限规模终局；
- [Tantivy](https://github.com/quickwit-oss/tantivy) 适合规模上来后的 BM25、phrase、facet 和增量全文索引；
- [jieba-rs](https://github.com/messense/jieba-rs) 可做廉价中文候选生成；
- [Transformers.js](https://github.com/huggingface/transformers.js) 可在 JS/WASM 环境本地跑 embedding、NER、分类和部分多模态任务；
- embedding 永远不能成为唯一检索真相；原文、定位、来源和时间必须可回溯。

### 3.8 Harvest / Translator：ArchiveBox × Pydoll × Zotero

这一组解决的不是浏览历史，而是“一个外部 Surface 如何可靠变成 Mazz Asset”。

推荐抽象：

```text
Source Discovery
  → Rendered/Authenticated Surface
  → Translator Detection
  → Typed Extraction
  → Raw Snapshot + Extracted Manifest
  → Asset + Anchor + provenance
```

- [ArchiveBox](https://github.com/ArchiveBox/ArchiveBox) / [abx-dl](https://github.com/ArchiveBox/abx-dl)：研究同一 URL 交给多个 extractor、结果清单、插件生命周期、可重跑和输出隔离；
- [Pydoll](https://github.com/autoscrape-labs/pydoll)：研究如何从真实渲染 DOM、Shadow DOM、iframe、network/HAR 映射到 typed object；
- [Zotero Translators](https://github.com/zotero/translators)：研究 `Web / Import / Export / Search` 分类、detect/do 两阶段、优先级、稳定 translator ID 和站点 fixture 测试；
- [Monolith](https://github.com/Y2Z/monolith)：负责把已渲染 DOM 与资源揉成单 HTML；
- [Readability](https://github.com/mozilla/readability)：负责正文、标题、作者、时间等通用抽取；
- [SingleFile](https://github.com/gildas-lormeau/SingleFile)：只做完整性与边界病例参考。

Mazz 应自建宽松许可、可审计的 `Source Adapter / Translator Registry`，不要直接搬 Zotero/SingleFile 的 copyleft 代码。

## 4. 值得做的“乘法套餐”

### 4.1 多模态 Anchor

```text
Readium multi-selector
× foliate-js book/renderer/CFI
× Annotorious region editing
× Mazz Asset Identity + provenance
= 抗内容变化的文本/EPUB/漫画/图片/媒体 Anchor
```

关键收益不是“能画框”，而是让机器误识别的 panel/bbox 可以由用户一次纠正，并成为长期稳定的证据地址。

### 4.2 低成本全资产索引

```text
Format parser / Readability
× OpenOCR cheap document parsing
× Tantivy FTS
× sqlite-vec semantic side index
× ColPali visual retrieval on demand
= 文本优先、视觉补召回、强模型只处理尾部的资产索引
```

检索结果必须回到原始 Asset + Anchor；OCR/embedding/视觉描述都只是 Enrichment。

### 4.3 Personal Operational Memory

```text
ActivityWatch-style Event Ledger
× Dayflow-style Episode
× Graphiti/Memento temporal relation
× Trilium-style multi-parent Placement
= 可按时间、项目、问题、主题和产出阅读的工作运行史
```

这里的核心不是全知用户画像，而是回答：以前怎么解决过、什么时候开始重要、哪些资产经常一起工作、当时为什么做这个决定。

### 4.4 Agent 行为进入工作区运行史

```text
TwiCC rebuildable Session Index
× W66 Harness
× Factory runs / decisions / artifacts
× Event / Episode / Anchor
= Agent 行为成为可审计的工作运行史，而不是聊天记录孤岛
```

Provider 文件继续是真相；Mazz 只建立可查询、可关联、可重建的视图。

### 4.5 Harvest 变成结构化资产管线

```text
Mazz Browser Surface
× Pydoll-style typed extraction contract
× Zotero-style Translator Registry
× ArchiveBox multi-extractor manifest
× Monolith / Readability
= 从真实会话到可复现 Asset 的通用采集链
```

## 5. 许可证与接法边界

> 下表是工程分流，不是法律意见。真正引入依赖或复制代码前，仍需以目标 commit 的 LICENSE、NOTICE、依赖树和模型卡为准。

### 5.1 可进入认真复用候选

| 许可 | 项目 | 默认动作 |
|---|---|---|
| MIT | foliate-js、Tantivy、jieba-rs、Memento、ColPali engine、TwiCC、Dayflow、Pydoll、DuckDB、xyflow | 可做 adapter、vendor、fork 或直接依赖；保留版权/许可文本，仍需审依赖与模型 |
| Apache-2.0 | Pensieve、Transformers.js、OpenOCR、Graphiti、Personal Timeline、Readability | 可认真拆代码；注意 NOTICE、修改说明、专利条款和模型/数据集另许可 |
| BSD-3-Clause | Readium Annotations/Web、Annotorious | 可认真复用；保留声明，避免用项目名暗示背书 |
| MIT OR Apache-2.0 | sqlite-vec | 可复用，但 pre-v1 和 native ABI 风险高于许可证风险 |
| CC0-1.0 | Monolith | 代码许可宽松；仍要审第三方依赖、归档内容版权与回放安全 |

### 5.2 适合隔离、clean-room 或只学设计

| 风险类型 | 项目 | 默认动作 |
|---|---|---|
| MPL-2.0 文件级 copyleft | ActivityWatch | 优先借 schema/协议/测试；复制文件前做边界审计，必要时 sidecar |
| AGPL-3.0 强 copyleft | Trilium、SingleFile、Zotero 及大量 translators | 不复制进宽松许可 Core；以公开行为、文档和 fixture 做 clean-room 契约/测试 |
| 商业型 source-available | screenpipe | 仅作权限、采集、隐私与事故参考；商业使用需单独许可 |
| PolyForm Noncommercial | Mango Finder | 只学 Search Federation；不可直接进入对外商业分发，内部使用例外也不能替代正式许可评估 |
| 已归档 | Personal Timeline | 尸体解剖；不建立运行时依赖 |

### 5.3 模型与数据必须单独审

库的许可证不自动覆盖模型权重、tokenizer、训练数据和测试集：

- ColPali engine 是 MIT，但 ColPali/ColQwen/ColSmol 各权重需看各自 model card；
- OpenOCR 代码是 Apache-2.0，具体 OpenDoc/UniRec 权重与依赖模型仍需逐项确认；
- Transformers.js 是 Apache-2.0，但下载的 ONNX/量化权重沿用或受制于原模型许可；
- 中文 tokenizer、OCR 字典和 benchmark 数据集也应进入 SBOM/NOTICE 清单。

## 6. Post-W71 拆 repo 路线图

### 6.1 第 0 批：只定契约，不引依赖（2–3 个研究日）

目标：先把 Mazz 自己要守的边界写清楚，防止拆 repo 变成追随某个实现。

建议产出四份短 ADR：

1. `Event / Episode / Promotion Contract`；
2. `Node / Placement / Multi-parent Semantics`；
3. `Anchor / Selector / Resolver Contract`；
4. `Source of Truth / Rebuildable Index Contract`。

每份 ADR 必须写明：唯一身份、幂等键、provenance、版本、删除/重建语义、错误隔离和 Promotion 权限。

### 6.2 第一批完整解剖：七条骨头

#### A. ActivityWatch：事件骨头

**看什么：** watcher/client/server 边界，bucket/event/heartbeat/query schema，连续事件合并，AFK，导出与同步。
**回答什么：** Mazz 的跨 Surface Event 最小公共字段是什么；哪些字段必须属于 payload 而不是 Core schema。
**产出：** Event Ledger JSON Schema、乱序/重复/跨日/睡眠恢复测试、连续状态压缩算法比较。
**禁止：** 不创建 W71 telemetry，不默认开启屏幕或窗口采集。

#### B. Trilium：多父骨头

**看什么：** branch/clone/hoist/attribute inheritance、删除/移动/循环/面包屑/搜索。
**回答什么：** Node 与 Placement 的所有权、排序、权限、版本、删除和路径选择规则。
**产出：** 至少 30 个多父 DAG 行为测试；一份 `Node ≠ Placement` ADR。
**禁止：** 不复制 AGPL 代码；用文档与可观察行为 clean-room 重写测试。

#### C. Pensieve：背景索引骨头

**看什么：** `serve / record / watch`、任务提交、动态节流、插件结果、重建、磁盘策略。
**回答什么：** Mazz background job 如何 pause/resume/cancel/retry；怎样按电池、前台负载和队列积压降级。
**产出：** Backpressure 状态机、幂等 job key、失败恢复矩阵、100k 任务模拟。
**禁止：** 不把“全屏记录”当作索引系统前提。

#### D. foliate-js × Readium × Annotorious：Anchor 骨头

**看什么：** book interface、CFI、relocation、search/progress/overlayer；多 Selector；region shape 序列化。
**回答什么：** 不同媒体的统一 Anchor envelope 长什么样；resolver 如何降级和报告 confidence。
**产出：** Anchor capability matrix；文本插入/删除、章节重排、图片缩放/裁剪、CBZ 页重排后的重定位测试。
**禁止：** foliate-js 必须 pin commit，通过 adapter 隔离不稳定 API；渲染不可信 EPUB 必须有 CSP/沙箱。

#### E. ArchiveBox × abx-dl：Harvest 骨头

**看什么：** extractor registry、插件 metadata、结果 manifest、重试、幂等、输出目录、浏览器隔离。
**回答什么：** 一个 Source Adapter 如何声明 detect/capabilities/input/output；多 extractor 如何共存而不互相覆盖。
**产出：** `Source Adapter Contract`、`ExtractionResult Manifest`、5 类 fixture（文章、动态站、视频页、系列页、登录页）。
**禁止：** 浏览器历史导入不进入本文研究范围；只研究单次/显式资产采集。

#### F. Memento × Graphiti：时间关系骨头

**看什么：** valid/transaction time、episode provenance、矛盾/失效、实体消歧、hybrid retrieval。
**回答什么：** Shadow Relation 怎样保留“何时成立/何时获知/由何证据得出”；Promotion 如何避免图膨胀。
**产出：** bitemporal SQLite 最小 schema、contradiction fixture、as-of query 语义、relation promotion gate。
**禁止：** 第一阶段不引图数据库，不把 LLM 抽取写成不可回滚真相。

#### G. TwiCC：Agent 运行史骨头

**看什么：** Claude/Codex JSONL parser、文件 watcher、re-sync、SQLite schema、Session/File/Git/Terminal/Artifact 关联。
**回答什么：** Mazz 如何在上游 schema 漂移时容错；如何识别部分写入、归档和 session relocation。
**产出：** Provider Adapter Protocol、golden JSONL corpus、删除索引后一键重建验收。
**禁止：** 不修改 Provider 原生文件，不让 Mazz index 反向成为真相。

### 6.3 第二批小型 PoC：用 benchmark 决定，不用感觉决定

#### Search PoC

候选：sqlite-vec、Tantivy、jieba-rs、Transformers.js。
数据档位：10k / 100k / 250k 文档或 chunk；中文、英文、混合语料；256/768/1024 维向量。
指标：索引时间、增量写入、冷/热查询 P50/P95、磁盘、内存、删除/重建、打包体积、跨平台 ABI。
决策门：只有当 SQLite FTS 明显不足，才引入 Tantivy；只有当语义召回带来可验证增益，才启用向量旁路。

#### OCR / Visual Retrieval PoC

候选：OpenOCR/OpenDoc、ColPali/ColQwen。
样本：中文扫描 PDF、复杂表格/公式、漫画对白页、无对白漫画页、低清截图。
指标：page/panel recall、Anchor 定位误差、单页耗时、显存/内存、索引体积、离线能力。
决策门：OCR 能解决的先 OCR；只有无文字或版式语义显著时才使用视觉 multi-vector。

#### Episode PoC

候选：Dayflow、ActivityWatch 查询/合并思路、Personal Timeline 视图查询。
指标：压缩比（Event→Episode）、边界准确度、用户可纠正性、可解释证据、日报/周报实用度。
决策门：Episode 必须能展开回原始 Event，不允许只有不可审计摘要。

#### Source Adapter PoC

候选：Pydoll、Readability、Monolith、自建 translator contract。
指标：动态页面稳定性、登录态复用、typed extraction 成功率、fixture 可重复性、归档回放安全。
决策门：优先使用 Mazz 已有 Browser Surface；Pydoll 只在 Python sidecar 能显著降低复杂度时采用。

### 6.4 第三批只留接口坑位

- DuckDB：等待冷事件/Parquet 规模证明 OLAP 必要性；
- Mango Finder：只定义 federation query/response contract，不复用受限许可代码；
- xyflow：只有 Relation Inspector 的调试需求成熟后再引入；
- screenpipe：持续观察权限模型、accessibility-first 和事件驱动采集，不建立代码依赖；
- Personal Timeline：只保留聚合查询与 importer 测试材料，不恢复项目依赖。

## 7. 研究验收门槛

任何候选从“研究储备”进入正式 roadmap 前，至少满足：

- 有明确的 Mazz-owned interface，不让外部项目 schema 反客为主；
- 原始 Source of Truth 不被派生索引替代；
- 所有 Enrichment 可删除重建，并有版本/模型/参数 provenance；
- 有幂等键、重试、backpressure、取消和故障恢复方案；
- 有隐私/权限/保留期/硬删除设计；
- 有跨平台打包、native ABI、磁盘和内存预算；
- 有目标 commit 的 LICENSE/NOTICE/SBOM/模型卡审计；
- 有代表性 fixture 和基准，不凭 demo 决策；
- 有“为什么不采用”的退出条件；
- 明确写为 Post-W71，不修改 W71 的冻结范围。

## 8. 推荐的实际拆解顺序

若只安排一轮紧凑研究，推荐顺序如下：

1. **Readium Annotations + foliate-js + Annotorious**：先定 Anchor，因为后续 OCR、检索、关系都要回到可定位证据；
2. **Trilium**：定 Node/Placement，多父语义会影响 Episode、Mindmap 和搜索结果呈现；
3. **ActivityWatch + Pensieve**：定 Event Ledger 与 background indexing；
4. **ArchiveBox + abx-dl**：定 Collector/Extractor 插件契约；
5. **Memento + Graphiti**：在前述证据与时间层稳定后定 temporal relation；
6. **TwiCC**：把 Agent/Factory/Harness 纳入同一套可重建运行史；
7. **sqlite-vec/Tantivy/OpenOCR/ColPali**：最后用同一批真实 fixture 做底座 benchmark。

这一路径的意图是先定“地址、身份、事实、时间和真相边界”，再选搜索引擎与模型。否则很容易先得到一个漂亮的向量库，后来才发现命中结果无法稳定回到原资产。

## 9. 最终边界声明

本文的所有候选、优先级、PoC 和 repo 拆解建议，均属于 **Post-W71 / Research Reserve**。它们可以在 W71 封板后转化为独立研究任务，但当前不得：

- 修改 W71 验收范围；
- 向 W71 偷渡 native dependency、daemon、OCR/LLM 模型或图数据库；
- 把 repo 侦察结论写成已经选型；
- 把浏览器历史/Personal Web Graph/Tab parent graph 重新扩成本文主体；
- 在未完成许可证、模型权重、SBOM 与安全审计前复制实现代码。

真正值得保留的增量，不是“收藏了二十多个仓库”，而是这套组合方式：

> **A 的成熟局部原语 × B 的事故经验 × Mazz 已经存在的组织哲学 = 一个不必从零手搓、同时仍由 Mazz 自己定义边界的系统。**
