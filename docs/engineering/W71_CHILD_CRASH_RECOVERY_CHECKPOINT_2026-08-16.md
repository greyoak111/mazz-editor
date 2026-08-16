# W71 分窗 Renderer 崩溃恢复检查点

> 日期：2026-08-16
> 起始坐标：`main@7f722e0`
> 范围：Wave 1 / Lifecycle + Data Reliability 的代表性 Markdown 分窗崩溃恢复子门禁
> 结论：**PASS（限定范围）**

## 1. 根因与本轮关闭的风险

分窗的 BrowserWindow 在 renderer 崩溃后虽然会自动重载，但旧恢复链只在“上一次整应用未干净退出”时读取全局快照。结果是：同一次应用运行中的 child renderer 崩溃会重建空壳，已经落盘的脏稿快照无人消费；而 `windowRole` 只靠首次 IPC 投递，重载后又可能退回主窗语义。旧快照还缺少 `dirty`、`pinned` 与选择区/阅读进度，恢复时无法完整还原用户状态。

本检查点完成：

1. 主进程只对 URL 明确标记 `role=child` 的完整工作台 renderer 记录 crash token；正常关闭和 `killed` 不触发恢复。
2. 分窗重载后按当前 WebContents owner 一次性领取自己的恢复包，其他窗口和普通启动不能误消费。
3. `windowRole` 在 renderer 启动最早期由 URL 同步建立，不再依赖可能因崩溃丢失的首次消息。
4. 快照补齐标题、内容、路径、模块、`dirty`、`pinned` 与进度；事务性交接成功后即使标签是干净态也建立 owner 快照。
5. 恢复通过既有 `receiveHandoff` 状态入口重建标签，标题至多保留一个“（已恢复）”后缀；恢复成功后只裁剪当前 owner 已被替换的旧 tabId。
6. 主窗原有整应用未干净退出 / 未保存恢复语义保持兼容；普通分窗启动不会弹出或吞掉全局恢复材料。

这是 owner-scoped 的 child shell 崩溃恢复补丁，不是通用 SurfaceManager、Event Bus 或全模块状态迁移框架。

## 2. 可重复证据

### Contract

- 新增 [`tests/contract/w71-child-crash-recovery.test.mjs`](../../tests/contract/w71-child-crash-recovery.test.mjs)，覆盖 child-only crash 标记、owner-scoped 一次性领取、正常退出排除、角色重建、状态字段与 owner 裁剪。
- 新合同已进入 `tests/run.js`；全量结果为 **146/146 个测试文件通过**。

### Packaged Electron E2E

[`W71_CHILD_CRASH_RECOVERY.json`](./evidence/W71_CHILD_CRASH_RECOVERY.json) 来自正式 `release/win-unpacked/Mazz Editor.exe`：

- 将一份 Markdown 以 `dirty=true`、`pinned=true`、选择区 `{from:3,to:10}` 迁入分窗；
- 连续 **5 次**调用 Chromium 的真实 renderer crash，均由产品自己的 BrowserWindow 重载链恢复；
- 每轮都核对完整文本、文件路径、脏态、固定态和选择区；
- 恢复标题始终为单一 `child-crash.md（已恢复）`，没有重复后缀；
- 每轮 owner 快照稳定为 1 份，最终标签仍可事务性交接回主窗；
- ResourceLedger 为 `2→3→2`。

最终构建还复验通过：

- 代表性标签 20 次往返、42 次事务性交接；
- 主窗/分窗同文件外改分流与双窗收敛；
- 单窗 clean reload、dirty conflict、自保存回声；
- schema v5 真安装、同版本覆盖、五入口、20 轮运行和卸载。

## 3. 发布回归

最终 Windows specimen：

- installer：`141,034,491` bytes
- SHA-256：`4C601AA91388EBA0A31C4B8FF6438B986827784B51D90607562BB28D273FC906`
- `win-unpacked`：`597,444,650` bytes
- `app.asar`：`290,141,350` bytes，`9,479` entries
- packaged source map：`0`
- unpacked native binary：`10` 件，`2,625,024` bytes

发布包内的 `main/crash-recovery.js` 已交叉核对包含 child crash token、owner-scoped consume 和 snapshot prune 逻辑。安装回归结束后，可执行文件、卸载注册、快捷方式、Windows 集成与隔离目录残留均归零。

## 4. 明确未关闭

本检查点只证明代表性 Markdown 分窗在 renderer crash 后可恢复，不外推为整应用或全部模块已完成崩溃恢复：

- Viewer、Browser、Sheet、Slide、Mindmap 等模块的状态序列化与崩溃恢复矩阵仍未验证；
- Factory stream、Terminal、DAP、Agent 等运行时对象不能仅靠标签快照复活，其跨窗口 owner / cancel / restart 语义仍 OPEN；
- 快照采用有界 debounce，崩溃发生在新状态落盘前时只能恢复最近一次已落盘状态；
- 整应用异常退出后的多窗口拓扑、恢复选择 UX 与多份冲突快照仍未新增 packaged 证据；
- 睡眠/恢复、多显示器、DPI、RDP，以及 LAN Sync 三方冲突与恢复对比仍 OPEN。

因此本轮只关闭“代表性 Markdown child renderer 连续 5 次崩溃恢复 + owner 隔离 + 状态保持”子 Gate，不代表 Wave 1、Multiwindow 或 W71 总 Gate 通过。
