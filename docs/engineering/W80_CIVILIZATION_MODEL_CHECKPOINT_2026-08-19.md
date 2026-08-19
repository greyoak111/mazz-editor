# W80 Civilization Model / Narrative Filter 检查点 — 2026-08-19

## 完成

- 严格 Model/State/Constraint/Rule/Change 与五类事实层协议。
- 声明式、最多五层的确定性因果传播；缺材料结构化 UNKNOWN。
- Event Pool 与只筛不改事实的 Narrative Filter。
- Model/Runtime/Rendering/Evidence 四方 reconciliation。
- 主进程白名单 `civilization:simulate/filter/reconcile`；无数据库、无写盘、无 renderer 所有权。

## Hard Sample

港口容量 100 → 40 的 SIMULATION Change 确定性推出四层：运输成本 → 食品价格 → 迁移压力 → 政治张力，并生成四个带 Evidence 的 DERIVED Event。Depth 为 0/1/2/3/4；原 Model 序列化结果和 hash 均未改变。缺变更目标、缺规则输入、缺 Evidence 分别保持 UNKNOWN/PARTIAL/DIVERGED。

## 验证

- `npm run build`：PASS。
- `node tests/contract/w80-civilization-model.test.mjs`：8/8 PASS。
- 新合同已登记 `tests/run.js`；未运行全量、packaged、外部模型或真实 World。

## 停止线

本检查点不构建 World editor、Universal DB、自动 Canon、生成式 Renderer 或 W69 公共 World；Narrative Filter 不改变事实。
