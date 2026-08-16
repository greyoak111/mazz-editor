# W71 Packaged DAP Runtime 检查点（2026-08-16）

> 范围：现有 Python DAP / debugpy Adapter 的真实 packaged 握手、调试能力与生命周期。
>
> 结论：**当前 Windows 主机的 Python Adapter 真运行子门禁 PASS；debugpy 未随产品内置，其他语言 Adapter、远程/容器调试与异机矩阵仍 OPEN。**

## 1. 真运行揭示的两个根因

历史契约只使用“收到 launch 立即回复”的伪适配器，因此能证明 session owner 不互相覆盖，却不能证明真实 DAP 状态机可走通。本轮以隔离安装的固定 debugpy 驱动正式 `release/win-unpacked/Mazz Editor.exe`，发现：

1. 主进程在 `debug:start` 内等待 `launch` response 后才返回；真实 debugpy 的顺序是 `launch request → initialized event → setBreakpoints / configurationDone → launch response`，因此 renderer 永远拿不到发送 `configurationDone` 的机会；
2. 被调试程序结束后，debugpy 发送 `terminated`，但 adapter 进程可以继续等待客户端断开；Mazz 只等待 adapter 自行退出，导致最后一次调试会话和 `debug-process` 资源常驻，下一次启动才被动替换。

修复后：主进程在 `initialized` 后放行 renderer 配置断点，同时继续观察迟到的 launch 失败；`terminated` 成为会话终态，立即停止 adapter、释放资源，并同步结束 renderer 调试态。

## 2. 固定适配器与供应证据

为避免修改系统 Python 或把测试依赖混入产品，本轮只在仓库临时隔离目录安装 wheel；验证完成后已移出工作树，不进入 Git、安装包或系统 Python：

```text
Python             3.14.6 x64
debugpy            1.8.21
wheel              debugpy-1.8.21-cp314-cp314-win_amd64.whl
wheel bytes        5,373,803
wheel SHA-256      FE0744A12353406DE0AE8CCFF0D0A4A666F00801A3DB8FD04E7A5F761CD520E8
```

测试通过 `MAZZ_E2E_DEBUGPY_SITE`、`MAZZ_E2E_DEBUGPY_WHEEL` 与 `MAZZ_E2E_PYTHON` 显式提供坐标。正式产品仍遵循现有“使用用户已安装的 Python + debugpy”边界，不暗中下载、不新增运行依赖。

## 3. 正式 packaged 调试矩阵

| 路径 | 结果 |
|---|---|
| initialize → launch → initialized | **PASS；启动返回 854 ms** |
| Python 文件第 2 行断点 | **verified，真实 stopped line=2** |
| stackTrace | **2 帧** |
| scopes / variables | **Locals `a=2`、`b=3`** |
| continue / 程序执行 | **真实结果文件=`5`，stdout event 可见** |
| terminated → adapter 收尸 | **21 次 terminated，21 个 debug-process 释放** |
| 连续生命周期 | **完整调试 1 次 + 无断点 20 次；每轮 initialize/process/exited/terminated 齐全** |
| 资源账 | **基线 `2` → 最终 `2`** |

20 轮耗时：最短 1,622 ms，最长 1,711 ms，平均 1,656 ms。完整机器证据见 [`W71_DAP_RUNTIME.json`](./evidence/W71_DAP_RUNTIME.json)。

## 4. 自动门禁

```text
node tests/contract/w71-lifecycle-security.test.mjs
node tests/contract/w71-monaco-lifecycle.test.mjs
npm.cmd run test:w71:dap-runtime
```

契约现在同时覆盖：标准 DAP 握手不能自锁、`terminated` 必须释放 adapter、旧进程迟到退出不能覆盖新会话、renderer 终态必须清掉活动 UI。

同一最终 specimen 还通过全量、发布物与安装门禁：

```text
npm.cmd test                     143 / 143 测试文件
npm.cmd run dist                 正式 NSIS + win-unpacked
npm.cmd run audit:release        schema v2 发布边界审计
npm.cmd run test:w71:installer   schema v5 真安装/覆盖/五入口/20 轮/卸载
```

```text
installer      141,041,336 bytes
SHA-256        BB3AA049DBA22CC1FD13E6D50C1EA0536FDE7FB92BF0FB0827F70F836FCD193D
win-unpacked   597,421,597 bytes
app.asar       290,118,297 bytes
source maps    0
```

安装回归继续保持九个既有运行族各 20 轮、ResourceLedger `2→2`、五入口可见、UserChoice 原值不改写，以及卸载后注册/关联/安装目录残留归零。DAP 固定适配器测试在 `win-unpacked` 上独立完成，不把测试用 debugpy wheel塞入安装包。

## 5. Gate 与停止线

| Gate | 结论 |
|---|---|
| 当前主机 Python 3.14 + debugpy 的 packaged DAP 真适配器 | **PASS** |
| 断点、栈、局部变量、继续、输出与正常终止 | **PASS** |
| 20 次 adapter 生命周期与 ResourceLedger | **PASS** |
| debugpy 自动安装/随包分发 | **NOT IMPLEMENTED；不是本轮目标** |
| JavaScript、C/C++ 等其他真实 Adapter | **OPEN** |
| attach、远程、容器、子进程、多线程/协程复杂样本 | **OPEN / Stretch** |
| 异机 Python 版本与 Windows/DPI/RDP 矩阵 | **OPEN** |

本检查点关闭旧总表中“本机缺 debugpy，DAP 没有 packaged 真适配器证据”的具体缺口，不把单一 Python Adapter 扩写为完整调试平台，也不改变 W66 Agent Harness 的 0 个真实 Agent Adapter 事实。
