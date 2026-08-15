# Post-W71 OSS 研究储备工作流

> 状态：`REGISTERED / RESEARCH RESERVE / NOT APPROVED FOR IMPLEMENTATION`
> 登记日期：2026-08-15
> 原始材料 SHA-256：`143646E3F3092571836ACA206087955ED21DE43E2AB388CC3BEF879F871D4A4D`
> 全文镜像：[Mazz-Post-W71-GitHub-拿来主义研究储备.md](./Mazz-Post-W71-GitHub-拿来主义研究储备.md)
> 跨波次状态真源：`C:\Users\Administrator\Downloads\交付区\Mazz 当前未落地全景-W71归并版.md`

## 1. 并入结论

这份材料进入 Mazz 的方式不是新增二十多个依赖，而是建立一条 Post-W71 的 OSS 研究准入管线：

```text
外部项目线索
  → 研究储备登记
  → Mazz-owned Contract / ADR
  → clean-room 行为测试或隔离 PoC
  → benchmark + license / SBOM / model-card Gate
  → 回写未尽全景并取得独立波次授权
  → 才允许实现或引入依赖
```

原材料中的 `P0/P1/P2/R/X` 只表示研究优先级，不是产品优先级，也不构成 W72–W81 的开工许可。

本次只做文档入库、归属映射和 Gate 固化；不修改产品代码，不安装依赖，不 clone 仓库，不启动 PoC，不扩大 W71。

## 2. 长期架构约束

研究储备补强了七条跨波次契约：

1. `Asset Identity`：事实载体的稳定身份；
2. `Anchor / Selector / Resolver`：证据定位、重定位、置信度与修复史；
3. `Event / Episode`：原始行为事实与人类可读工作段落分层；
4. `Node / Placement`：对象与多个组织位置分离；
5. `Relation + provenance + bitemporal time`：关系的证据、有效时间与获知时间；
6. `Promotion`：可重建推断升格为长期结构的唯一闸；
7. `Source of Truth / Rebuildable View`：原件不迁入派生索引，索引可删可重建。

后台能力统一按以下职责切分：

```text
Collector → Extractor → Enricher → Promoter
```

Collector 不解释意图；Extractor 优先确定性解析；Enricher 产生可重建的 OCR、embedding、实体和候选关系；只有 Promoter 可以在权限与证据 Gate 后写入长期结构。

## 3. 研究包与既有波次的唯一归属

| 研究包 | 主要外部病例 | Mazz 产物 | 唯一归属 | 前置 / Gate |
|---|---|---|---|---|
| R0 契约冻结 | 全部候选 | Event/Episode/Promotion、Node/Placement、Anchor/Resolver、Source-of-Truth/Rebuildable-Index 四份 ADR | W72 研究前置 | W71 RC 后另行批准；零依赖 |
| R1 Stable Anchor | Readium、foliate-js、Annotorious | Anchor capability matrix、resolver 降级规则、文本/EPUB/图片/漫画重定位 fixture | W75/W78 | W72 Asset Identity；目标 commit 与内容沙箱审计 |
| R2 Multi-parent | Trilium | `Node ≠ Placement` ADR、至少 30 个 DAG 边界测试 | W76 | clean-room；不得复制 AGPL 实现 |
| R3 Event / Background Index | ActivityWatch、Pensieve、Dayflow、Personal Timeline | Event schema、heartbeat 合并、Episode、backpressure 状态机、100k job 模拟 | W81 | 默认本地、可关闭/导出/清空；不默认截屏 |
| R4 Harvest / Translator | ArchiveBox、abx-dl、Pydoll、Zotero、Monolith、Readability、SingleFile | Source Adapter Contract、ExtractionResult Manifest、五类网页 fixture | W74 | 优先复用 Mazz Browser Surface；copyleft 项只做 clean-room/隔离参考 |
| R5 Temporal Relation | Memento、Graphiti | bitemporal SQLite 最小 schema、矛盾与 as-of 查询、relation promotion gate | W77 | W75/W76；不先引图数据库 |
| R6 Agent Operational History | TwiCC | Provider Adapter Protocol、golden JSONL corpus、可删除重建 Session Index | W66/W73/W81 | Provider 文件继续是真相；不得反写上游 |
| R7 Search / OCR Benchmark | sqlite-vec、Tantivy、jieba-rs、Transformers.js、OpenOCR、ColPali | 10k/100k/250k benchmark、OCR/视觉分流、体积/ABI/内存账 | W75/W78 | 先 FTS/OCR，验证增益后才启用向量或视觉旁路 |
| R8 只留接口坑位 | DuckDB、Mango Finder、xyflow、screenpipe | federation/OLAP/Relation Inspector/敏感 Collector 的接口草案 | W72/W75/W81 候选 | 没有规模与许可证据不引依赖 |

W79 只消费 W72 的 External Tool Adapter 与进程/许可纪律；这里发现的 Python sidecar、CLI 或 GUI 项目不能自动成为 W79 的实现选择。

## 4. 固定研究顺序

在 W71 封板并获得独立研究授权后，默认顺序为：

1. Readium + foliate-js + Annotorious：先冻结可定位证据；
2. Trilium：再冻结对象与组织位置语义；
3. ActivityWatch + Pensieve：定义事件与后台索引生命周期；
4. ArchiveBox + abx-dl：定义显式采集与 extractor manifest；
5. Memento + Graphiti：在证据层稳定后定义双时间关系；
6. TwiCC：让 Agent/Factory 运行史进入可重建视图；
7. sqlite-vec/Tantivy/OpenOCR/ColPali：最后用同一批真实 fixture 选底座。

先定地址、身份、事实、时间与真相边界，再选搜索引擎和模型。不得为了展示效果倒序引入向量库、图数据库或模型权重。

## 5. 从 Research Reserve 升格的硬门

任何项目或设计进入正式 roadmap 前必须同时满足：

- 有 Mazz-owned interface，外部 schema 不成为产品公共协议；
- 原始 Source of Truth 不被摘要、embedding、图或 SQLite 旁路取代；
- Enrichment 可删除重建，记录版本、模型、参数与 provenance；
- 明确幂等键、重试、backpressure、取消、恢复和硬删除；
- 明确隐私、权限、默认开关、保留期与敏感字段；
- 有 Windows/Electron 打包、native ABI、磁盘、内存和启动成本；
- 针对目标 commit 重新核验 LICENSE、NOTICE、依赖树、SBOM 与模型卡；
- 有代表性 fixture、基准和“不采用”的退出条件；
- 回写跨波次未尽全景，并由维护者单独批准对应波次。

本次入库没有独立复核材料中各仓库的最新状态和许可证；原表只能作为侦察线索。真正复用时必须以目标 commit 的原始仓库证据重新审计。

## 6. 永久禁区

- 不向 W71 偷渡 daemon、native dependency、OCR/LLM 权重、图数据库或新正式入口；
- 不把 GitHub 侦察写成已经选型、已经集成或已经验收；
- 不让 Activity/Event 变成逐键监控、默认截屏或全知用户画像；
- 不复制 Trilium/Zotero/SingleFile 等 copyleft 实现进 Mazz Core；
- 不把 Neo4j/FalkorDB、向量库、DuckDB 或 Python sidecar预设为终局；
- 不让 Provider 派生索引反写或替代 Claude/Codex 等原生 session 文件；
- 不把 `xyflow` 发展成第二套正式 Mindmap；
- 不把浏览器历史、Personal Web Graph 或 Tab parent graph重新扩为本储备主体。

## 7. 当前停止线

当前状态为：材料全文已入库、来源哈希已登记、研究包已映射到 W72/W74/W75–W81、准入和退出 Gate 已冻结。

下一项合法动作只能是：W71 结束后，在维护者明确批准的独立研究任务中产出 R0 四份 ADR。未经授权不得进行 repo 拆解、clone、安装、PoC 或产品实现。
