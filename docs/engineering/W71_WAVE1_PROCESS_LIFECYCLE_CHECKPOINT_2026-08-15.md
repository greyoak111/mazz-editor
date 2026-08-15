# W71 Wave 1 Python / DAP 进程生命周期检查点

> 日期：2026-08-15
>
> 承接坐标：`main@2b011c6`
>
> 状态：Python 与 DAP 进程已接入 ResourceLedger，完成 20 轮契约循环和 packaged Python 真运行；**没有宣称 Wave 1 结案**

## 1. PythonKernel 收敛

Python 计算内核此前只有应用退出时的裸 `kill()`，进程、轮询 timer、待执行队列和临时驱动脚本没有统一归属。现在：

- 驱动进程登记为 `python-process`，临时驱动脚本登记为 `temp-file`；
- 驱动脚本使用当前应用进程专属文件名，停止、异常退出和应用退出都会删除并释放账本；
- 当前任务的 timeout / interval 与排队任务统一收尸，进程异常退出不会让 promise 永久悬空；
- 执行超时会终止已经不可置信的内核，不把迟到输出灌入下一次任务；
- Python 探测进程的 4 秒 timer 在探测完成后清除；
- `kill()` 幂等，旧进程的迟到 exit/error 回调不能释放新进程的资源。

## 2. DebugService / DAP 收敛

DAP 此前存在三类真实生命周期风险：旧适配器退出回调直接把 `this.session` 清空、请求成功后 timeout timer 仍保留、initialize/launch 失败返回时可能留下适配器进程。现在：

- 每个 DAP 进程有独立 session 对象与 `debug-process` 账本项；
- stdout、stderr、exit、error 和 response 都绑定创建它们的 session；
- 旧 session 迟到退出只清理自己，不覆盖新 session；
- pending request 同时持有 resolve 与 timer，响应、停止和异常退出都会清 timer 并给出确定结果；
- initialize 或 launch 失败立即销毁该 session；
- stop、替换、异常退出和 app quit 统一走幂等 `_endSession()`。

## 3. 20 轮证据

契约层：

```text
PythonKernel：20 次 exec → process/temp-file 在账 → kill → 账本归零、临时目录为空
DAP：20 次 old session → replacement → old exit 到达 → new session 仍存活 → stop → 账本归零
```

DAP 测试每轮包含一次替换，因此实际创建并释放 40 个伪适配器进程。伪适配器只验证生命周期与 DAP framing，不冒充外部 `debugpy` 真工具链。

packaged Windows：

```text
PTY × 20
Settings PanelWindow × 20
WebContentsView × 20
FileWatcher 路径增减 × 20
WebTorrent client + range server × 20
Python 3.14 真实计算进程 + 临时驱动 × 20
```

正式 `release/win-unpacked/Mazz Editor.exe` 每次执行 `1 + 1` 均返回 `2`；Python 进程和临时驱动每轮都回到账本基线，最终保留 140 条释放历史，应用退出后无残留 Mazz/Python 子进程。

## 4. 验证水位

```text
W71 lifecycle-security contract：8 / 8
全量 Node test files：133 / 133
Windows NSIS build：PASS
release audit：PASS
native audit：10 个 packaged .node / 外平台 0，PASS
packaged lifecycle smoke：20 次 × 6 族，PASS
```

本检查点最终 specimen：

| 指标 | 当前值 |
|---|---:|
| installer | 150,813,568 bytes / 143.83 MiB |
| installer SHA-256 | `D16B26273110B857DB745A4EDE44B4445518D9B857320E5871BC91C920C8C8B1` |
| win-unpacked | 668,006,005 bytes / 637.06 MiB |
| app.asar | 360,637,189 bytes / 343.93 MiB |
| app.asar entries | 9,910 |
| unpacked native | 10 files / 2,625,024 bytes |

## 5. 明确保留的缺口

| 未尽项 | 状态 |
|---|---|
| 本机没有 `debugpy`，DAP 尚未完成 packaged 真适配器 initialize/launch/stop | OPEN；不得把伪适配器 20 轮写成真工具链通过 |
| worker / media / Object URL / Factory stream 资源账本 | OPEN |
| Viewer / Factory / Agent 与多窗迁移 20 次循环 | OPEN |
| 3 个 node-pty `build/Release` 的异机 clean-install ABI | PARTIAL |
| `buffers@0.1.1` 与 ffmpeg exact source/build/license | OPEN |
| 签名、安装/升级/卸载、文件关联、DPI 与休眠矩阵 | OPEN |
| Kimi Code + Codex 两个真实 Adapter | OPEN；仍为 0 |

W62e、W63、W64、W65、W67、W69、W70 与 W72–W81 的历史欠账不受本检查点影响，继续以交付区《Mazz 当前未落地全景-W71归并版》为唯一总表。

> 后续进展：Viewer owner、Player 全局监听和基础 Object URL 生命周期已在 [`W71_WAVE1_VIEWER_LIFECYCLE_CHECKPOINT_2026-08-15.md`](./W71_WAVE1_VIEWER_LIFECYCLE_CHECKPOINT_2026-08-15.md) 完成定向收敛与 packaged 20 轮；Factory/Agent/多窗与真实媒体设备分支仍保持 OPEN。
