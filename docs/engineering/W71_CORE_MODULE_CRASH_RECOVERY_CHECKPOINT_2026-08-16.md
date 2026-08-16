# W71 可序列化核心模块整应用异常恢复检查点

> 日期：2026-08-16  
> 范围：W71 Wave 1 / Data Reliability / Whole-app crash recovery  
> 结论：**PASS（代表性 Hard Gate）**  
> 边界：本检查点证明内容本体保全，不声称完整 Session 拓扑或全模块全组合已经恢复。

## 1. 为什么做这一轮

此前已经证明 Markdown 脏稿能在单主窗、child renderer 连续崩溃及主窗/分窗双 owner 的整应用硬终止后恢复。但 Markdown 单一样本不能代表表格、演示、导图和画板等结构化编辑器。

本轮按“推荐封板”而非“完整主义一次追满”执行：选取六种正式、内容本体可序列化且数据形态互异的编辑器，形成足以支撑 RC 判断的代表性矩阵。

| 模块 | 恢复投影 |
|---|---|
| Text | 多行 Unicode 原文 |
| Code | Monaco 文本模型内容 |
| Sheet | 工作表名、单元格文本/数值/公式、冻结行 |
| Slide | v2 文档名、帧到页引用、标题物料、演讲者备注 |
| Mindmap | v4 布局、根/子节点、多父关系、sourceRef |
| Draw | 帧、图层、透明度、笔画、颜色与坐标 |

Markdown 不重复计入本轮六种，因为此前三个事故恢复检查点已经覆盖；这使新增证据关注真正不同的数据模型。

## 2. 真机路径

门禁使用当前正式 Windows `release/win-unpacked/Mazz Editor.exe`，不是浏览器预览或纯 Node 模拟：

1. 在干净 userData 与临时工作区启动 packaged app；
2. 同一主窗口创建六种编辑标签并注入带辨识度的结构化内容；
3. 将六个标签全部置为 dirty + pinned，并由产品 `snapshotPayload` 写入真实快照目录；
4. 使用 Windows `taskkill /T /F` 强制终止完整应用进程树；
5. 使用同一 userData 再次启动，确认 UI 提供 6 份事故恢复材料；
6. 点击“全部恢复”，按各自领域字段而不是字符串格式比较内容；
7. 核对新旧 owner、pending 标记和快照数量；
8. 显式清理测试生成的当前未保存快照，再正常退出并第三次启动，确认旧事故批次不诈尸。

第 8 步的语义必须说清：恢复后的标签仍是当前合法未保存稿；如果不显式放弃它们，正常退出后再次提示属于正确的数据保护，不是误报。门禁不得为了“第三轮无提示”而削弱未保存稿保全。

## 3. 结果

- 恢复提示：`6 份`；
- 覆盖：`text / code / sheet / slide / mindmap / draw`；
- 六种内容投影全部守恒；
- 六个标签 dirty、pinned 全部守恒；
- 事故前单 owner 全部退役，恢复后六份快照收敛到当前主窗口单 owner；
- `RECOVERY_PENDING.flag` 在完成恢复后清除；
- 显式放弃本轮当前未保存快照后，正常退出与第三次启动不再提供旧事故材料；
- 全量测试：`148/148` 文件通过。

机器证据：[`W71_CORE_MODULE_CRASH_RECOVERY.json`](./evidence/W71_CORE_MODULE_CRASH_RECOVERY.json)  
执行门禁：[`w71-core-module-crash-recovery.mjs`](../../tests/e2e/w71-core-module-crash-recovery.mjs)  
合同门禁：[`w71-core-module-recovery.test.mjs`](../../tests/contract/w71-core-module-recovery.test.mjs)

## 4. 本轮关闭与仍然开放

关闭：

- Markdown 之外六类正式可序列化编辑器的代表性 whole-app crash 内容保全子 Gate；
- 恢复过程中的 module identity、dirty、pinned 与 owner 收敛；
- 事故恢复批次和恢复后“当前未保存稿”的语义区分。

仍然开放并继续按 W71 推荐顺序施工：

- Notes / Library / Viewer 的路径、资产与运行态恢复；
- 损坏文件、大文件、不支持格式、转换失败与写盘失败语料；
- Factory / Terminal / DAP / Agent 等运行时对象的 restart / cancel / owner 处理；
- LAN Sync 三方冲突与合并；
- 跨版本升级/失败升级/回滚及 userData 迁移；
- 异机 native ABI、真实媒体权限、DPI/RDP/睡眠恢复等平台矩阵。

## 5. 完整主义远期保留

以下能力有明确价值，但不作为当前 RC Hard Gate，也不得从规划表消失：

1. 原窗口数量、窗口位置、显示器、窗格树、标签顺序、活动焦点的完整 Session 拓扑恢复；
2. 所有模块 × 所有跨窗/分屏/崩溃时点的穷举组合矩阵；
3. Notes / Library / Viewer 及所有运行时对象的统一可恢复协议；
4. 广泛设备、DPI、RDP、GPU、休眠、权限和异机系统组合矩阵。

它们进入 Post-W71 完整主义扩展队列；若后续证据证明其中某项是正式 RC 的 P0/P1 阻塞，再按缺陷升级回 W71，而不是预先把整套远期架构塞进本轮。

