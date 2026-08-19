# W66 真实 Agent 第三阶段检查点（2026-08-19）

## 结论

W66 第三阶段已关闭 Foundation 的真实激活门：Kimi Code 与 Codex 已在当前 Windows packaged Mazz 中分别完成真实模型回合，并以独立 Attempt/Session 完成 Kimi → Codex 与 Codex → Kimi 双向安全 Handoff；两家失败、在飞取消、dispose 和资源回收均通过。Claude Code 按维护者明确决定因区域/账户约束暂缓认证，诚实状态为 `CONDITIONAL_DEFERRED`。

因此 W66 当前状态为：

```text
FOUNDATION FORMAL
R0-R6 LANDED
REAL ACTIVATION 2 OF 3
CLAUDE CONDITIONAL_DEFERRED
```

这只关闭“至少两个真实 Adapter 共用同一协议”的 Foundation Gate，不等于三家全通过。产品若对外承诺 Kimi Code、Claude Code、Codex 三选一，仍必须补做 Claude 真实认证、完成/失败/取消/释放及三家正反向 Handoff。

## 用户授权边界

- Kimi Code：账户持有人已完成厂商授权，可进入真实激活 Gate。
- Codex：既有认证继续有效，可进入真实激活 Gate。
- Claude Code：维护者明确要求暂缓，不继续登录尝试；原因记为 `USER_REGIONAL_ACCOUNT_CONSTRAINT`。
- 暂缓不是 PASS、代码失败或永久删除。Claude Adapter、健康探测、未认证失败收尸和独立降级继续保留；正式 UI 必须显示需认证/条件暂缓，不能显示 ready。

## Packaged 真实验收

| Gate | 结果 |
|---|---|
| Kimi packaged 真实回合 | PASS；两个方向均观察到要求的随机 Marker |
| Codex packaged 真实回合 | PASS；两个方向均观察到要求的随机 Marker |
| Kimi → Codex Handoff | 2 Attempts / 2 unique Sessions / 1 Handoff，PASS |
| Codex → Kimi Handoff | 2 Attempts / 2 unique Sessions / 1 Handoff，PASS |
| Kimi / Codex 确定性失败 | 两家均观察到失败并完成收尸，PASS |
| Kimi / Codex 在飞取消 | 两家最终态 `cancelled`，send 拒绝，PASS |
| ResourceLedger | `2 → 2` |
| 主/渲染异常 | `0 / 0` |
| Claude | `CONDITIONAL_DEFERRED`；未冒充执行 |

Codex 两个真实输出 Receipt：

- 正向 SHA-256 `62217a1523d7ac54310f6bf717806c128e2aa0b4ce9ae536abaee7c951184b5a`，778 bytes；
- 反向 SHA-256 `64b508866fcb31ce4bde5b49fb83afd00614b044b1f6e243dba605e591175b2a`，921 bytes。

Kimi 当前 ACP 事件能观察真实 Marker 和完整事件流，但统一 `output` Receipt 仍为空；本 Gate 只据 Marker、事件数、Session 终态与资源账判定真实回合，不虚报 Kimi 已具有统一文本 Receipt。正向/反向分别观察 120 / 66 个事件。

## 证据产物

机器证据：`docs/engineering/evidence/W66_REAL_THREE_ADAPTER_ACTIVATION_2026-08-19.json`。

本次 `win-unpacked`：

- `Mazz Editor.exe`：188,784,128 bytes，SHA-256 `5E20F18BC58CE06EEE10B1E9768C6C07EE613F2A1A5410A8F003ECEB90D1131F`；
- `resources/app.asar`：258,833,955 bytes，SHA-256 `99BF6574E9EB4CDA9AB9A62442A6F7ED6CD2739EBBF3A0B6A8068DC4F4FD4E9A`。

脚本以 `MAZZ_W66_DEFER_ADAPTERS=claude-code` 明确冻结本次激活范围。未知 Adapter、少于两个 active Adapter 或 active Adapter 健康失败会直接阻断，不能靠环境变量把 Foundation 降成单 Adapter 后仍判通过。

## 第三阶段关闭后的边界

1. W66 Foundation 可以标记 FORMAL；Kimi 与 Codex 可独立使用并在安全回合边界双向热切。
2. 三选一完整产品承诺仍为条件项；Claude 未经真实 Gate 前不能列为已激活。
3. 不做 mid-token、mid-tool、mid-write 换模；热切继续是同一 Run/Task 下的新 Attempt + 新 Harness Session + Handoff Snapshot。
4. 本波没有建设 W82 Compiler、W85 Context Compiler、Task Capsule、SeatPackage 或并发多模型委员会。
5. 下一波必须回到完整未尽总表重新过前件门，不能把 W66 通过自动解释成任意后续能力已获批。
