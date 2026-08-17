# W74a Ingestion Pipeline 检查点

> 日期：2026-08-17
> 开工基线：`main@607d030`
> 结论：`PASS — W74a COMPLETE TO THIN-SLICE SPEC`
> 机器证据：[`W74A_INGESTION_PIPELINE_IMPLEMENTATION.json`](./evidence/W74A_INGESTION_PIPELINE_IMPLEMENTATION.json)

## 1. 本波关闭的真实缺口

W72 已冻结 Asset Envelope，W73 已封住 Factory 的单一 Production Run 与运行时收敛，但维护者明确选入项目的本地材料此前仍只存在于任务内嵌文本：没有稳定资产身份、真值层级、项目内完整快照、可重建切片目录，也没有同身份异登记时可审计且不覆盖当前材料的冲突证据。

W74a 只补齐这条“既有本地材料进入项目”的窄路径。它不扫描工作区，不抓取外部站点，不自动升格 Conversation，也不建立万能资产数据库。

## 2. 实现事实

- `main/ingestion-pipeline.js`：新增主进程 `IngestionPipeline`，以严格 `mazz.ingestion-request/v0` 接收明确选入的文本材料，支持 `source-fact / derived / estimate / hypothesis / missing` 五层，拒绝未知字段、secret、伪 missing、空正文与超限正文。
- 每件材料在 `<project>/.mazz/materials/assets/<asset-key>/` 保存 `content.txt`、`chunks.ndjson`、`asset-envelope.json`、`manifest.json`；`catalog.json` 由已提交 manifest 重建，Envelope 与 catalog 不复制正文。
- 同项目登记串行化，先写 `.staging-*` 再 rename 提交；孤儿 staging 只在已验证的材料根内收口。相同登记幂等；同 `assetId` 异内容、来源、层级或 provenance 时只保存冲突证据并返回 `INGESTION_CONFLICT`，绝不覆盖 current。
- `main/main.js` / `preload/bridge.js`：只增加 `ingestion:registerText` 一条 IPC；没有新增 BrowserWindow、页面、后台 watcher 或正式产品入口。
- `renderer/modules/factory/index.js`：复用既有嵌入资料与人工核准 M0 报告。开工顺序固定为 `ensureTaskFolder → ensureW74aMaterials → ensureProductionRun`，重新读取完整源文件并持久化 W72 Asset Envelope 引用；W68 单次 Run 不复制正文。
- 材料冲突保持任务 `blocked/paused`，并由原 Factory Desk 明示“项目材料需要人工裁决”；没有把冲突误报为 W73 账本恢复，也没有静默跳过。

## 3. 验证矩阵

| 要求 | 本轮证据 | 结论 |
|---|---|---|
| 严格 schema / 五层 / secret | W74a 合同覆盖未知字段、非法层级、secret、missing 与大小上限 | PASS |
| chunk 无损 | 通过 offset 按序拼回完整正文 | PASS |
| 真实磁盘四件套与 catalog | 临时项目实盘登记并重读全部产物 | PASS |
| W72 Envelope 兼容 | 复用 W72 校验器；Envelope/catalog 均不含正文 | PASS |
| 幂等与目录修复 | 重复登记返回 `ALREADY_REGISTERED`；损坏 catalog 从 manifest 重建 | PASS |
| 原子性与清理 | staging 后 rename；孤儿 staging 精确收口 | PASS |
| 冲突不覆盖 | current hash/正文/catalog 保持不变，候选证据单独落盘 | PASS |
| 并发与资源基线 | 同项目并发串行；结束后活动队列为零 | PASS |
| Factory 主链 | 重读完整源文件、持久化 material refs、二次调用幂等、开 Run 前登记 | PASS |
| W68/W73 回归 | W68a `11/11`、W68b `9/9`、W68c `9/9`；W73h `6/6` | PASS |
| 构建与全量 | `npm run build`；全量测试文件 `173/173` | PASS |

## 4. 数据与恢复语义

- 原文件或已核准报告仍是真相源；项目材料区保存的是开工时可审计快照，不夺取原格式所有权。
- `assetId` 是调用方生成的稳定语义身份，目录哈希只负责安全落盘；移动源文件不会静默制造另一个身份。
- catalog 是派生目录，可以从 manifest 重建；chunk 是索引窗口，可以从正文重建。二者都不是新的领域真相。
- 同身份异登记必须人工裁决。W74a 没有 overwrite、merge、supersede、Promotion、Publication 或 Canon 权力。
- 已提交资产目录成功而 catalog 更新失败时，下一次登记会先重建 catalog；未提交 staging 不冒充有效材料。

## 5. 回滚与边界

回滚可独立移除一条 IPC、`IngestionPipeline`、Factory 的登记接线和 W74a 派生文件；W68/W73 账本、历史 Factory 任务和原始材料不需迁移或删除。项目 `.mazz/materials/` 是新增的可审计快照区，回滚代码不自动删除用户数据。

本波明确未做：W74b 外界 Feed、W65 四站爬取、变化检测、W74c Conversation Promotion、自动 Decision/Method/Finding 升格、全工作区扫描、向量库、SQLite、万能 Graph、材料中心 UI、W68 max/legacy 迁移、W79 外部工具运行时、W82 组织编译、W69 Hub/Market。

## 6. 封波判定

W74a 的十项 Definition of Done 已闭合，未发现本波范围内 P0/P1 数据覆盖或身份漂移缺陷。W74a 标记为 `COMPLETE TO THIN-SLICE SPEC`。W74b 与 W74c 仍是独立未尽波次，不能因 W74a 完成而自动开工；下一波必须重新按完整未尽总表选择。
