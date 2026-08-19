# W70 Cognition — File-first Protocol Layer

> 状态：LOCAL PRODUCT SLICE LANDED
> 日期：2026-08-19
> 真源：`0814接续用.pdf` 第六节，经整页视觉复核

## 定位

W70 是普通 Markdown 之上的严格协议层，不是巨大 Cognition 模块、数据库、Mindmap 后端或第二 Factory。AI 可以写候选；只有明确的人类动作能批准或建立 supersession。Factory 可只读消费，不能依赖 W70 才运行；Mindmap 可投影，不能成为 W70 真源。

## Cognition v0

稳定对象类型：`Concept / Finding / Question / Evidence / Analysis / Solution / Decision / Pattern / Playbook / Method / StageSummary`。

每个 Markdown 头部保存可检查 JSON marker：稳定 identity/cognition ID、schemaVersion、sourceRefs/sourceHealth、maturity、validity、implementation、lifecycle、authorityState、supersedes/supersededBy、时间与 provenance。正文仍是普通 Markdown，可由既有 Editor 打开、编辑、复制和版本管理。

三轴不得压成一个“完成度”：

- maturity：SEED / DEVELOPING / STABLE / CANONICAL
- validity：UNKNOWN / PROPOSED / SUPPORTED / DISPUTED / REFUTED
- implementation：NOT_APPLICABLE / NOT_STARTED / IN_PROGRESS / IMPLEMENTED / VERIFIED

## Authority / Supersession

`CANDIDATE` 不得携带生效 Authority；`HUMAN_APPROVED` 必须 `human:*`。Supersession 不覆盖或删除旧 Markdown：新项显式记录 `supersedes[]`，旧项进入 SUPERSEDED 并指向 `supersededBy`。两边写入失败会回滚原文。

StageSummary 只聚合已确认事实、已修问题、当前假设、决策、模式、阻塞问题、未决项、未来候选、来源和替代史；汇总本身永不授予 Authority。

## 产品入口

侧栏“认知”显示阶段摘要和全部 Cognition Markdown，支持创建“由我批准”或“保存为候选”、打开普通 Markdown、人工批准候选。损坏 marker 单项暴露 invalid，不拖垮其余资产。创建只向 W81 发送不含正文的语义事件。
