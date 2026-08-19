# W63 / W75 Addressable Evidence — Checkpoint

> 日期：2026-08-19  
> 前件坐标：`main@ebf2fce`  
> 状态：`W63 MARKDOWN PRODUCT SLICE / W75 FOUNDATION LANDED`

## 交付

- 严格 Content Anchor、Live Reference、Reference Index、Relation Edge、Episode 和 Recollection 契约；
- 可重建工作区活引用服务、稳定文件身份、缓存失效和路径边界；
- 既有反链侧栏中的双向活引用产品入口；
- 14 项合同覆盖稳定身份、跨格式 selector、解析歧义、双向索引、人工升格、可解释回忆和真实 IPC/UI 接线。

## 验收

| Gate | 结果 |
|---|---|
| `npm run build` | PASS |
| W63/W75 scoped contract | `14/14` PASS |
| `git diff --check` | PASS；仅既有 Windows 行尾提示 |
| 外部网络 / 发布 / Agent / 工具执行 | 未发生 |

最近已提交全量水位仍是 `194/194`；本波新增测试已加入 `tests/run.js`，但未把历史全量冒充本轮执行。

## 停止线

Markdown 端到端切片已落；Sheet/Mindmap/媒体格式的 Anchor 创建 UI 仍交给 W78。W75 产品化入口需等待 W81 Event Ledger 与 W85 Context Compiler，当前只关闭可解释检索 Foundation。
