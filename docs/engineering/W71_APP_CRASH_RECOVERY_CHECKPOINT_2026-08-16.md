# W71 整应用异常退出恢复检查点

> 日期：2026-08-16
> 起始坐标：`main@25e3b22`
> 范围：Wave 1 / Data Reliability 的代表性 Markdown 整应用异常退出恢复子门禁
> 结论：**PASS（限定范围）**

## 1. 根因与本轮关闭的风险

旧链已经用 `RUNNING.flag` 识别上次异常退出，也能显示恢复提示，但恢复材料仍有三项所有权缺口：

1. `snapshot:list` 会枚举整个目录，无法冻结“进程启动前的事故批次”；新一轮运行写入的快照可能与旧事故材料混在一起。
2. 标签恢复后由新 run / 新 renderer owner 写入新快照，旧 owner 文件却无法通过当前 owner 的 `snapshot:clear` 删除，恢复一次会留下旧/新两份。
3. 用户看到恢复条但没有作决定就正常退出时，`RUNNING.flag` 会按设计清除；下次启动只提示无路径草稿，带文件路径的事故材料可能从此不再出现。

本检查点完成：

- `RUNNING.flag` 记录 runId；主进程启动时只冻结该事故 run 的快照。旧时间戳格式也只退化选择 savedAt 最新的同 run owner 组，后续本轮新写快照与更早历史都不进入事故批次。
- 只有 `mazz-res://app/index.html` 主工作台可以领取和完成整应用恢复；child、Panel 与其他页面不能冒领。
- 恢复批次携带不透明 `recoveryId`；renderer 只回报真正恢复成功的记录，主进程按冻结映射精确删除旧文件，不接受任意路径。
- 新增 `RECOVERY_PENDING.flag` 并记录精确 recoveryId 清单：事故后尚未选择“恢复/忽略”时即使随后正常退出，下轮仍继续提供同一批材料。
- 全部成功恢复或明确忽略后清除 pending；无有效候选时也不会形成永久 pending。
- 恢复出的标签先按新 run owner 写快照，再删除已消费旧件，最终目录只保留当前 owner 的一份材料。

## 2. 可重复证据

### Contract

新增 [`tests/contract/w71-app-crash-recovery.test.mjs`](../../tests/contract/w71-app-crash-recovery.test.mjs)，覆盖：

- 启动前事故批次与本轮新快照隔离；
- 恢复后只删已消费旧件；
- 未决恢复跨一次正常退出继续存在；
- child / 非工作台页面不能消费或完成批次；
- 明确忽略删除批次并清除 pending。

全量结果为 **147/147 个测试文件通过**。

### Packaged Electron E2E

[`W71_APP_CRASH_RECOVERY.json`](./evidence/W71_APP_CRASH_RECOVERY.json) 来自正式 `release/win-unpacked/Mazz Editor.exe`：

1. 第一轮启动创建 `dirty=true`、`pinned=true`、选择区 `{from:5,to:14}` 的 Markdown 脏稿并强制落快照。
2. 用 Windows 进程树强制终止真实主进程，确认 `RUNNING.flag` 保留；没有调用 Electron 正常退出钩子伪造事故。
3. 第二轮以同一 userData 启动，界面真实显示“检测到 1 份未正常关闭的快照”；点击“全部恢复”后完整文本、路径、脏态、固定态与选择区均恢复。
4. 旧 run owner 被新 run owner 替换，快照数量由 1 收敛到 1，`RECOVERY_PENDING.flag` 清除。
5. 第二轮正常退出后第三次启动，不再出现恢复提示或恢复 offer。

## 3. Windows 安装门禁校正

最终安装矩阵前两次在运行中 `.md` 的通用 Windows `FileProtocolHandler` 分发处稳定超时，而协议分发、五入口冷启动、注册表命令和卸载均正常。根因是旧 packaged smoke 把“公共扩展处理器已经注册”错误外推成“公共扩展已经成为系统默认”；这与现有 UserChoice 门禁明确禁止安装器伪造默认应用相冲突。

门禁现与既有产品承诺对齐：

- `mazz://home` 继续由 Windows Shell 真分发；
- `.md` 运行中二实例分发使用已经核对过 ProgID 命令的 installed EXE；
- `.mazz` 自有扩展仍由 Windows Shell 冷启动验证；
- `.md/.markdown/.txt` 的系统默认与 Explorer“打开方式/始终使用”仍明确 OPEN，不再靠偶发 Shell 缓存报假绿。

校正后 schema v5 真安装、同版本覆盖、五入口、20 轮正式运行、正常退出和 silent uninstall PASS；UserChoice 五阶段不改写，安装与系统集成残留归零。

## 4. 发布回归

最终 Windows specimen：

- installer：`141,036,293` bytes
- SHA-256：`476935D578D2F0B1E8416EAA74C560F5C3E59CE675DCC5548A4DA9B60F2F2830`
- `win-unpacked`：`597,451,128` bytes
- `app.asar`：`290,147,828` bytes，`9,479` entries
- packaged source map：`0`
- unpacked native binary：`10` 件，`2,625,024` bytes

## 5. 明确未关闭

本检查点只证明单主窗、单份代表性 Markdown 标签的整应用异常退出恢复，不外推为完整 Session Restore：

- 异常退出前的多窗口 / 多窗格拓扑、焦点和窗口位置没有恢复；
- Viewer、Browser、Sheet、Slide、Mindmap 等模块的序列化与真实语料仍未验证；
- Factory stream、Terminal、DAP、Agent 等运行时对象不能由内容快照复活，其 restart / cancel / owner 语义仍 OPEN；
- 快照 debounce 落盘前的极短窗口仍只能恢复最近一次已落盘状态；
- 多份冲突快照的逐项预览、磁盘新版本对比与部分恢复 UX 仍未实现；
- 睡眠/恢复、多显示器、DPI、RDP、磁盘满/权限失败及 LAN Sync 三方冲突仍 OPEN。

因此本轮关闭的是“代表性 Markdown 主窗硬终止 → 下次启动显式恢复 → 旧/新 owner 收敛 → 正常退出不误报”子 Gate，不是完整 Session Restore、Wave 1 或 W71 总 Gate。
