# W73h Integration / Recovery / Soak 检查点

> 日期：2026-08-17
> 开工基线：`main@9ac443d`
> 结论：`PASS — W73 COMPLETE / SEALED TO SPEC`
> 机器证据：[`W73H_INTEGRATION_RECOVERY_SOAK.json`](./evidence/W73H_INTEGRATION_RECOVERY_SOAK.json)

## 1. 本波关闭的真实缺口

W73a–g 已分别拥有 Production Run、Audit/Rework、Qualification/Delegation、Scheduler、Economics/Evaluation 与 Process Protocol，但此前缺少最后一层运行时收口：不同 renderer 可能同时解释同一个 Run；关闭顺序没有等待 Harness 终态；各子账只能各自报告健康，无法回答整个 Run 是否还有幽灵 writer/session/dispatch/owner。

W73h 没有新增 Factory 功能面，而是关闭这三项根缺口：

1. 同一 Production Run 同时只有一个主进程登记的 renderer owner；
2. Run 可从所有 W73b–g 子账导出一个严格、只读、可落盘的收敛检查点；
3. 任务与 Factory 退出按 task → Harness Session → writer/owner → ledger 的依赖顺序收尸。

## 2. 实现事实

- `main/factory-run-owners.js`：`FactoryRunOwnerRegistry` 以 `runId` 为互斥键，lease 与 renderer owner 双重校验；重复取得幂等，其他 renderer 收到 `RUN_OWNER_ACTIVE`；renderer gone/destroyed 与 app quit 统一释放 `factory-run-owner` ResourceLedger 项。
- `preload/bridge.js` / `main/main.js`：只增加 `factory:runAcquire` 与 `factory:runRelease` 两条白名单 IPC；没有新 BrowserWindow、页面或后台服务。
- `renderer/modules/factory/index.js`：W68 单次任务在 `recoverOrphaned` 前必须先取得 owner；删除任务写 `run-cancelled`，普通停止仍写 `run-paused`；W73f 与跨账不一致均进入显式恢复阻断。
- 所有 `claimTask` 路径都有 settlement；dispose 先等待在飞任务，再收外部 Harness Session，最后关闭承接终态的账本。单项清理失败不会跳过后续收尸，并以 `cleanupErrors` 如实回报。
- `renderer/modules/factory/runtime-convergence.js`：`mazz.factory-runtime-convergence/v0` 只读取现有事实，识别 `RECOVERY_REQUIRED`、`RUN_ID_MISMATCH`、`GHOST_RUNNING_RUN`、`TERMINAL_WITH_ACTIVITY`、`COMPLETED_WITH_UNRESOLVED_FINDINGS`；只有 `completed + CONVERGED` 可以 `safeToSeal`。

## 3. 验证矩阵

| 要求 | 本轮证据 | 结论 |
|---|---|---|
| create/start/pause/resume/reopen/seal | 20 轮真实临时目录 Production Ledger 往返；每轮生成并重读 `convergence.json` | PASS |
| cancel/fail | 两种终态分别落盘、dispose、重开；均 `CONVERGED` 但 `safeToSeal=false` | PASS |
| retry | W73b 终态重跑生成新 Run，并保留 `previousRunId` | PASS |
| multi-window owner transfer | 20 轮 A 取得、B 阻断、A 释放、B 取得并释放 | PASS |
| renderer crash / app quit | owner registry 绑定 `render-process-gone`、`destroyed`、`before-quit`；复用 W71 packaged crash 证据 | PASS |
| corrupt ledger tail | W73b–f 尾损坏隔离与 recovery-required 合同保持全绿；中段损坏拒绝猜测 | PASS |
| provider slow/offline/partial/refusal/truncation/permission | W71 packaged slow/offline/partial SSE 与 Factory SSE refusal/损坏/finish_reason 合同复用；本波未改 Provider 语义 | PASS / REUSED |
| budget stop / no executor / backpressure | W68 budget hard-stop、W73d `HARNESS_UNAVAILABLE`、W73e `BUDGET_INSUFFICIENT` / `EXECUTOR_BACKPRESSURE` 合同保持全绿 | PASS / REUSED |
| Harness/writer/listener/timer/resource baseline | dispose 顺序动态测试；每轮 ledger `activeWrites=0`、Run owner=0、ResourceLedger=0 | PASS |
| W68 compatibility | W68a `11/11`、W68b `9/9`、W68c `9/9`；全量测试文件 `172/172` | PASS |

## 4. 故障与恢复语义

- `running` 且无 task/controller/session/dispatch/writer/owner 是幽灵 Run，不能自动封板。
- 终态仍有任何活动资源是不一致，不因正文已经存在而冒充完成。
- `completed` 仍有未结 Finding 是不一致；seal 不取得 Promotion、Publication 或 Canon 权力。
- 损坏尾保留证据并阻断；未知字段、secret、跨 Run 子账均 fail closed。
- owner 只保护“当前谁能执行”，不持久化业务事实；renderer 消失后由 Production Run 自身的恢复规则接续。

## 5. 回滚与边界

回滚可独立移除两条 IPC、owner registry、runtime convergence 派生文件与 `FactoryPanel` 接线；W68 原工件、W73b–g 账本格式和历史 Run 不需迁移或删除。`convergence.json` 是派生检查点，删除它不删除任何 Run 或领域工件。

本波明确未做：W68 max/legacy 迁移、W74 ingestion/promotion、W79 外部工具运行时、W82 组织编译、W69 Hub/Market、W64 Persona、万能 Graph/数据库、第二 Factory 或任何新正式入口。

## 6. 封波判定

W73a–h 的十项 Definition of Done 已闭合，未发现 W73 范围内 P0/P1 数据可靠性缺陷。W73 标记为 `COMPLETE / SEALED TO SPEC`。后续工作必须从完整未尽总表重新选波，不能借 W73 封波自动扩入 W74/W79/W82/W69/W64。
