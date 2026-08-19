# W82a Organizational Kernel Specification

> 状态：`FOUNDATION LANDED`
> 日期：2026-08-19
> 所属：W82 Organizational Compiler
> 真源：[`W82_ORGANIZATIONAL_COMPILER.md`](../plans/W82_ORGANIZATIONAL_COMPILER.md)

## 1. 交付边界

W82a 是一个无副作用的组织编译 Foundation。它把版本化 Workflow Package 与一次 Compile Request 规范化、校验并编译成可复验 Execution Plan；它不创建进程、不读写项目文件、不访问网络、不调用 Electron/IPC，也不执行或发布计划。

边界所有权固定为：

| 对象 | 真正 owner |
|---|---|
| 组织定义、考古、编译计划 | W82 |
| Production Run、实际委托链、运行事实 | W73 |
| Agent Executor 的 Harness | W66 |
| 外部 Tool Executor 的 Adapter/执行 | W79 |

因此 `Seat != Executor != Harness != Tool`，`Sub-Agent != Child Seat`。纸面软件发布与实证研究 fixture 只证明 schema 的跨领域表达力，不宣称 W82b/W82c 已落地。

## 2. 固定输入与输出

Workflow 的调用输入必须显式包含且只按以下五类解释：

```text
Goal + Constraints + Assets + Method + Budget
```

编译结果显式包含：

```text
Team / Seat / Artifact DAG / Gate / Authority / Executor Routing /
Budget Envelope / Recovery / Delegation / Provenance / Blocker
```

核心 schema：

| schema | 用途 |
|---|---|
| `mazz.workflow-package/v0` | 版本化组织与方法定义 |
| `mazz.organization-compile-request/v0` | 一次目标、资产、预算和能力快照 |
| `mazz.execution-plan/v0` | 确定性、不可变、不可自执行的组织计划 |
| `mazz.transition-evidence/v0` | 一次 Gate 的分层证据与人工决定 |
| `mazz.transition-result/v0` | `APPROVED / BLOCKED / UNKNOWN` 跃迁结论 |
| `mazz.expert-capability-asset/v0` | 不嵌入实现的专家能力界面 |
| `mazz.expert-capability-composition/v0` | 保留 identity/style/permission 的组合结果 |

所有 schema 严格拒绝未知字段、非 JSON 值、循环引用、非有限数值和 secret 类字段；输出递归冻结。

## 3. 组织考古

每个 Seat 必须能追溯到至少一条 Archaeology 记录；记录必须同时给出源岗位、`preserve / merge / remove` 决定、理由分类、说明和证据引用。

`remove` 只允许用于 `legacy-friction`，且不得继续指向 Seat。专业判断、责任、独立复核和权限分离不得借“自动化”名义静默消失。

## 4. Staffing 与 Delegation 硬边界

- Seat 用职责、输入、输出、Gate、Authority、Qualification 定义，不随 Executor 替换而变化。
- Child Seat 必须具有独立职责、输入、输出 Artifact、Gate 和 Authority；只拆执行步骤的对象不是 Child Seat。
- Child Seat graph 和 Artifact DAG 均禁止 cycle。
- Delegation 必须限制深度；subcontract 必须显式授权。
- Authority 与 Qualification 不随委托继承。
- Parent Seat 保留责任；required child result 未齐不得视为完成。
- 成本采用 full-chain 口径，未知成本保持 `UNKNOWN`，绝不补零。
- 每跳实际 provenance/Task Contract 由 W73 Production Run 保存；W82a 只冻结计划合同。

## 5. Routing 与权限

编译器可以列出候选 Executor，但不能自动选择。正式选路必须由具有 `routing` 决策类型的 Human Authority 提供显式 Routing Lock。

Human Authority 必须绑定 `human:*` actor；`prohibitedSeatIds` 用于声明不可兼任的执行席位。若同一 actor 同时占据被禁止的 Seat 与 Authority，计划为 `BLOCKED`。

Executor 类型约束：

- `agent` 必须声明 W66 Harness；
- `tool` 必须声明 W79 Tool Adapter；
- `model` 必须声明 Provider；
- capability、qualification、状态和版本都必须来自同一能力快照。

## 6. Evidence-backed State Transition

Gate 把四层责任分开：

1. Verification：可重算或可检查事实；
2. Review：独立复核；
3. Evaluation：质量、风险或专业判断；
4. Authority：有责任主体的最终决定。

缺失或未知证据得到 `UNKNOWN`；失败证据、权限不匹配或人工拒绝得到 `BLOCKED`；只有全部必需证据通过且准确 Human Authority 批准时得到 `APPROVED`。任何结果都不能伪造自动 Authority。

## 7. 确定性与局部回退

Package、Request 和 Plan 均以规范化 JSON 计算 SHA-256。对象键序变化不改变 digest/Plan ID。Artifact 通过显式依赖和 `invalidates` 构成 DAG；变更只传播到下游，Recovery Point 明确恢复席位、受影响 Artifact、证据和 Authority。

## 8. Expert Capability Composition

Expert Capability 只表达输入/输出、证据、注意点、决定、负面知识、异常策略、权限和风格身份。组合结果：

- 不嵌入 Agent/模型/脚本实现；
- 不合并 identity 或 style；
- 不扩大 permission；
- 不把建议能力提升为 Authority。

## 9. 本阶段验收与停止线

验收由 [`w82a-organizational-kernel.test.mjs`](../../tests/contract/w82a-organizational-kernel.test.mjs) 与软件/研究双领域 fixture 完成。W82a 不包含真实发布、真实研究运行、UI、IPC、后台服务、嵌套委托 Runtime、Hub 市场或任何 W82b–W82h 内容。
