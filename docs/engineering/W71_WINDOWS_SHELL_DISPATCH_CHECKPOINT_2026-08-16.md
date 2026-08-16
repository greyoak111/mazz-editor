# W71 Windows Shell 真分发检查点

> 日期：2026-08-16
>
> specimen：`release/Mazz Editor Setup 0.2.0.exe`
>
> 范围：当前 Windows 主机、当前用户、主实例已运行时，由 Windows Shell 依据协议/扩展注册分发 `mazz://home` 与 `.md`；不冒充资源管理器可见 UI、默认应用争用或冷启动 Shell 全矩阵

## 1. 结论

当前主机的 Windows Shell 二实例分发子门禁为 **PASS**。

此前证据是：

```text
注册表命令精确
+
直接执行 installed EXE 并传入 URL / 文件参数
```

本轮提升为：

```text
Windows url.dll / FileProtocolHandler
→ Shell 根据 mazz:// protocol 或 .md association 选择处理程序
→ installed Mazz Editor 第二实例
→ Electron single-instance argv
→ 主进程排队/转发
→ renderer 真打开 Browser / Markdown
```

因此不再用“手工按已知 EXE 路径启动成功”代替系统分发证明。

## 2. 两条真路径

### `mazz://home`

- Windows Shell 启动协议目标；
- Windows 会把输入规范化为 `mazz://home/`，测试按协议语义比较，不按尾斜杠逐字比较；
- renderer 收到协议并打开 Browser；
- `integrationLaunchMode=windows-shell`。

### `.md`

- Windows Shell 直接接收真实 Markdown 文件路径；
- Shell 根据当前系统关联启动 Mazz；
- 第二实例把文件参数交给既有主实例；
- 主实例真打开目标 Markdown 标签；
- 关闭协议/文件产生的标签后，活动资源回到启动基线。

## 3. 退出与卸载竞态门禁

第一次把 Shell 分发接入测试后，暴露过一次“主程序刚关闭就立即卸载，EXE 仍被短暂占用”的竞态。卸载器删除了注册，但当轮留下被占用的主 EXE，门禁按残留失败，没有把它忽略。

测试现加入确定的 executable release gate：

```text
关闭 packaged app
→ 尝试把 installed EXE 原子改名为 probe
→ 立即原名还原
→ 成功才准启动 uninstaller
```

该探针最多等待 30 秒、每 250 ms 重试；还原失败会立即阻断。最终成功轮为 `released=true`、`attempts=1`，silent uninstall 后 EXE、注册、快捷方式、协议、ProgID、backup 与隔离目录归零。

## 4. 自动证据

[`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json) schema v3 新增/确认：

- `installedRuntime.smokeResult.integrationLaunchMode = windows-shell`；
- `protocolObserved = true`；
- `associatedFileObserved = true`；
- `integrationResourcesReturnedToBaseline = true`；
- `installedRuntime.executableRelease.released = true`；
- 完整 reinstall、运行、卸载与注册表恢复证据继续同文件保存。

## 5. 未关闭边界

- Mazz 未运行时，由 Shell 冷启动并消费 URL / 文件的独立 E2E；
- Explorer 双击、“打开方式”、默认应用选择和 UserChoice 可见 UI；
- 用户已有其它 `.md/.txt` 默认程序时的竞争/提示策略；
- `.mazz` 作为产品格式的最终语义与两种既有 `.maz` 协议边界；
- 多用户/per-machine、提升权限、其它 Windows 版本；
- 跨版本升级、失败升级、降级、回滚；
- 签名、SmartScreen、DPI/RDP/多显示器。

准确口径：

> **当前用户、主实例已运行时的 Windows Shell 协议/Markdown 分发与退出后卸载 PASS；冷启动 Shell、默认应用 UX 与完整系统矩阵继续 OPEN。**
