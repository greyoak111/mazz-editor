# W71 推荐封板 RC 收口账本

> 日期：2026-08-16
>
> 决策：**按推荐封板继续；完整主义扩展保留但后移**
>
> 当前基线：`main@9c3811f`，全量 `150/150`，当前 schema v5 安装回归 PASS
>
> 作用：把“必须挡住首个可信 RC”的问题，与“需要外部条件”“某入口启用前再做”“长期完整主义”分开，避免历史欠账被遗忘，也避免它们无限阻塞新增内容。

## 1. 四种账目

| 类别 | 是否阻塞推荐封板 | 处理纪律 |
|---|---:|---|
| `RC BLOCKER` | 是 | 当前机器可验证且关系到正式入口、数据、生命周期、许可或发布正确性；必须修复、降级或隐藏。 |
| `CONDITIONAL GATE` | 不阻塞内部 unsigned RC；阻塞对应发布承诺 | 需要证书、异机、真实硬件、第三方账号或用户主动系统选择；条件具备后补证，当前必须写入 Known Limitations。 |
| `ACTIVATION GATE` | 不阻塞 RC | 代码/基础设施可以保留，但入口在自身 Gate 通过前只能 Preview/Experimental 或 Hidden。 |
| `POST-W71 COMPLETENESS` | 否 | 完整主义扩展；进入完整未尽波次总表，后续另行施工，不反向扩大 W71。 |

## 2. 当前已关闭的主阻塞

- 代表性正式主链生命周期：PTY、Panel、WebContentsView、watcher、P2P、Python、Viewer、Factory request、Monaco 均完成 packaged 20 轮并回到资源基线；
- 外改/脏稿/Save As、事务性交接、child renderer crash 与 whole-app hard kill 的代表性数据保全；
- Text、Code、Sheet、Slide、Mindmap、Draw 六类结构内容恢复；
- 9 类损坏/不支持输入拒绝、UTF-16 LE 无损读取、转换与写盘失败不伪成功；
- source map/PDB/test 发布泄漏归零，FFmpeg 五份分发说明材料入包；
- 本机 clean install、同版本 reinstall、五入口、UserChoice 不改写、20 轮安装态运行、正常退出、卸载与残留检查；
- 当前树全量 `150/150`。

当前 specimen：installer `141,035,270` bytes，SHA-256 `262D17B5D77CCA65C27110B3CF51CCE4C1736686CC72DF69A4D66F9250D1B030`；win-unpacked `597,463,879` bytes；app.asar `290,160,579` bytes；packaged source map `0`；unpacked native `10` files / `2,625,024` bytes。

## 3. 推荐封板还剩四个宏观波次

这里的“轮”是可独立验收的宏观波次，不等于一次提交。按当前证据，距进入 W71 后新增内容的推荐估计为：

> **常态 4 轮；最顺利可压成 3 轮；若发现新的 P0/P1，最多按 5 轮预算。**

### C1 — 正式入口与低水位模块定级

目标：每个入口只处于 Formal、Preview/Experimental、Hidden 之一，并在真实 UI、帮助与命令入口保持一致。

- Mobile、Updater、W62e：Hidden；
- W65：只允许已实现的 DMHY 族能力以 Preview 呈现，不得声称“四站完成”；
- W66：Harness Foundation 作为内部基础保留；Vendor Adapter 和通用 Agent UI 在双真实 Adapter Gate 前 Hidden/Experimental；
- Recorder、Plugins：Preview；
- OCR、Archive：以真实错误/取消/损坏样本决定 Formal 或 Preview，不为维护表面分数硬扶正；
- 清除帮助、命令面板、设置页与正式入口之间的状态冲突。

退出条件：自动入口清单与 packaged UI 逐项一致；不存在“看似正式、实际未闭环”的按钮。

### C2 — 正式主路径产品完整性

目标：只处理已经对外承诺的主路径，不展开全模块组合。

- Library icon create/open/back/reopen/restore 单源化；
- Dark/Light、focus、disabled、loading/empty/error、窄窗/常规 DPI 的代表性运行态 Gate；
- Notes/Library/Viewer 的正式数据路径与 owner/dispose 做代表性验证；
- 对发现的真实 P0/P1 修根因；不以全仓像素统一或万能 UI 框架代替验收。

退出条件：正式入口的代表尺寸和主题无不可达控件、失真状态或已知数据风险；所有发现均有 SEAL/FIX/PREVIEW/HIDDEN 结论。

### C3 — 发布与许可封口

目标：关闭当前机器可完成的发布正确性。

- 用历史可复现 specimen 验证真实跨版本 upgrade、失败保持与用户数据策略；若缺合法旧 specimen，则把不支持升级写成显式产品边界；
- FFmpeg 在“恢复 exact corresponding-source / 换成可闭环来源 / 对相关能力降级”三者中作可发布选择；
- 再跑 secret、LICENSE/NOTICE/third-party、asar/unpacked/native 清单；
- 代码签名保持条件 Gate：没有证书时只能形成明确标注的 unsigned RC，不伪称公开签名发行版。

退出条件：许可没有含糊承诺；安装、升级策略、卸载和用户数据边界可测试。

### C4 — RC 汇总与三次独立复跑

目标：冻结首个可信 Windows RC，而不是继续加入新能力。

- 三次独立 packaged/release manifest；
- 全量测试、正式入口、数据、生命周期、安装/升级策略、许可与 Known Limitations 汇总；
- 已知 P0/P1 = 0；失败不得伪成功；应用退出无产品子进程残留；
- 固定版本、hash、证据路径、回滚点和维护者可复跑命令；
- 输出最终 SEAL/PREVIEW/HIDDEN/DEFER 模块矩阵。

退出条件：满足推荐封板 DoD 后停止 W71，再由维护者从完整未尽波次总表选择新增内容。

## 4. 当前 RC BLOCKER

| 阻塞 | 为什么仍挡 RC | 推荐处理 |
|---|---|---|
| 入口状态尚未完成运行态总核对 | 文档分级存在，但帮助/命令/设置/模块入口可能仍露出过度承诺 | C1 建自动清单并以 packaged UI 对齐 |
| OCR / Archive 的正式水位未判定 | 两者仍可能在失败、取消、损坏输入上低于正式承诺 | 有限样本补证；不足即 Preview |
| UI Integrity 仍缺代表性运行态收口 | 静态 Census 不是产品验收，Library 多真源图标仍有已知 P1 | C2 只验正式主路径和代表尺寸/主题 |
| Notes/Library/Viewer 的代表性数据/恢复边界未封 | 六类核心编辑稿已证实，但这三条正式路径仍没有同等级结论 | C2 补代表性 Gate；全组合后移 |
| 跨版本策略未实证 | 同版本 reinstall 不能替代 upgrade/失败保持/用户数据策略 | C3 真升级；做不到则明确不支持并阻断自动升级入口 |
| FFmpeg exact corresponding-source 未闭环 | 当前包能运行且许可材料入包，但 GPL 分发责任不能靠“不知道原 commit”结案 | C3 恢复来源、替换可闭环构建或降级相关正式能力 |
| 最终 RC 独立复跑未完成 | 当前证据跨多个中间 specimen，尚缺冻结 hash 的统一结论 | C4 三次独立复跑与总报告 |

## 5. CONDITIONAL GATE

这些项目不从总表删除，但在缺少外部条件时不继续把维护者当作人肉状态机：

| 条件项 | 当前处置 |
|---|---|
| 代码签名 / SmartScreen | 当前无证书，构建明确跳过签名；unsigned RC 可内部封板，公开签名发行必须补证。 |
| 异机 clean install / native ABI | 当前主机已通过；其它 Windows 版本/CPU/干净机作为发布渠道扩大前的条件 Gate。 |
| 摄像头、麦克风、屏幕采集、权限拒绝、RDP | Recorder 保持 Preview，因此硬件矩阵不阻塞 Formal 主链。 |
| 第三方 Provider TLS/代理/限流/非标准 SSE | 产品自有故障层已通过；真实账号 smoke 只做 opt-in，不把公网波动设为日常 Hard Gate。 |
| Explorer“始终使用”、UserChoice 后分发、多用户 | Mazz 不篡改 UserChoice 已实证；用户主动选择和多用户环境有条件时补证。 |
| 多显示器、广泛 DPI/GPU/休眠 | 代表性本机 Gate 属 C2；全交叉矩阵进入条件/完整主义账。 |

## 6. ACTIVATION GATE

| 能力 | 首个 RC 分类 | 日后启用条件 |
|---|---|---|
| Mobile | Hidden | 可交付 native 工程、权限与同步矩阵 |
| Updater | Hidden | 严格 TLS、签名/hash、下载/安装/失败回滚全链 |
| W62e Feed | Hidden | 完整管线与来源/失败/限速边界 |
| W65 四站 | DMHY-only Preview | 其余站点依法、限速、可重复完成 |
| W66 Agent | Foundation internal；Adapter/UI Hidden/Experimental | 至少两个真实 Adapter 共用契约并通过 detect/probe/auth/session/interrupt/dispose |
| Recorder | Preview | 真实设备、权限、系统音、最小化、长录制和失败清理 |
| Plugins | Preview | permissions enforcement、隔离/信任与发布者链达到正式水位 |

## 7. POST-W71 COMPLETENESS

以下价值完整保留，并继续由《Mazz 当前未落地全景 · W71 归并版》承载，但不再作为推荐封板倒计时：

- 所有格式 × 编码 × 磁盘 × 权限 × 外改 × 多窗 × crash 的穷举矩阵；
- 原窗口/窗格/焦点/顺序完整 Session 拓扑与全模块恢复；
- 全模块跨窗运行时 owner、LAN Sync 三方合并、4–8 小时以上 soak；
- 全 DPI/RDP/多显示器/GPU/设备/Windows 版本交叉积；
- SurfaceManager、Universal Asset Loader、完整 W67、完整 Harness policy；
- W63/W64/W65 完整版/W69/W70/W72–W86 与研究储备中的 Runtime/Replica/Event/Episode/多父/World/Organization/`.maz` 等新增能力。

它们只有在证据显示为当前正式主链 P0/P1 时，才以具体缺陷升级回 W71；不能以“未来可能需要”整体回流。

## 8. 到新增内容的判定

不是“所有历史欠账清零”后才允许新内容，而是：

```text
C1 入口诚实
+ C2 正式主路径可用
+ C3 发布/许可可说明
+ C4 冻结 specimen 三次独立通过
= 推荐封板完成
```

达到这个停止线后，完整主义仍在总表中，但排到更远期。下一新增波次必须重新从总表按依赖和价值选择；不得把本账本自动解释为 W65、W63、W64 或 W72–W86 的开工授权。
