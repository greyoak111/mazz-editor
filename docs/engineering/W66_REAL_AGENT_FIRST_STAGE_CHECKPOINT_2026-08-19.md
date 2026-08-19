# W66 真实 Agent 第一阶段检查点（2026-08-19）

## 结论

W66 第一阶段的实现工作已一次性落地，代码坐标为 `main@6400507`。R0–R6 已形成从完整军规装载、进程监督、三家 Adapter、Attempt/Handoff 到 Factory 产品入口的连续主链；但 W66 尚不能标为 FORMAL，因为当前只有 Codex 完成真实认证和真实模型回合，Kimi/Claude 仍受各自登录态阻塞，三家 packaged Electron 激活循环也尚未完成。

状态必须分三层表达：

```text
IMPLEMENTED: 三家 Adapter、热切、UI、Doctrine Runtime 已进入产品代码
ACTIVATED:   Codex 真实 CLI/认证/模型回合通过；Kimi/Claude 未通过
FORMAL:      未达到（三家真实认证及 packaged Activation Gate 未闭）
```

## 本阶段落地范围

- Kimi Code：ACP JSON-RPC、initialize/session new/load、模型配置、prompt/cancel、permission reverse request 和统一事件。
- Claude Code：stream-json 非交互回合、显式 permission mode、隔离 project/local settings、模型与 resume、工具/usage/result 归一。
- Codex：`codex exec --json`、`--ignore-user-config`、`--ignore-rules`、受限 sandbox、resume、事件/usage/result 归一；拒用 WindowsApps 内部路径。
- 通用 Runtime：完整 Raw + Compiled Doctrine 零 spawn 硬门、原生 CLI 解析、Supervisor/ResourceLedger、Typed Session Handle、Output Receipt、红acted vendor metadata。
- 安全热切：同一 Run 新建递增 Attempt；来源先 waiting 或 interrupt+dispose；writer lease/在飞工具未归零时阻断；Handoff Snapshot 不携带 secret；目标失败保留恢复入口。
- 产品入口：Factory 内置/Kimi/Claude/Codex 三选一、模型目标、健康与认证态、规则包选择、受限权限提示、延迟到安全回合边界的切换。

## 真机激活事实

| Adapter | CLI | 探测/协议 | 认证 | 真实模型回合 | 当前结论 |
|---|---|---|---|---|---|
| Kimi Code | `0.37.2` | 原生 CLI 与 ACP initialize PASS | 只能判 `unknown`，需用户登录 | 未跑 | IMPLEMENTED / LOGIN BLOCKED |
| Claude Code | `2.1.235` | 原生 CLI PASS | `loggedIn=false` | 未跑 | IMPLEMENTED / AUTH BLOCKED |
| Codex | `0.148.0` | 原生 CLI PASS | ChatGPT 登录态 PASS | PASS，返回 `W66_CODEX_ACTIVATION_OK` | ACTIVATED / PACKAGED PENDING |

Codex 真实回合 Vendor Session 为 `01a0184e-5d44-7f52-b3ee-c72d5afb60e0`；输出 Receipt 为 complete，SHA-256 `92f59f0b21090bfc9a1203f0829139a502d057b5791dae04e3e8af8f2032c7cc`，byteLength `787`；回合结束后 Supervisor 活动进程数为 0。完整机器证据见 `docs/engineering/evidence/W66_REAL_AGENT_FIRST_STAGE_2026-08-19.json`。

## 验证

- 三家 fixture 各完成 20 轮真实 child create/send/dispose，进程与 ResourceLedger 均归零。
- W66-R2/R3/R4/R5/R6 定向合同通过。
- `npm run build`：PASS。
- `npm test`：`193/193` 个测试文件通过。
- 全量测试同时修正并钉住七项历史漂移：发布/OSS 派生证据、W65 当前状态、Post-W71 W82 版本、Player W28 现行布局链、W73d 对真实 Adapter 注册的边界，以及对应生成审计。

## 未闭 Gate

1. Kimi Code 完成厂商登录，并通过真实模型 send/wait/fail/cancel/dispose。
2. Claude Code 完成厂商登录，并通过真实模型 send/wait/fail/cancel/dispose。
3. 三家在 packaged Electron 中分别完成 detect/probe/auth/session/send/wait/fail/cancel/dispose 和 20 轮退出收尸。
4. 同一真实 W73 Run 完成跨厂商双向 Handoff；Run ID 不变，Attempt/Session 不复用，目标失败可恢复。

上述 Gate 未闭前，W66 保持 `PARTIAL / IMPLEMENTATION R0-R6 LANDED / ACTIVATION 1 OF 3 REAL-TURN PASS`，不得宣称三选一正式可用。
