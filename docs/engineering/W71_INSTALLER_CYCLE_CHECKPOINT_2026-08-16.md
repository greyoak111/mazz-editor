# W71 Windows 安装 / 运行 / 卸载检查点

> 日期：2026-08-16
>
> specimen：`release/Mazz Editor Setup 0.2.0.exe`
>
> 范围：本机隔离目录中的静默 clean install、干净用户数据首次启动、安装后真运行与 silent uninstall；不冒充异机、签名、覆盖升级或完整系统集成矩阵

## 1. 结论

当前 NSIS specimen 已完成一条可重复、无需人工点击的真实安装链：

```text
无既有安装/快捷方式预检
→ 隔离临时目录静默安装
→ 卸载注册项出现
→ 从安装目录启动正式 Mazz Editor.exe
→ 干净 userData 完成 20 轮 packaged 生命周期冒烟
→ 静默卸载
→ EXE、卸载注册、快捷方式与测试安装目录归零
```

本轮关闭了“只证明 `win-unpacked` 可运行、尚未证明 NSIS 安装后可运行和可卸载”的本机证据缺口。它没有关闭完整 Packaged Windows Hard Gate。

## 2. 固定 specimen

| 项目 | 结果 |
|---|---:|
| installer | `Mazz Editor Setup 0.2.0.exe` |
| installer bytes | 141,028,503 |
| installer SHA-256 | `D178BFC98310233781BDB43E885A4963FCD3EF83A6958C5CCE8831A59620D4D1` |
| installed EXE SHA-256 | `8B8752FFDE812849531D3EEB4DF6376F477CB987913E520773B2103BF6EFA802` |
| install exit | 0 |
| installed runtime smoke | PASS |
| uninstall exit | 0 |

机器可读证据：[`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json)。

## 3. 安装后真运行覆盖

安装目录中的正式 EXE 使用独立、干净的 userData 与工作区启动。运行证据确认：

- 主窗、PTY、Panel、WebContentsView、FileWatcher、WebTorrent、Python、Viewer、Factory request 与 Monaco worker 均在 packaged runtime 被真实观察到；
- Browser/Panel/PTY/P2P/watcher 共享生命周期路径完成 20 轮；
- Viewer、Factory 与 Monaco 分别完成 20 轮；
- Monaco 创建 18 个 worker、终止 16 个、保留 2 个活动基线，错误为 0，关闭后的 model 为 0；
- adapters 与 sessions 均回到 0。

这比直接运行 `release/win-unpacked` 多证明了两件事：NSIS 确实把可运行资产安装到目标目录；正式安装产物没有因路径、asar/unpacked 或安装布局变化破坏当前主链。

## 4. 卸载与安全边界

测试在执行任何安装前会查询当前用户卸载注册与常见快捷方式。若发现既有 Mazz Editor 安装或快捷方式，则立即拒绝运行，避免碰触维护者现有安装。

本轮卸载后确认：

| 检查项 | 结果 |
|---|---|
| 安装目录中的主 EXE | 已移除 |
| HKCU 卸载注册 | 已移除 |
| Desktop / Start Menu 常见快捷方式 | 无残留 |
| 测试安装目录产品文件 | 0 |
| 自有临时目录 | 受限于系统临时根目录、短暂占用有界重试后移除 |

清理器只接受系统临时目录内部的测试自有路径。目标越界、等于临时根目录或信号不干净时均拒绝递归清理。

## 5. 新增回归入口

```text
npm run test:w71:installer
```

该入口串起安装、安装后 packaged smoke、卸载和残留审计；证据固定写入 `docs/engineering/evidence/W71_INSTALLER_CYCLE.json`。契约测试同时守住隔离目标、既有安装预检、安装后 EXE 注入和受限清理条件。

## 6. 未关闭边界

以下仍为 OPEN，不得从本检查点外推：

- 干净异机上的 native ABI、VC runtime、杀软与权限验证；
- 代码签名、SmartScreen 与签名后 hash；
- 覆盖升级、失败升级、降级与回滚；
- 默认用户数据在卸载时保留/删除的产品策略；
- `.md` / `.markdown` / `.txt` / `.maz` 文件关联及 `mazz://` 协议；
- 开始菜单目录变体、交互式安装/卸载 UI、多用户安装；
- 多 Windows 版本、DPI、休眠、多显示器与 RDP 矩阵。

因此当前准确口径是：

> **本机 clean install + 安装后首次启动/20 轮运行 + silent uninstall 子门禁 PASS；完整 Packaged Windows Gate 继续 OPEN。**
