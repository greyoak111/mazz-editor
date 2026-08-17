# W73a Factory 现状—设计差额审计检查点

> 日期：2026-08-17
> 审计坐标：`main@e23e3f9`
> 结论：`PASS — SPEC ONLY / NO RUNTIME CHANGE`

## 本轮完成了什么

W73a 对 Factory 历史欠账做了逐项代码复盘，并冻结两份真源：

- [`W73_FACTORY_GAP_MATRIX.json`](./evidence/W73_FACTORY_GAP_MATRIX.json)：22 项机器可读分类、代码证据、归属和禁区；
- [`W73_FACTORY_ORGANIZATIONAL_COMPLETION_SPEC.md`](./W73_FACTORY_ORGANIZATIONAL_COMPLETION_SPEC.md)：W73b–h 的数据合同、依赖、退出 Gate、回滚与最终完成定义。

分类结果：

| 分类 | 数量 | 含义 |
|---|---:|---|
| LANDED | 1 | W68 审理工艺已是基座，不重写 |
| PARTIAL | 10 | 有真实实现，但欠统一事实链或组织语义 |
| METHOD_ASSET | 6 | 方法已成熟，尚无正式运行时合同 |
| POST_W71 | 3 | 应路由到 W74/W79 等外部波次 |
| OBSOLETE | 2 | 旧方向已被当前 Factory Desk/身份分层替代 |

## 最重要的判定

1. **W73 不是新建 Factory。** `review.js` 已有三轮回炉、M2/M4/M5/M6、四闸、判例和预算；`index.js` 已有队列、并发、断点、重试和成本台账；`command-gate.js` 已有终审卡与七项健康指标；`agent.js` 已有闭集多步委托。
2. **共同根缺口是 Production Run。** 当前事实散在任务、审理工件、Workshop archive、成本 JSON、Provider 调用与 Agent ledger 中，尚不能稳定回答“这次生产由谁、在何约束下、经哪些返工和 Gate、花了多少、为何完成或失败”。
3. **W66 是条件依赖，不是总阻塞。** W73b 的本地 Run 与 W73c 的回炉审计可以先做；外部 Agent 委托和依赖 Harness health 的联合调度必须等真实 W66 Adapter，不能用 Provider 路由冒充。
4. **W70 不是 W73 前件。** 幻锚先用本地 sourceRef/anchorRef/evidenceRef 落账；Cognition 将来可读取，但 W73 不等 W70 才能追证。
5. **W69/W82 不可反向夺权。** W69 只拿经 W74c Promotion 的公共证据投影；W82 只编译 Execution Plan；Production Run 始终由本地 W73 持有。

## 恢复的 22 项去向

| 归属 | 条目 |
|---|---|
| W73b | Provider 边界透明、Production Run 公共前件 |
| W73c | 回炉五件套、幻锚、审计旗语/团队纪律 |
| W73d | 岗前训练/持证、任务委托 |
| W73e | 联合调度、弹性编制、计算委托接口 |
| W73f | 完整成本、KPI、本地模型评估 |
| W73g | 导演表、正式流程图、贡献者手册协议 |
| W73h | W68 兼容、故障恢复、资源收尸与 soak |
| W74a | 统一导入消化管线 |
| W74c | Promotion 通用升格 |
| W79 | 声明式图形/外部计算能力执行 |
| W64 | 厂花/产品人格呈现 |
| 永久淘汰 | Provider/Model=Seat/Agent；旧表单中心/独立预览复辟 |

## 下一建议波

`W73b Production Run Identity & Append-only Ledger`，但仍需维护者继续指令才开工。

它只允许选择一条现有 W68 生产路径做旁路双写 PoC：冻结 schema、稳定 runId、append-only event、artifact reference、重开与恢复。不得同时做 Router、排行榜、Hub、统一导入、外部工具或组织编译器。

## 本轮没有做

- 未改 `renderer/`、`main/`、`preload/`、IPC、UI 或产品状态；
- 未新增数据库、后台服务、Hub、真实 Adapter、Router 或外部工具；
- 未把 W74/W79/W82/W69/W64 的内容并入 W73；
- 未删除 legacy code、历史 workaround 或现有 Factory Desk；
- 未把规划条目冒充 LANDED。
