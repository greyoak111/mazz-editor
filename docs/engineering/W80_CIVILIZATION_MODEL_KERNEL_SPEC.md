# W80 Civilization Model Kernel / Narrative Filter

> 状态：MINIMAL DETERMINISTIC KERNEL LANDED
> 日期：2026-08-19

## 范围

W80 只建立最小声明式 Kernel：State、Constraint、Change、Derived Effect、Evidence、Unknown。它不是 World 数据库、游戏引擎或自动写作器；主进程只提供 simulate/filter/reconcile 三个纯运行入口，不持久化世界、不接管 Renderer。

## 分类与 Authority

所有 State/Change/Event 固定显式分类：`CANON / DERIVED / ADAPTATION / SIMULATION / NON_CANON`。CANON 必须 human Authority + Evidence；规则推导只产生 DERIVED，Simulation Change 保持 SIMULATION，Narrative Filter 无权升格或改写事实。

因果规则使用冻结的声明式比较操作 `eq/neq/gt/gte/lt/lte/truthy`，不接受表达式、脚本或 eval。单次 Change 最多传播五层；缺 target/input/evidence 返回 UNKNOWN/PARTIAL，不以模型推理补全。

## Narrative Filter

Event Pool 只从可追溯 Derived Effects 构建。Filter 依据 structural conflict、character cost、irreversible change、relation change、theme relevance 解释性排序，并明确 `factMutationAllowed=false`。

## 多账本

Model、Simulation Runtime、Narrative Rendering 与 Evidence 独立对账。Model hash、Simulation ref、Narrative ref 或 Evidence 任一不一致即 `UNKNOWN_OR_DIVERGED`；只有全部一致才 `RECONCILED`。
