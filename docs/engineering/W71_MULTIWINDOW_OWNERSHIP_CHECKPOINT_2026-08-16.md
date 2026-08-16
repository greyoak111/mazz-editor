# W71 多窗口文件与窗控所有权检查点（2026-08-16）

> 起始坐标：`main@aac0f4d`
> 范围：W71 Wave 1 / 多窗口 owner 与 Data Reliability 子门禁
> 结论：**PASS（同文件外改 + 基础窗控子门禁）**
> 边界：不代表完整多窗迁移、跨窗 Agent/Factory/Terminal、DPI/RDP 或完整 Wave 1 已通过

## 1. 发现的根因

### 1.1 文件变化只发主窗

`WindowManager.broadcast()` 的历史契约是“只发主窗”，但 FileWatcher、确定性删除通知和快速笔记写入都误把它当作“发全部工作台”。因此标签移到分窗后，分窗不会收到后续磁盘变化：它既不能自动同步干净稿，也不能在脏稿冲突时保护用户内容。

本轮保留原 `broadcast()` 语义，新增范围明确的 `broadcastShells()`，只向主窗与完整工作台分窗发送文件/工作区状态，不把 Panel、QuickNote 或任意命令扩成全局广播。

### 1.2 分窗窗控仍写主窗

最小化和最大化切换早已按 IPC sender 找宿主，但以下通道仍硬编码 `wm.main`：

```text
window:setTitle
window:isMaximized
window:isFullScreen
window:toggleFullScreen
```

结果是分窗改标题会改主窗，分窗查询/切换全屏会读取或控制主窗；全屏状态事件也只在主窗挂载。

当前四条通道统一经 `BrowserWindow.fromWebContents(event.sender)` 定位调用者，主窗和每个分窗各自登记 enter/leave-full-screen 事件。

## 2. Packaged 同场实证

正式 `win-unpacked` 同时打开主窗与分窗，并在两窗打开同一个 Markdown 文件：

| 场景 | 结果 |
|---|---|
| 主窗脏稿 + 分窗干净稿 + 磁盘外改 | 主窗保留“主窗本地脏稿”并出现三项决策；分窗自动得到“磁盘外部版本”且保持 clean |
| 主窗选择“从磁盘载入” | 两窗内容一致，主窗 dirty 清零 |
| 分窗设置原生标题 | 子窗=`W71 子窗所有权证明`；主窗仍为 `multiwindow.md — Mazz Editor` |
| 分窗切换全屏 | 主窗 `false`，子窗 `true`；退出后子窗查询回到 `false` |
| 分窗最大化与查询 | 主窗 `false`，子窗 `true`；还原后子窗查询回到 `false` |
| 关闭分窗 | ResourceLedger `2→3→2` |

机器证据：[`W71_MULTIWINDOW_FILE_CHANGE.json`](./evidence/W71_MULTIWINDOW_FILE_CHANGE.json)。

## 3. 回归与发布样本

- 外部变化/多窗 owner contract：`5/5`
- v45 窗控回归：`29/29`
- 全量测试：`144/144` 个测试文件通过
- 单窗外部变化 packaged E2E：PASS
- 主窗/分窗同文件与窗控 packaged E2E：PASS
- NSIS schema v5：真安装、同版本覆盖、五入口、20 轮生命周期、正常退出、卸载归零均 PASS
- installer：`141,038,151` bytes
- installer SHA-256：`F26C888453C3E0F4AAD404528AAF1718623ACC70F25420EA7D176FAB720135F6`
- `app.asar`：`290,130,028` bytes，source map / PDB / test directory 为 0
- `win-unpacked`：`597,433,328` bytes

## 4. 仍保持 OPEN

- 标签迁入/迁回/拖到已有分窗的 20 次内容、dirty、selection、snapshot 与资源循环；
- child renderer crash 后的标签和文件状态恢复；
- Factory stream、Terminal、DAP、Agent Session 等事件按真实 renderer owner 投递；
- 工作区切换、活动中心、LAN Sync 与进度事件的跨窗一致性；
- 多分窗、多显示器、100/150/200% DPI、全屏进出、休眠/RDP 的组合矩阵；
- LAN Sync 三方冲突、跨设备保存与真正合并策略。

本轮没有把 `broadcast()` 改造成 Universal Event Bus，也没有实施 SurfaceManager 或通用多窗状态数据库。只对已经证明必须共享的文件变化建立定向工作台广播，并把基础窗控恢复到 IPC 调用者所有权。
