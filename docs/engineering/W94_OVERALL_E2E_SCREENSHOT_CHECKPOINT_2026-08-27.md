# W94 Overall E2E + Screenshot Checkpoint

> 结论：**验证通过 / W94 总波仍保持 PARTIAL**  
> 日期：2026-08-28
> 范围：W94A–W94F 已落地内容的 Source/Packaged 运行回归与桌面整体截图核验

## 1. 验证矩阵

| 波次 | Source | Packaged (`win-unpacked`) | 关键断言 |
|---|---|---|---|
| W94A Capability Execution Spine | PASS | PASS | exact replay、restart/reopen、durable proposal/receipt/artifact、资源归零 |
| W94B Calc + Chart Artifact | PASS | PASS | typed calc `5`、deterministic SVG、single-use artifact grant、资源归零 |
| W94C Canvas Agent | PASS | PASS | document roundtrip、revision、SVG export、single-use grant |
| W94D Blender External Capability | PASS | PASS | Blender 5.2 fixture probe、render/inspect/export、失败/取消、外部进程归零 |
| W94E Relation + Branch | PARTIAL（双 Mazz 定向 A/B PASS） | PARTIAL（双 Mazz 定向 A/B PASS） | 查询解释/拒绝重放、多父冲突 resolution、双 Mazz state-fact TLS；正式 outcome 缺口仍在 |
| W94F Player Transport + Watch Room | PASS_WITH_SCOPE | PASS_WITH_SCOPE | 51 项无固定队列门、W94Fb 显式 W93 Candidate bridge + Workspace A/B、capability/Range、重启 `paused`、双 Mazz TLS room、host transfer/new epoch、durable replay；公网 P2P/跨机器房间仍显式 opt-in |

各项 Packaged 证据保留各自运行时的 `executableSha256`，不把不同次构建伪装成同一代；本次
W94Fe 最新 `win-unpacked` EXE SHA-256 为
`12a427ac980e022f2bec3be31b6ddb8f72723067e771538fd16039fcd4bbb080`，对应证据文件已固定。

所有六个波次均报告 `networkCalls=0`、`runtimeErrors=[]`；运行结束后 Mazz Editor 进程数为 `0`。

## 2. 桌面截图核验

截图来自当前 Packaged 窗口（Windows 10 兼容捕获 helper，`mappingValid=true`、`blankSuspected=false`、`protected=false`、`captureExcluded=false`），并已逐张目视检查：

- [`W94_OVERALL_PACKAGED_20260827.png`](./evidence/W94_OVERALL_PACKAGED_20260827.png)：主界面、完整侧栏、文件树、核心模块入口，布局稳定，无侧栏刷新闪动。
- [`W94_PLAYER_PACKAGED_20260827_c.png`](./evidence/W94_PLAYER_PACKAGED_20260827_c.png)：播放器空态、播放控制条及“播放列表/媒体库/网络资源/下载”入口均可见，状态清晰。
- [`W94_CALC_PACKAGED_20260827_b.png`](./evidence/W94_CALC_PACKAGED_20260827_b.png)：计算 REPL、隔离 Python 状态、重启内核/清屏/运行入口和输入区均可见。

截图只读核验，没有导入、播放、执行或写入用户资源。

## 3. 边界声明

本检查点只证明已实现的 W94A–F 切片在 Source/Packaged 和当前桌面壳中通过；W94E/W94Fe 的第二个 Mazz
实例已在真实 TLS loopback 证据中覆盖，但真实公网 P2P/跨机器房间仍是显式 opt-in。媒体资源到
W93 书籍 Job 的正式 bridge、Workspace A/B 切换已由 W94Fb Source/Packaged 证据闭合；其余公共
入口与审计红项仍按各自检查点保持 PARTIAL/OPEN。
