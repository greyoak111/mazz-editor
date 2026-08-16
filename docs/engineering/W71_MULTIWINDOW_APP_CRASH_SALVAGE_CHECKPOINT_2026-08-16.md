# W71 多窗口整应用异常退出数据保全检查点

> 日期：2026-08-16
> 起始坐标：`main@c2a6678`
> 范围：Wave 1 / Data Reliability 的多 renderer 事故批次与扁平恢复子门禁
> 结论：**PASS（限定范围）**

## 1. 本轮回答的问题

上一检查点已经证明单主窗、单份 Markdown 脏稿在整应用进程树被硬终止后可于下一轮恢复，但尚未回答：

1. 主窗与分窗同时有未保存内容时，事故 run 是否会收齐多个 renderer owner；
2. 每个 renderer 都从 `tab-1` 开始编号时，内部 tabId 碰撞是否会覆盖或误删另一窗口的快照；
3. 完整 Session 拓扑尚未实现时，系统是否至少能把所有可序列化内容安全降级恢复到主窗；
4. 一批恢复只完成部分记录时，未完成项能否继续留在 pending 清单中。

本轮没有修改产品运行时代码。它以新增 contract 和正式 packaged E2E 关闭 `c2a6678` 已实现但此前未实证的多 owner 数据保全路径。

## 2. Contract

[`tests/contract/w71-app-crash-recovery.test.mjs`](../../tests/contract/w71-app-crash-recovery.test.mjs) 新增多 owner / 同 tabId 用例：

- 同一事故 run 下 `owner:1/tab-1` 与 `owner:2/tab-1` 同时进入 offer；
- 更旧 run 即使 `savedAt` 更大也不会混入；
- 两条记录使用不同不透明 `recoveryId`；
- 只完成一条时，已消费文件删除，另一条精确写回 `RECOVERY_PENDING.flag`；
- 再次领取只得到剩余记录，明确忽略后 pending 清零。

该合同现为 **4/4**；全量仍为 **147/147 个测试文件通过**。

## 3. Packaged Electron E2E

[`W71_MULTIWINDOW_APP_CRASH_RECOVERY.json`](./evidence/W71_MULTIWINDOW_APP_CRASH_RECOVERY.json) 来自最终 `release/win-unpacked/Mazz Editor.exe`：

1. 主窗持有 `main.md`，分窗持有 `child.md`；两份都是不同内容、不同选择区的 `dirty=true / pinned=true` Markdown 脏稿。
2. 两个 renderer 的标签都真实编号为 `tab-1`；事故前快照为两个 owner、两个文件、同一个内部 tabId，ResourceLedger 为 `3`。
3. Windows 进程树经 `taskkill /T /F` 硬终止；下一轮主窗显示“检测到 2 份”并执行产品自己的“全部恢复”。
4. 两份全文、路径、脏态、固定态和 `{2,8}` / `{3,11}` 选择区全部恢复；新主窗为 `tab-1` 与 `tab-2`，没有覆盖。
5. 旧两个 owner 全部退役，恢复快照收敛为当前主窗一个 owner 下的两份记录；资源由事故前双窗 `3` 回到恢复后单窗 `2`。
6. pending 清零；正常退出后的第三次启动没有恢复 offer。

E2E 明确记录：

```text
fallback = flattened-into-main-window
topologyRestored = false
```

这不是把缺少拓扑恢复藏起来，而是把当前可承诺的降级行为钉死：**先保证内容不丢，再另行恢复布局。**

## 4. 发布与安装回归

最终 Windows specimen：

- installer：`141,036,294` bytes
- SHA-256：`E76FA573354667EDAB04BAD1CA05D7F76052D44DADCE328E1F9D0A9A74E5EC0B`
- `win-unpacked`：`597,451,128` bytes
- `app.asar`：`290,147,828` bytes，`9,479` entries
- packaged source map：`0`
- unpacked native binary：`10` 件，`2,625,024` bytes

schema v5 隔离安装、同版本覆盖、五入口、20 轮正式运行、UserChoice 全阶段不改写、正常退出和 silent uninstall 均 PASS；安装目录、卸载注册、快捷方式与 Windows 集成残留归零。

## 5. 明确未关闭

本检查点只关闭“多窗口事故中的可序列化 Markdown 数据不丢，并可安全扁平恢复到主窗”：

- 原主窗/分窗数量、窗口位置、大小、显示器归属没有恢复；
- 原窗格树、标签顺序、活动标签、焦点、跨窗父子关系没有恢复；
- Viewer、Browser、Sheet、Slide、Mindmap 等模块的多 owner 序列化仍未验证；
- Factory stream、Terminal、DAP、Agent 等运行时对象仍须定义 restart / cancel / owner 语义，不能靠内容快照伪复活；
- 用户界面仍只有整批“全部恢复 / 忽略”，没有逐项预览、部分恢复和磁盘版本比较；
- debounce 落盘前窗口、磁盘满/权限失败、DPI/RDP/多显示器、睡眠恢复与 LAN Sync 三方冲突仍 OPEN。

因此本轮不是完整 Session Restore，也不关闭 Wave 1 或 Multiwindow 总 Gate。它为后续拓扑恢复建立了一条不可退让的数据底线：即使结构暂时只能降级，事故 run 内每个 renderer owner 的已落盘内容也必须可找回。
