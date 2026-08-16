# W71 外部文件变化与脏稿保护检查点（2026-08-16）

> 起始坐标：`main@e573b21`
> 范围：W71 Wave 1 / Data Reliability Contract 的本地文件外部变化子门禁
> 结论：**PASS（子门禁）**
> 边界：不代表完整 Data Reliability、Office 全格式往返、跨设备冲突或完整 Wave 1 已通过

## 1. 本轮关闭的问题

Shell 原先同时登记两条 `file:changed` 处理链：一条自动重载，另一条再次提示重载。结果是同一磁盘事件可能发生两次互相矛盾的决策；更严重的是，外部变化若撞上本地未保存内容，缺少一处能够证明“脏稿绝不静默覆盖”的统一边界。

本轮把索引刷新、外部转换回传、删除治理、干净重载、脏稿冲突和应用自写回声收束到同一个决策入口。当前状态机为：

| 输入 | 唯一结果 |
|---|---|
| `unlink / unlinkDir` | 更新索引并关闭幽灵标签 |
| 应用自身保存且文件指纹匹配 | 吞掉 watcher 回声，不重读、不弹冲突 |
| 外部修改 + 干净标签 | 每标签防抖后只重载一次 |
| 外部修改 + 脏标签 | 保留当前内容，提供“保留当前 / 另存当前… / 从磁盘载入” |
| 外部转换临时件 | 只进入专用回传链，不再继续普通重载 |
| 其他 watcher 事件 | 忽略 |

## 2. 根因与修复

1. **重复 listener**：两条 Shell 监听器各自拥有不完整策略。现只保留一条 `file:changed` 入口。
2. **监听就绪竞态**：`fs:watch` 过去在 chokidar 真正 `ready` 前就向 renderer 返回，首个外改可能丢失。现在 IPC 等待真实 `ready`；关闭发生在 ready 前时立即结算 promise 并清除兜底 timer。
3. **浏览器 timer 绑定错误**：将原生 `setTimeout` 作为裸函数保存后，在 Chromium 中会触发 `Illegal invocation`。当前通过 `globalThis` 包装调用。
4. **Save As 非事务状态**：旧逻辑在写盘成功前就改标签路径，失败后会留下指向不存在目标的标签。现在只在写入成功后更新路径、标题、模块状态和快照。
5. **错误窗格归属**：dirty/title 过去默认写当前窗格。本轮按 tab owner 找到真实 `Tabs` 实例，分屏标签不再误写另一窗格状态。
6. **快照陈旧**：磁盘显式重载后重新登记 snapshot provider，恢复材料与当前路径、内容保持一致。

实现的公共决策件为 [`external-change-service.js`](../../renderer/core/external-change-service.js)，Shell 只负责把产品状态映射到该协议。

## 3. Packaged 实证

正式 `win-unpacked` 中使用真实 chokidar、真实 IPC 和真实 Markdown 标签完成：

| 场景 | 结果 |
|---|---|
| 干净标签外部改写 | `reloadCalls=1`，标签保持 clean |
| 脏标签外部改写 | 本地内容完整保留，重载次数仍为 1，三项动作均出现 |
| 用户明确“从磁盘载入” | 内容切换到外部版本，dirty 清零 |
| 应用自身保存 | 磁盘与界面一致，无二次 reload，无伪冲突 toast |
| 关签收尸 | ResourceLedger `2→2` |

机器可读证据：[`W71_EXTERNAL_FILE_CHANGE.json`](./evidence/W71_EXTERNAL_FILE_CHANGE.json)。

## 4. 回归与发布样本

- 外部变化 contract：`5/5`
- W71 生命周期/安全 contract：`10/10`
- 全量测试：`144/144` 个测试文件通过
- packaged 外部变化 E2E：PASS
- NSIS schema v5：真安装、同版本覆盖、五入口、20 轮生命周期、正常退出、卸载归零均 PASS
- installer：`141,039,701` bytes
- installer SHA-256：`BCCBCCDD3C269138AA5FEC4765046A3839172EAEB1181283E7EF89C1665D4004`
- `app.asar`：`290,129,500` bytes，source map / PDB / test directory 为 0
- `win-unpacked`：`597,432,800` bytes

发布物证据：[`W71_RELEASE_BASELINE.json`](./evidence/W71_RELEASE_BASELINE.json) 与 [`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json)。

## 5. 仍保持 OPEN

- DOCX/XLSX/PPTX 声明支持子集、损坏文件、失败转换和大文件的系统化语料矩阵；
- 同一文件在多个独立应用窗口中的并发编辑提示与验证；
- LAN Sync / 多设备同时修改、真正三方合并与冲突副本策略；
- rename 与外部目录级移动的完整多窗、恢复和快照矩阵；
- 崩溃后恢复材料与磁盘新版本并存时的产品化对比界面。

因此本检查点只关闭施工规格 5.2 中“单一 `file:changed` 协议、脏稿不被覆盖、自写回声不重复通知”的本地单机主路径，不将整个 Data Reliability Gate 冒充结案。
