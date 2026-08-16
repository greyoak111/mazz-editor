# W71 Windows 关联矩阵与 UserChoice 检查点（2026-08-16）

## 1. 结论

当前 Windows 安装 specimen 已把“应用能处理文件”与“应用是系统默认处理程序”拆成两条独立证据链：

| 入口 | 冷启动方式 | renderer 可见结果 | 默认应用边界 |
|---|---|---|---|
| `mazz://home` | Windows Shell | `隐私浏览器 — Mazz Editor` | Mazz 自有协议 |
| `.md` | 已核对注册命令的显式处理器 | `cold-start-file.md — Mazz Editor` | 不断言系统默认 |
| `.markdown` | 已核对注册命令的显式处理器 | `cold-start-file.markdown — Mazz Editor` | 不断言系统默认 |
| `.txt` | 已核对注册命令的显式处理器 | `cold-start-file.txt — Mazz Editor` | 保留 `txtfile` UserChoice |
| `.mazz` | Windows Shell | `cold-start-file.mazz — Mazz Editor` | Mazz 自有扩展 |

五条路径均达到：

```text
visibleRendererTargetObserved = true
gracefulCloseExitCode = 0
processExit.exited = true
executableRelease.released = true
forcedCleanupProcesses = 0
```

这关闭的是当前用户、当前主机上的四扩展处理器冷启动、Mazz 自有入口 Shell 冷启动、UserChoice 不改写和卸载残留子 Gate；不等于 Mazz 已成为 `.md/.markdown/.txt` 的系统默认应用。

## 2. UserChoice 不改写证据

门禁只读以下位置，不执行任何写入：

```text
HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.<ext>\UserChoice
  ProgId
  Hash
```

当前主机基线只有 `.txt` 存在受保护选择：

```text
ProgId = txtfile
Hash   = vUchSL47IoA=
```

以下五个时点均与基线逐字段一致：

```text
afterInstall                true
afterSameVersionReinstall   true
afterColdStarts             true
afterInstalledRuntime       true
afterUninstall              true
```

因此本轮证明 Mazz 安装、同版本覆盖、冷启动、暖启动/20 轮冒烟和卸载均没有抢占或重写用户默认应用。Hash 仅作为不变性证据记录，不生成、不解释、不复制到其他扩展。

## 3. 发现的 Windows 关联边界

第一次扩矩阵时，`.md` 可由 Shell 冷启动，但 `.markdown` 在没有 UserChoice 的状态下弹出 Windows `OpenWith.exe`，没有启动 Mazz。系统 `AssocQueryString` 同时仍能解析出正确的 Mazz 命令。

这说明：

```text
HKCU\Software\Classes 默认 ProgID 正确
≠
现代 Windows 已替用户选定默认处理程序
```

自动化不得为了得到绿色结果而写入 UserChoice，也不得留下等待人工关闭的“打开方式”窗口。因此正式矩阵采用：

- Mazz 自有 `.mazz` 和 `mazz://`：验证 Windows Shell 冷启动；
- 公共 `.md/.markdown/.txt`：先断言注册命令精确指向安装 EXE，再用该显式处理器做冷启动；
- 公共扩展的 Explorer 双击、默认应用选择和“始终使用”体验继续保持 OPEN。

## 4. 安装器缺陷与修复

### 4.1 Shell 刷新时序

electron-builder 模板的安装刷新发生在 `registerFileAssociations` / `customInstall` 之前，卸载刷新也发生在 `APP_UNASSOCIATE` 之前。当前在自定义安装和卸载尾部各追加一次 `SHCNE_ASSOCCHANGED + SHCNF_FLUSH`，确保刷新发生在最终注册表状态形成之后。

### 4.2 OpenWithProgids 残留

Windows 在实际分发后可能缓存：

```text
Explorer\FileExts\.<ext>\OpenWithProgids\com.mazz.editor.*
```

旧卸载门禁没有覆盖该区域。当前卸载器只删除四个 Mazz 自有 ProgID 值，不删除父键、不碰其他应用值，更不碰 UserChoice。安装循环也将这些值纳入 preflight 和卸载归零断言。

最终证据：

```text
windowsIntegrationRemoved = true
residueBeforeGuardedTempCleanup = []
guardedTempCleanup.removed = true
```

## 5. 自动证据

[`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json) 已升至 schema v5，新增：

```text
preflight.userChoices
coldStartShell.associatedFiles.{md,markdown,txt,mazz}
coldStartShell.protectedUserChoiceExtensions
coldStartShell.shellDefaultNotAssertedExtensions
coldStartShell.proprietaryShellExtensions
userChoicePreservation.snapshots
userChoicePreservation.unchangedAfterEachPhase
userChoicePreservation.allUnchanged
windowsIntegration.*.explorerOpenWithProgIdExists
```

同一隔离安装循环继续通过：

```text
clean install                         PASS
same-version reinstall               PASS
五入口冷启动                         PASS
主实例暖分发                         PASS
20-cycle packaged lifecycle          PASS
installed EXE release                PASS
silent uninstall                     PASS
Mazz 注册/快捷方式/安装目录残留         0
```

## 6. 当前发布 specimen

| 项 | 结果 |
|---|---:|
| installer bytes | `141,035,258` |
| installer SHA-256 | `AC13C34A153D6B0190FBEF3C9519D3B84A9826B335391E271470394ADF5E15A9` |
| `win-unpacked` bytes | `597,414,671` |
| `app.asar` bytes | `290,111,371` |
| source maps | `0` |
| unpacked native binaries | `10` |

完整发布物账见 [`W71_RELEASE_BASELINE.json`](./evidence/W71_RELEASE_BASELINE.json) schema v2。

## 7. Gate 边界

本检查点关闭：

- `.md/.markdown/.txt/.mazz` 四类文件均可由安装态 Mazz 显式处理器冷启动；
- `.mazz` 与 `mazz://home` 可由 Windows Shell 在应用未运行时冷启动；
- 已有第三方 `.txt` UserChoice 在安装、覆盖、运行和卸载后完全不变；
- Shell 关联刷新在写入/删除完成后执行；
- Mazz 自有 `OpenWithProgids` 卸载残留归零；
- 每次冷启动均正常退出，不依赖强杀。

仍保持 OPEN：

- Explorer 双击、“打开方式”“始终使用此应用”的可见 UI 与可访问性；
- 用户主动把 Mazz 选为 `.md/.markdown/.txt` 默认应用后的分发矩阵；
- 多用户、per-machine、非管理员账户；
- 真跨版本升级、失败升级、降级和回滚；
- 代码签名、SmartScreen、异机 ABI、DPI/RDP/多显示器矩阵。

## 8. Stopline

- 不得写入、伪造或重算 Windows UserChoice/Hash。
- 不得把“注册命令可用”写成“已经是系统默认应用”。
- 不得用可能弹出 `OpenWith.exe` 的公共扩展 Shell 调度做无人值守门禁。
- 不得只清理 `Software\Classes` 而忽略 Mazz 自有 `OpenWithProgids` 残留。
- 不得把当前主机的 UserChoice 不变性外推为所有 Windows 版本和账户模型通过。
