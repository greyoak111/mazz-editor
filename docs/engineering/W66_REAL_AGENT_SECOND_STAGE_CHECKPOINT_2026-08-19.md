# W66 真实 Agent 第二阶段检查点（2026-08-19）

## 结论

W66 第二阶段已推进到当前机器和当前账号能够独立完成的边界，产品与证据提交为 `main@55bd3ed`。packaged Harness、三家 CLI 健康探测、Codex 打包态真实回合/取消、未认证失败收尸和 Handoff 失败恢复均已通过。Kimi/Claude 的厂商登录及其真实模型回合必须由账户持有人完成，故 W66 仍保持 `PARTIAL / R0-R6 + PACKAGED HARNESS LANDED / REAL ACTIVATION 1 OF 3`，不得写 FORMAL。

## 本阶段修复

1. `harness:startRun` / `harness:switchRun` 现与普通 `createSession` 共用 Doctrine Activation Provider；W73 Run 不再绕过完整 Raw + Compiled Gate。
2. Codex 增加官方 `--skip-git-repo-check`，允许 Mazz 的普通本地 Workspace 使用；仍固定 `read-only` 受限档，不启用 bypass/auto approval。
3. 在飞 Codex send 被 interrupt 后保持 `cancelled`，迟到 `CLI_CANCELLED` 不再把 Session 非法改写成 `failed`。
4. packaged 测试注入只在 `NODE_ENV=test` 且显式传入 fixture 路径时启用，生产态继续解析厂商独立原生 CLI。

## Packaged 验收

| Gate | 结果 |
|---|---|
| 三家 fixture packaged create/send/dispose | 各 20 轮 PASS |
| packaged 跨 Adapter Handoff | Kimi → Claude → Codex → Kimi；4 Attempts / 4 unique Sessions / 3 Handoffs PASS |
| 真实 CLI detect/probe/auth | 三家 × 20 轮 PASS，逐轮资源回基线 |
| Codex packaged 真实模型回合 | PASS；观察到 `W66_PACKAGED_CODEX_OK` |
| Codex packaged interrupt/dispose | PASS；状态 `cancelled`，send 拒绝，资源归零 |
| Claude 未认证失败链 | PASS；明确失败并 dispose，无残留 |
| 真实来源 Handoff 目标失败 | PASS；来源先释放，Handoff 留盘，Run=`recovery-required` |
| 主/渲染异常 | 0 / 0 |
| ResourceLedger | `2 → 2` |

真实 Codex 输出 Receipt：SHA-256 `7ce7382d859c206bd90294cc43c0b151bda580046d61f1a8074efca4a135cb31`，byteLength `924`。

本轮 `win-unpacked` 证据产物：

- `Mazz Editor.exe`：188,784,128 bytes，SHA-256 `B1E0C36C3C2CCA6A79E653EBF42F7800F913854C49EDC8081CB0525662D6421C`。
- `resources/app.asar`：258,833,384 bytes，SHA-256 `E789B2A47F82DC59B3C23F2DD5AB249A495232AF515BBB9831F4E51BA20B00C7`。

机器证据见 `docs/engineering/evidence/W66_PACKAGED_ACTIVATION_2026-08-19.json`。

## 回归与构建

- W66 R2/R3/R4/R5/R6 + Harness Foundation 定向合同：`21/21`。
- `npm run build`：PASS。
- `npm run dist:dir`：PASS，Electron `33.4.11` x64。
- `node tests/e2e/w66-packaged-activation.mjs`：PASS。
- 未重跑无关 E2E；第一阶段全量基线继续为 `193/193`。

## 条件阻塞

1. Kimi Code `0.37.2`：CLI 与 ACP 正常，认证仍为 `unknown`；需账户持有人完成 `kimi login`。
2. Claude Code `2.1.235`：`loggedIn=false`；需账户持有人完成 `claude auth login`。
3. 两家登录后，各自补一次 packaged 真实完成/失败/取消/释放回合；随后再做 Kimi ↔ Claude ↔ Codex 真实跨厂商 Handoff。

上述是外部账户 Gate，不是代码未落或 fixture 可替代的 Gate。Codex Adapter 可继续独立使用；其他历史欠账仍按权威未尽总表保留。
