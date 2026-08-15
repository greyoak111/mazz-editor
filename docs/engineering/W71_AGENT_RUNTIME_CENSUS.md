# W71 / W66 Agent Runtime Census

> 状态：Harness Foundation 已落，真实 Adapter 仍为 0
> 机器证据：[`../../.mazz/audit/agent-runtime-census.json`](../../.mazz/audit/agent-runtime-census.json)

## 当前机器事实

| 候选 | detect | 安全版本探针 | 认证 | 权限/Session |
|---|---|---|---|---|
| Codex | FOUND（WindowsApps） | FAILED：`EPERM` | 未探测 | 未探测 |
| Kimi | NOT FOUND | 未运行 | 未探测 | 未探测 |
| Claude | NOT FOUND | 未运行 | 未探测 | 未探测 |
| Gemini | NOT FOUND | 未运行 | 未探测 | 未探测 |

Wave 0 不发起交互登录、不读取厂商凭据仓，也不把“浏览器能登录某厂商”“Provider 能调某 API”视为 Agent CLI 已认证。Codex 的路径发现只证明文件可见；当前执行权限不足，不能注册成可用 Adapter。

## 已冻结 Harness v1

```text
detect / probe / capabilities / createSession
send / interrupt / dispose / events
```

Session 状态、统一事件/错误和 ResourceLedger 已有基础实现；生产注册表没有厂商 Adapter。UI 与 Factory 必须按 capability 决定动作，不能按 `kimi/codex` 名称硬编码。

## W66 Gate

W66 继续保持 `PARTIAL / Foundation only`，直到至少两种真实执行器分别在 packaged runtime 完成：

1. detect 与版本 probe；
2. 非交互认证状态判断；
3. createSession/send 的结构化事件；
4. interrupt、异常退出、应用退出；
5. dispose 后 Agent Session/PTY/process 回到原资源基线；
6. 权限拒绝、超时、不可执行与未安装的诚实错误；
7. 无厂商原始事件泄漏到通用 UI。

在现环境无法满足双 Adapter Gate 时，Foundation 保留为基础设施，不以 Kimi 专项代码或 Provider/Terminal 前件冒充 W66 完成。
