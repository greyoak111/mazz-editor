# W71 跨窗口事务性交接检查点

> 日期：2026-08-16
> 起始坐标：`main@90737b4`
> 范围：Wave 1 / Lifecycle + Data Reliability 的代表性 Markdown 标签迁移子门禁
> 结论：**PASS（限定范围）**

## 1. 本轮关闭的风险

旧交接链把“主进程已经发出消息”当成“目标窗口已经接收并恢复标签”。源窗口会立即删除本地标签；目标若尚未加载、已经存在同文件、渲染进程崩溃或恢复失败，脏稿就可能丢失。同时，交接快照没有携带 `dirty`、`pinned` 和选择区/阅读进度，恢复快照又只以 `tabId` 命名；主窗与分窗都从 `tab-1` 起号，存在跨 renderer 互相覆盖、互相误删，甚至新一轮进程覆盖旧恢复材料的风险。

本检查点完成：

1. 主进程为每次交接生成一次性 `transferId`，记录目标 WebContents owner，只接受该目标的 ACK。
2. 目标销毁、renderer crash、12 秒超时或显式拒绝均使交接失败；源标签只有在成功 ACK 后才关闭。
3. 目标已打开相同文件和模块时返回 NACK，不覆盖目标，也不删除源脏稿。
4. 交接载荷保留内容、文件路径、`dirty`、`pinned` 与模块进度；目标先恢复状态并落脏稿快照，再发 ACK。
5. 恢复快照键改为 `runId + sender WebContents id + tabId`，清理只作用当前 owner，并兼容清除旧版无 owner 快照。
6. 空工作台分窗的既有调用保持兼容，不强制要求数据 ACK。

该协议是有 owner、超时和失败语义的单用途两阶段交接，不是通用 Event Bus，也不引入 SurfaceManager。

## 2. 可重复证据

### Contract

- 新增 [`tests/contract/w71-window-handoff.test.mjs`](../../tests/contract/w71-window-handoff.test.mjs)，覆盖 ACK owner、超时、renderer gone、字段完整性、ACK 前快照，以及同名 `tabId` 的跨 renderer/跨 run 隔离。
- 新合同已进入 `tests/run.js`；全量结果为 **145/145 个测试文件通过**。

### Packaged Electron E2E

[`W71_WINDOW_HANDOFF_RUNTIME.json`](./evidence/W71_WINDOW_HANDOFF_RUNTIME.json) 来自正式 `release/win-unpacked/Mazz Editor.exe`：

- 先制造目标已打开同文件的拒绝场景，源脏稿和目标干净稿均保持原样；
- 完成 **20 次主窗→分窗→主窗往返**，加初次迁出和最终迁回，共 **42 次成功交接**；
- 每一轮都核对完整文本、`dirty=true`、`pinned=true`、选择区 `{from:4,to:12}`；
- 最终仅保留当前 owner 的一份恢复快照；
- ResourceLedger 为 `2→3→2`。

前两轮 packaged 数据保护证据也在最终构建上复验通过：

- [`W71_MULTIWINDOW_FILE_CHANGE.json`](./evidence/W71_MULTIWINDOW_FILE_CHANGE.json)
- [`W71_EXTERNAL_FILE_CHANGE.json`](./evidence/W71_EXTERNAL_FILE_CHANGE.json)

## 3. 发布回归

最终 Windows specimen：

- installer：`141,020,301` bytes
- SHA-256：`166161C2D798309657D76B9D730FC75D92DAC7DFD991F970AC5BFEE256AF6171`
- `win-unpacked`：`597,438,656` bytes
- `app.asar`：`290,135,356` bytes，`9,479` entries
- packaged source map：`0`
- unpacked native binary：`10` 件，`2,625,024` bytes

[`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json) 继续通过隔离安装、同版本覆盖、五入口、UserChoice 不改写、20 轮正式运行、正常退出和 silent uninstall；卸载后可执行文件、Windows 集成与临时目录残留均归零。

## 4. 明确未关闭

本检查点只证明代表性 Markdown 编辑标签的迁移协议与状态保持，不外推为全部模块家族或全部多窗口能力已封板。以下仍为 OPEN：

- child renderer crash 后的工作台重建与用户可见恢复流程；
- Factory stream、Terminal、DAP、Agent 等运行时资源的跨窗口 owner / 迁移语义；
- Viewer、Browser、Sheet、Slide、Mindmap 等不同模块载荷的迁移矩阵；
- 睡眠/恢复、多显示器、DPI、RDP 下的拖移和交接；
- LAN Sync 三方冲突、合并与恢复对比。

因此本轮关闭的是“代表性编辑标签 20 次事务性交接 + 恢复快照 owner 隔离”子 Gate，不是 Wave 1、Multiwindow 或 W71 总 Gate。
