# W71 Windows Shell 冷启动与退出检查点（2026-08-16）

## 1. 结论

当前 Windows 安装 specimen 已通过两种“应用完全未运行”状态下的系统分发：

| 入口 | Windows 调度 | renderer 可见结果 | 退出 |
|---|---|---|---|
| `mazz://home` | `url.dll,FileProtocolHandler` | 主窗标题 `隐私浏览器 — Mazz Editor` | 正常关窗后全进程退出，EXE 解锁 |
| `.md` 真实文件 | `url.dll,FileProtocolHandler` | 主窗标题 `cold-start-file.md — Mazz Editor` | 正常关窗后全进程退出，EXE 解锁 |

两条冷启动均：

```text
visibleRendererTargetObserved = true
gracefulCloseExitCode = 0
processExit.exited = true
executableRelease.released = true
forcedCleanupProcesses = 0
```

这关闭的是当前用户模式、当前主机上的协议/Markdown 冷启动子 Gate；不等于 Explorer 的打开方式 UI、UserChoice/默认应用争用、多用户、签名或异机矩阵已经通过。

## 2. 门禁抓到的产品缺陷

测试最初在协议冷启动后调用正常主窗关闭。窗口消失，但四个 Electron 进程在 30 秒后仍存在。

根因是：

```text
closeBehavior = quit
→ onCloseRequest 设置 wm.forceClose 并允许主窗关闭
→ window-all-closed 无条件空操作
→ 应用仍按托盘常驻
```

也就是说，UI 中的“退出”实际只完成了关窗，没有完成进程退出。

当前修复：

```js
app.on('window-all-closed', () => { if (wm.forceClose) app.quit(); });
```

托盘模式仍在 `close` 阶段 `preventDefault()`，不会经过 `window-all-closed`；明确退出则进入原有 `before-quit` / `will-quit` 清理链。

## 3. 门禁自身的假故障与校正

第一版冷启动探针沿用了安装脚本的全局 `windowsHide:true`。这对已运行主实例的暖分发无影响，但 Windows 文件关联冷启动会把隐藏状态传给新主进程，形成：

```text
命令行正确
renderer 进程存在
主窗句柄/标题不可见
```

同一 EXE 直接带 Markdown 参数的 Playwright 对照可以正常显示，证明文件冷启动主链本身可用。最终门禁只对这两次 Explorer 等价 Shell 调度设置 `windowsHide:false`，随后协议和文件两条均通过。

这条校正很重要：可见 UI 验收不能由隐藏启动参数制造不可见，再把测试自污染误判成产品缺陷。

## 4. 自动证据

[`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json) 升级到 schema v4，新增：

```text
coldStartShell.protocol
coldStartShell.associatedFile
coldStartShell.allVisibleTargetsObserved
coldStartShell.allGracefullyReleased
```

进程普查按隔离安装目录中的精确 EXE 路径过滤，不按进程名宽杀；成功路径必须通过 `CloseMainWindow()` 正常退出。强制 Stop-Process 仅为失败清场，而且本次最终证据中两条 `forcedCleanupProcesses` 均为 `0`。

冷启动之后，同一个隔离安装仍继续完成：

```text
same-version reinstall                 PASS
主实例已运行时 protocol/.md 分发       PASS
20-cycle packaged lifecycle            PASS
installed EXE release probe            PASS
silent uninstall                       PASS
注册表/快捷方式/安装目录产品残留         0
```

## 5. 当前发布 specimen

| 项 | 结果 |
|---|---:|
| installer bytes | `141,035,138` |
| installer SHA-256 | `C7FEB742EDDEE416FDBD9C5055D684F2BE0E1DF2430F0600CDFF24FC9554F727` |
| `win-unpacked` bytes | `597,414,671` |
| `app.asar` bytes | `290,111,371` |
| source maps | `0` |
| unpacked native binaries | `10` |

完整发布物账见 [`W71_RELEASE_BASELINE.json`](./evidence/W71_RELEASE_BASELINE.json) schema v2。

## 6. 验收边界

本检查点关闭：

- 当前用户模式 `mazz://home` 冷启动到可见 Browser；
- 当前用户模式 `.md` 冷启动到可见 Markdown；
- 明确“退出”后的主窗、子进程和 EXE 占用收敛；
- 冷启动、暖分发、同版本覆盖和卸载在同一安装循环内共存。

仍保持 OPEN：

- Explorer 双击与“打开方式”人工截图/可访问性体验；
- UserChoice / 默认应用争用与已有第三方默认程序保护；
- `.markdown/.txt/.mazz` 的逐项冷启动 UI（注册/暖分发已覆盖）；
- 多用户、per-machine、非管理员账户；
- 真跨版本升级、失败升级、降级与回滚；
- 代码签名、SmartScreen、异机 ABI、DPI/RDP/多显示器矩阵。

## 7. Stopline

- 不得用直接启动 EXE 冒充 Windows Shell 冷启动。
- 不得用 `windowsHide:true` 执行可见 UI 验收。
- 不得只看主窗消失而跳过后台进程和 EXE 占用。
- 不得把当前主机的两条冷启动外推为默认应用 UX 或系统矩阵完成。
