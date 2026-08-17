# W74a Ingestion Pipeline 施工规格

> 冻结日期：2026-08-17
> 开工基线：`main@607d030`
> 状态：`W74a COMPLETE TO THIN-SLICE SPEC`

## 1. 目标

W74a 只解决一件事：维护者已经明确选入某个本地 Factory 项目的材料，在开工前得到稳定身份、真值层级、项目内快照、可重建切片目录、W72 Asset Envelope 和显式冲突证据。

现有文件或已核准报告仍是真相源。W74a 不扫描工作区，不自动发现资料，不把全文常驻 Prompt，也不建立 Universal Asset DB。

## 2. 冻结边界

本波进入：

- 复用 Factory 既有“嵌入资料”与人工核准 M0 报告入口；
- `mazz.ingestion-request/v0` 严格请求；
- `source-fact / derived / estimate / hypothesis / missing` 五层；
- 项目 `.mazz/materials/` 文件优先材料区；
- 正文快照、确定性 chunk、manifest、W72 Envelope、可重建 catalog；
- 同身份同登记幂等；同身份异登记阻断并落冲突证据；
- 开 Run 前完成登记，新 W68 单次 Run 只取得 Asset Envelope 输入引用。

本波不进入：

- W74b 外界 Feed、W65 站点抓取、变化检测、聚类、热度或自动路由；
- W74c Conversation Promotion、Decision/Method/Finding 自动升格、撤销或 supersedes；
- 全工作区扫描、SQLite、向量库、万能 Graph、后台 watcher；
- 新 UI、材料中心、批量导入向导或正式入口；
- 自动覆盖冲突、自动 Promotion、Publication、Canon 或方法改写；
- W68 max/legacy 的 Production Run 迁移。

## 3. 数据契约

### 3.1 Ingestion Request

```text
schema       = mazz.ingestion-request/v0
assetId      = 调用方生成的稳定语义身份；不得由 path 推导
projectId    = 本地项目身份
projectPath  = 项目材料区落点
title/type   = 可读标题与项目快照类型
layer        = source-fact | derived | estimate | hypothesis | missing
text         = 项目快照正文；missing 必须为空
sourceRef    = 不透明来源钩
provenance   = 显式登记来源
importedAt   = 可复验 ISO 时间
```

未知顶层字段、secret 字段、非法层级、伪 missing、空正文和超过 2,000,000 字符的单件材料全部 fail closed。

### 3.2 文件布局

```text
<project>/.mazz/materials/
├─ assets/<sha256(assetId)[0:24]>/
│  ├─ content.txt
│  ├─ chunks.ndjson
│  ├─ asset-envelope.json
│  └─ manifest.json
├─ conflicts/<asset-key>/<candidate-registration-hash>.json
└─ catalog.json
```

目录键只用于安全落盘，不能反向充当资产身份。Envelope 与 catalog 不保存正文；chunk 是可重建索引窗口，不成为资产结构。

## 4. 原子性、幂等与恢复

1. 单项目请求由主进程 `IngestionPipeline` 串行化；Windows 下队列键大小写归一。
2. 新材料先完整写入 `.staging-*`，再以目录 rename 提交。
3. catalog 由所有已提交 manifest 重建并原子替换；提交目录成功而 catalog 写失败时，重试可修复。
4. 孤儿 `.staging-*` 只在已验证的项目 `.mazz/materials` 根内清理。
5. 相同 `assetId + registrationHash` 返回 `ALREADY_REGISTERED`；`importedAt` 改变不制造假版本。
6. 同一 `assetId` 的正文、来源、层级或登记 provenance 改变时返回 `INGESTION_CONFLICT`，保留 current，候选只写 hash/sourceRef 冲突证据，绝不自动覆盖。

## 5. Factory 接线

- 手动 TXT/Markdown 默认 `source-fact`；需要提取的 DOCX/ODT/RTF/HTML/EPUB 默认 `derived`。
- M0 人工核准报告始终为 `derived`，登记时重新读取完整落盘报告，不用界面 20,000 字摘要冒充全文。
- 开工顺序固定为：`ensureTaskFolder → ensureW74aMaterials → ensureProductionRun`。
- Factory 任务保存 `materialRefs/materialCatalogPath`；新 W68 单次 Run 只把 `asset-envelope` 作为 `inputArtifactRefs`，不复制正文。
- 冲突将任务保持 `blocked/paused`，并在原 Factory Desk 写“项目材料需要人工裁决”；没有隐式降级或跳过材料。

## 6. Definition of Done

1. 严格 schema、五层和 secret/未知字段拒绝有合同证据；
2. chunk 通过 offset 可逐字拼回正文；
3. 真实磁盘生成四件套与 catalog；
4. W72 Envelope 合法，Envelope/catalog 不含正文；
5. 同登记幂等，catalog 损坏可由 manifest 重建；
6. 孤儿 staging 精确收口；
7. 同身份异登记不覆盖 current，并保存冲突证据；
8. 同项目并发串行且结束后活动队列归零；
9. Factory 重读完整源文件、持久化输入引用、开 Run 前登记；
10. W74b/W74c/W65/W69/W79/W82、自动 Promotion 与万能数据库保持未启动。

W74a 完成不自动批准 W74b 或 W74c。
