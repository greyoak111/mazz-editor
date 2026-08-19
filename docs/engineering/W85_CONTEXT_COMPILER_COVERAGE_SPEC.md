# W85 Context Compiler & Coverage Accounting — Implemented Contract

> 状态：LOCAL FOUNDATION + HARNESS PRODUCT INTEGRATION LANDED
> 日期：2026-08-19

## 不变量

```text
Context != Plan
Memory != State
Reasoning != Coverage
relevance != authority
conversation != operational truth
```

W85 编译短命、可检查、可重建的 Context Package，不生成业务结论。外置对象至少分成 Current Source、Supersession、Prospective Obligation、Evidence 与 Checkpoint；W75 检索候选、W81 Event/Episode 和 Shadow Relation 只能被强制降为 `INFERRED`，永不进入 authoritative refs。

## 契约

- Source 状态：`CURRENT / SUPERSEDED / HISTORICAL / PROPOSED / REJECTED / INFERRED`。
- `CURRENT` 必须声明 Authority；材料更新不自动 CURRENT。
- `SUPERSEDED` 必须有 replacement、effective time、Authority、reason。
- Context Package 记录 task/seat/checkpoint/compiler/policy、budget/used/overflow、authority/relevance、delta/constraints/conflicts/unknowns/exclusions、Coverage Snapshot 与 provenance。
- Seat Policy 在编译前按 sensitivity/kind/source budget 裁剪；所有排除均有 reason，mandatory 超预算必须显式 overflow。
- 禁止原始聊天 dump、prompt、逐键、剪贴板正文、终端输入、环境或 secret 进入编译协议。

## Coverage

Wave Graph obligation 状态固定为 `REGISTERED / NOT_AUTHORIZED / READY / IN_PROGRESS / BLOCKED / EVIDENCED / WAIVED / SUPERSEDED`。`EVIDENCED` 必须引用证据；`WAIVED` 必须 human Authority/reason/impact；`SUPERSEDED` 必须 replacement/Authority/reason。Coverage 不受 Context token budget 裁剪，`silentlyDropped` 固定由合同证明为零。

## 产品接线

仓库/Checkpoint Prototype 只读当前 Workspace 内显式文件，记录 hash/mtime/version/token estimate，可选短 excerpt；包写入 `.mazz/context/packages/`。W66 创建 Session、开始 Run、切换 Run 时由主进程可信 Compiler 生成 Context Package，与完整 Raw Rule Pack 和 Compiled Doctrine 同时注入三家 Adapter；Session 对外暴露实际 `contextPackageId`。

永久不建设 Universal Memory daemon，不把 Context Package 当 Runtime State/Decision/Plan，也不因检索分数或模型推理置信度更新 Coverage。
