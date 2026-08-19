# W66-R1 CLI Supervisor 检查点

状态：`COMPLETE TO FROZEN R1 SCOPE`

前件：W66-R0e `c2194a1`，R0 COMPLETE。

后继：W66-R2 Kimi Code Adapter。

## 落地范围

- 新增无 shell 的 `CliSupervisor`：显式 argv/cwd、Windows hidden child、环境变量白名单、stdin、stdout/stderr 分流、超时、输出上限、Typed Process Handle、Result Envelope 与 Output Receipt。
- 所有 child/grandchild 进入 ResourceLedger；取消、超时、应用退出均按自有 PID 精准终止并等待收敛，不使用广谱进程清场。
- detect/version 支持多候选真实路径；同步 spawn `EPERM` 不再抛穿主进程。auth 只输出 authenticated/unauthenticated/unknown/error，不读取、记录或回显凭据。
- 建立三家 Golden Event Corpus，冻结 Kimi ACP JSON-RPC、Claude stream-json、Codex exec JSONL 与 common error/lifecycle 的最小输入—统一事件对照。
- 主进程统一创建 Supervisor，并由 Harness app-quit 收尸；当前仍没有注册真实 Adapter。

## 当前真机探针

| Adapter | Path | 状态 |
|---|---|---|
| Kimi Code | 未发现 | `CLI_NOT_INSTALLED` |
| Claude Code | 未发现 | `CLI_NOT_INSTALLED` |
| Codex | WindowsApps 内部 `OpenAI.Codex.../codex` | `EPERM`，不可激活 |

该矩阵是 R2–R4 的真实起点，不把桌面程序内部路径或 fixture 冒充 Adapter。

## 验证

- R1 合同：`7/7`。
- R0d/e、ResourceLedger、Harness Foundation、W73d 邻接：最终 `33/33`。
- `npm run build`：PASS。
- 全量、Electron、packaged、真实 Agent turn：本波 `NOT RUN`，分别由 R2–R6 承担。

机器证据：`docs/engineering/evidence/W66_R1_CLI_SUPERVISOR_IMPLEMENTATION.json` 与 `W66_R1_GOLDEN_EVENT_CORPUS.v0.json`。

## 协议来源

- Kimi Code 官方：`https://github.com/MoonshotAI/kimi-code`，正式 IDE 路线为 `kimi acp`。
- Claude Code 官方：`https://code.claude.com/docs/en/cli-usage`，非交互流为 `-p --output-format stream-json`。
- Codex 官方：`https://github.com/openai/codex`，非交互流为 `codex exec --json`/兼容 `--experimental-json`。

## 停止线

R1 只提供真实进程与探测地基，不声称三家已安装或认证。R2/R3/R4 必须分别实现解析、权限、Session、发送、失败、取消、dispose 与自己的 Activation Gate。
