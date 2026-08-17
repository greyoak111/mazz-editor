# W72d External Tool Adapter Protocol v0

> 日期：2026-08-17
>
> 状态：**FROZEN / CONTRACT ONLY**
>
> 实现：[`main/foundation/external-tool-adapter.js`](../../main/foundation/external-tool-adapter.js)
>
> 消费者：W79 External Tool Capability / Blender Headless Pilot（未自动批准）

## 1. 定位

External Tool Adapter 只回答：

> Mazz 如何用可审计、可取消、可释放的统一边界调用一个独立安装的生产工具？

它不是工具安装器、进程池、Factory Router、Agent 会话、Capability Registry、外部工具 UI 或万能命令执行器。W72d 只冻结协议和验证器，没有探测、安装或调用任何真实外部生产软件。

```text
Capability Registry  = 描述“有哪些实现候选”
External Tool Adapter = 约束“一个外部工具调用如何被观察与收口”
Agent Harness         = 管理“Agent 如何持续工作与交互”
Factory / W73         = 决定“任务为何、何时、由谁执行”
Resource Ledger       = 记录“运行资源是否已经释放”
```

五者可以在后续消费者中组合，但不得互相冒充。

## 2. 协议表面

Adapter 身份：

```text
protocol = mazz.external-tool-adapter/v0
id / toolId / displayName / provenance
probe() / run(request) / cancel(runId) / dispose()
```

只允许四个生命周期方法：

- `probe`：只探测 availability、executable path、version、reason 和 provenance；
- `run`：接收结构化 Run Request，返回 terminal Run Result；
- `cancel`：按 `runId` 幂等请求取消；
- `dispose`：收口 Adapter 持有的所有运行资源，完成态必须报告 `activeRuns=0`。

不存在 `createSession/send/events/capabilities`，避免退化成第二套 Agent Harness；不存在 `resolve/route/cost policy`，避免吞并 Registry 或 Factory。

## 3. Probe

Schema：`mazz.external-tool-probe/v0`

| 字段 | 约束 |
|---|---|
| `adapterId` | 稳定 Adapter 身份 |
| `available` | 严格 boolean |
| `executablePath` | available 时必填；只报告，不自动执行 |
| `version` | available 时必填；不得以“已找到路径”冒充已知版本 |
| `reason` | unavailable 时必填 |
| `provenance` | 项目、版本、许可证/分发边界等证据 |

Probe 不是安装动作，也不能修改 PATH、注册表、用户配置或工作区。

## 4. Run Request

Schema：`mazz.external-tool-run-request/v0`

```text
runId
operation
workdir
inputs[]  = role + asset id/path/type/version
outputs[] = role + requested path/type
provenance
```

硬约束：

1. `workdir` 必须显式给出，Adapter 不得默认为仓库根、用户目录或系统临时目录；
2. 输入必须是稳定 Asset Ref，不把正文、脚本或二进制塞进协议包；生成脚本也应先成为输入资产；
3. 输出路径和类型必须事前声明，实际产物另由 Result 回供；
4. `operation` 是能力/工具适配器理解的稳定操作 ID，不是 shell command；
5. 顶层 `command/shell/env` 均不是协议字段，不能把通用 Adapter 变成任意命令执行后门；
6. v0 不定义自动路由、费用选择、重试策略、权限审批或 UI。

协议验证只证明数据形状。真实实现仍必须在 W79 校验 workdir/input/output 的解析后路径边界、文件存在性、权限和符号链接/重解析点。

## 5. Terminal Run Result

Schema：`mazz.external-tool-run-result/v0`

```text
runId
status = succeeded | failed | cancelled
stdout / stderr
exit = code + signal + reason
durationMs
outputs[] = role + asset id/path/type/version
provenance
```

一致性要求：

- `succeeded` 必须对应 `exit.code=0`；
- `failed` 必须有非零 code、signal 或明确 reason；
- `cancelled` 必须有明确 reason；
- 输出必须回供稳定身份与版本，不能只写“文件应该在某处”；
- `stdout/stderr` 是终态审计字段；真实 Adapter 必须做有界采集或把完整日志落为资产，不能无界吃内存；
- `durationMs` 只记录本次调用耗时，不是性能承诺。

## 6. Cancel / Dispose

Cancel Schema：`mazz.external-tool-cancel-result/v0`

```text
accepted | cancelled | already-terminal | not-found
```

重复取消不得抛出不确定错误。`accepted` 只表示取消请求已受理，不等于进程树已经收尸；最终仍由 Run Result 和 Resource Ledger 证明终态。

Dispose Schema：`mazz.external-tool-dispose-result/v0`

Dispose 必须幂等。只有 Adapter 已无活动运行时才能返回：

```text
status = disposed
activeRuns = 0
```

该返回值在 W72d 只是契约声明；W79 的真实实现必须以进程树与 Resource Ledger 证据交叉验证，不能信任 Adapter 自报。

## 7. W79 激活 Gate

任何真实工具 Adapter 在成为正式能力前，至少需要：

1. 固定工具身份、来源、版本、许可证、是否随 Mazz 分发；
2. 明确 executable allowlist，不经 shell 拼接命令；
3. 显式 workdir，解析后 input/output 路径均被限制在允许根内；
4. 环境变量最小白名单，secret 不进入日志或 Resource Ledger；
5. timeout、取消、重复取消、dispose、应用退出均能收口整棵进程树；
6. Resource Ledger 在成功、失败、取消、崩溃和退出后回到基线；
7. stdout/stderr 有界，完整日志需要时落为可追溯资产；
8. 输出实际存在、类型正确、计算版本/哈希后才登记 Asset；
9. partial output、失败脚本和临时目录有明确保留/清理政策；
10. 真工具定向测试、20 轮循环和 packaged Windows 证据通过。

Blender 只是 W79 的候选首个 Pilot。本协议不包含 Blender 名称、参数、安装路径、Python API 或许可证结论，因此将来可以适配其它 CLI/API 工具而不重写上层语义。

## 8. 非目标

- 不安装、下载、升级或启动外部工具；
- 不新增依赖、IPC、UI、后台服务或全局 Adapter Registry；
- 不复用 Terminal 作为自动化执行通道；
- 不接受任意 shell 命令或完整环境透传；
- 不实现 W79、W73、W84 或 W86；
- 不把协议通过等同于真实工具稳定、许可闭环或产物可信。
