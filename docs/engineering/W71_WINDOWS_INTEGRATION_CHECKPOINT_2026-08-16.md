# W71 Windows 文件关联与 `mazz://` 检查点

> 日期：2026-08-16
>
> specimen：`release/Mazz Editor Setup 0.2.0.exe`
>
> 范围：当前 Windows 主机、当前用户安装模式、四种基础文件关联与 `mazz://home`；不外推为全部 Shell/DPI/异机系统集成通过

## 1. 结论

本轮从真实安装残留中发现并关闭了三项发布正确性债：

1. 应用每次启动调用 `setAsDefaultProtocolClient`，而 NSIS 卸载器不知道这条注册，导致卸载后 `mazz://` 仍指向已删除 EXE；
2. 文件关联把 `Markdown Document`、`Text Document` 当成 Windows ProgID，名字过于通用，存在覆盖/删除其它应用类键的风险；
3. electron-builder 默认生成的文件关联命令没有给含空格的 EXE 路径加引号。

修复后的证据链为：

```text
NSIS 安装器持有注册所有权
→ com.mazz.editor.* 唯一 ProgID
→ 带引号的 EXE / "%1" 命令
→ 文件参数与 mazz://home 二实例转发
→ renderer 真消费
→ NSIS 卸载恢复原默认值并清除 Mazz 私有状态
```

当前主机的“基础文件关联与 `mazz://`”子门禁可记为 **PASS**。

## 2. 注册所有权修复

新增 `build/installer.nsh`，由 NSIS 成对执行：

- 安装时注册 `mazz` URL protocol、图标与带引号的打开命令；
- 卸载时只有命令仍指向本次安装目录时才删除 `mazz` key，避免误删后来接管者；
- `.md` / `.markdown` 使用 `com.mazz.editor.markdown`；
- `.txt` 使用 `com.mazz.editor.text`；
- `.mazz` 使用 `com.mazz.editor.workspace`；
- 覆盖 builder 默认的未引号命令；
- 卸载在恢复旧默认值后删除 Mazz 的 `_backup` 记账值；
- 专有 `.mazz` 扩展在没有旧 owner 时连空 key 一并移除；
- 清理旧版本曾留下的通用 ProgID backup 值。

应用运行时不再自动调用 `app.setAsDefaultProtocolClient`。系统注册由安装器所有，应用只负责消费启动参数。

## 3. 运行链修复

主进程新增确定的 protocol 参数提取和待消费队列：

- 冷启动参数在 renderer ready 后回放；
- 二实例参数唤起/聚焦主窗并转发；
- renderer reload 期间不把链接发进尚未就绪的窗口；
- 非 `mazz://` 参数不进入协议路径。

renderer 当前冻结的最小行为是：`mazz://home` 打开 Mazz 浏览器主页。其余未来深链路没有借此扩张成通用路由或 W70/W81 接口。

文件关联继续复用既有 `file:open` 路径；本轮真实安装后以关联文件参数拉起第二实例，主实例成功打开对应 Markdown 文件。

## 4. 真安装证据

| 项目 | 结果 |
|---|---:|
| installer bytes | 141,035,065 |
| installer SHA-256 | `553D0FFD7D8A005EED8434980EA7F1592456E78D9C6D11C6D7A7FCAFE998A70A` |
| installed EXE SHA-256 | `3FBA3247574EE175DDEB8FC1719EB8F195A8BE96FF10530ECA956FD6410BA39B` |
| `.md/.markdown/.txt/.mazz` 默认 ProgID | 4/4 精确匹配 |
| 协议/关联命令 | 4 类关联 + 1 协议均为带引号的安装目录 EXE |
| `mazz://home` 二实例 | renderer 真观察并打开 Browser |
| 关联文件二实例 | 真打开目标 Markdown |
| 额外资源回收 | 回到启动基线 |
| 卸载后 Mazz protocol / ProgID / backup | 0 |
| 原文件类型默认值 | 恢复 |

机器证据：[`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json) schema v3。发布物清单同步见 [`W71_RELEASE_BASELINE.json`](./evidence/W71_RELEASE_BASELINE.json)。schema v3 另加入同一 specimen 的同目录覆盖安装证明，详见 [`W71_SAME_VERSION_REINSTALL_CHECKPOINT_2026-08-16.md`](./W71_SAME_VERSION_REINSTALL_CHECKPOINT_2026-08-16.md)。

## 5. 自动门禁

`npm run test:w71:installer` 现在同时断言：

- 测试前无既有 Mazz 安装、快捷方式、协议、ProgID 或私有 backup；
- 安装后五条系统集成命令精确引用当前隔离 EXE；
- 旧通用 backup 不存在；
- 安装后 EXE 完成原有 20 轮 packaged smoke；
- `mazz://home` 与文件参数经第二实例抵达现有主实例；
- 关闭临时标签后资源回到基线；
- 卸载恢复原默认值，Mazz 私有注册和产品文件归零。

## 6. 未关闭边界

- Windows Shell 的真实双击/“打开方式”可见 UI 与默认应用争用；
- 冷启动 ShellExecute 的独立进程链（本轮以精确注册命令 + 冷启动队列契约 + 二实例真运行组成证据）；
- 除 `mazz://home` 外的深链接 schema；
- 多用户/per-machine 安装、提升权限、其它 Windows 版本；
- 跨版本覆盖升级、失败升级、降级、回滚；同版本 reinstall 已由后续检查点补证；
- 代码签名、SmartScreen 与签名后 hash；
- 默认用户数据保留/删除策略和交互式卸载选项。

因此准确口径是：

> **当前用户模式的基础文件关联与 `mazz://home` 注册、消费、卸载对称性 PASS；完整 Windows 系统集成与发布 Gate 继续 OPEN。**
