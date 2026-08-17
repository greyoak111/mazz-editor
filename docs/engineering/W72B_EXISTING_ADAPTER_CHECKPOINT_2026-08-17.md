# W72b Existing Asset / Capability Adapter 检查点

> 日期：2026-08-17
>
> 状态：**COMPLETE — MINIMAL ADAPTER SLICE**
>
> 前置：W72a `d73c851`
>
> 规格：[`W72_ASSET_CAPABILITY_FOUNDATION_SPEC.md`](./W72_ASSET_CAPABILITY_FOUNDATION_SPEC.md)

## 1. 本次完成

- 完成现有资产族和第一方能力候选盘点；
- 新增保存态 W62d Mindmap → Asset Envelope 薄适配器；
- 复用 `tabId/filePath/title/selection` 来源钩，不改写 W62d 领域文档；
- 仅在调用方提供 stable source asset id 时生成 `derivedFrom`；
- 新增 `mindmap.outline.import / mazz.mindmap.model.parseOutline` 第一方 Provider 描述；
- 新增 6 条定向契约测试并接入全量入口。

## 2. 没有做

- 没有把 Envelope 写回 `.mindmap`；
- 没有扫描工作区、建立数据库或生成全项目资产清单；
- 没有批量适配 Markdown/Sheet/Slide/Draw/Media/Factory；
- 没有建立全局 Registry、IPC、UI 或自动 Router；
- 没有把 capability 暴露给 Agent；
- 没有安装、探测或调用外部工具。

## 3. 关键不变量

| 不变量 | 实证 |
|---|---|
| Domain source remains truth | 适配输入是既有 `parseDoc(serializeDoc(doc))`，Envelope 不含 roots |
| SourceRef preserved | 文档级 W62d sourceRef 深拷贝守恒并冻结 |
| Identity is not path | 适配器要求显式 asset id；来源关系也要求显式 sourceAssetId |
| No inferred relation | 只有 filePath、没有 sourceAssetId 时 relations 为空 |
| Descriptor is not runtime | 样本 `agentUsable=false`、health=unknown，不含 execute/probe |
| Registry stays reversible | 样本登记返回 unregister，未创建全局单例 |

## 4. 验证

```text
node tests/contract/w72b-existing-adapters.test.mjs
通过 6 / 失败 0

node tests/run.js
155/155 个测试文件通过
```

Node 对 renderer ESM 源文件仍会打印既有 `MODULE_TYPELESS_PACKAGE_JSON` 性能提示；它不是断言失败，本轮不为消除测试提示改动整个 package module type。

## 5. 停止线

W72b 的“最小真实样本”已关闭，不继续批量迁移。W72 整体仍未完成：W72c 持续 OSS Provenance Ledger 与 W72d External Tool Adapter Spec 继续留表，W73 及后续消费者不因本检查点自动获批。
