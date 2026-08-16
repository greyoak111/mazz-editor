# W71 C2 正式主路径产品完整性检查点

> 日期：2026-08-16
>
> 结论：**PASS / C2 COMPLETE**
>
> 范围：Library、Notes、Viewer 的代表性正式路径，以及正式 UI 的图标、主题、焦点、禁用态、空态、错误态和窄窗口可达性
>
> 非范围：全仓像素统一、全模块图标迁移、全 DPI/GPU/多显示器矩阵、Post-W71 新能力

## 1. 本轮关闭了什么

### 1.1 稳定图标身份与 Library 单源链

新增 `renderer/core/icon-registry.js`，模块业务状态只保存稳定 `iconId`，由注册表解析为使用 `currentColor` 的 SVG。Shell 页签、恢复快照和跨窗交接均携带 `iconId`；标题变化不再夹带或重写图标。

真实 packaged 路径已证明：

```text
创建书库标签
→ 打开样书并改标题
→ 返回书架
→ 关闭
→ 从保存状态恢复
```

全程保持：

```text
iconId = module.library
DOM iconId = module.library
SVG 字节一致
```

这关闭 Library/Shell 的已知 P1 多真源问题。全仓工具条、菜单和内容区的图标统一仍是 Post-W71 完整主义工作，不回流扩大 C2。

### 1.2 Notes 保存与恢复正确性

packaged E2E 在施工中抓出两项真实竞态：

1. 启动时异步打开“今日笔记”可能覆盖显式恢复或用户刚选择的笔记；
2. 保存已发起但尚未落盘时，标签 dirty 会暂时为 false，关闭/交接可能越过仍在进行的磁盘写入。

当前由 open generation 隔离过时结果，由唯一 `_savePromise` 持有进行中的写入；关闭、交接和通用保存命令都会等待同一个屏障。写入期间再次编辑会继续下一轮保存，失败则恢复 dirty，不伪装完成。

### 1.3 owner / dispose

Library、Notes、内嵌 Markdown、Notes Graph 与 Viewer 的代表性 owner 已补齐销毁路径：

- 下载/selection/window listener 可撤销；
- timer、ResizeObserver、Blob URL、frame、编辑器和图谱对象可释放；
- 异步打开结果在 owner 销毁或 generation 过期后不能复活界面；
- Library 20 次创建/关闭后，实例、下载 listener、selection listener 均回到零；
- packaged 关签后 Library、Notes、Viewer owner 均为 `0`。

### 1.4 正式 UI 运行态

正式 `win-unpacked` 在真实 Chromium computed style 中通过：

| Gate | 结果 |
|---|---|
| Paper / Ink 主题 | 背景、前景与 SVG `currentColor` 随主题切换 |
| 键盘焦点 | `solid 1.6px` accent outline 可见 |
| Disabled | opacity `0.38`，且不能误作可操作控件 |
| Library empty | 明示“导入书籍 / 导入漫画文件夹”恢复动作 |
| Viewer unsupported | 明示“暂不支持预览此格式” |
| 1024×720 窄窗口 | reader toolbar 横向可滚；返回键与末端控件均可达 |

这里验证的是代表性正式路径，不把静态 Census 数量下降冒充产品质量。

## 2. 自动证据

| 层级 | 结果 |
|---|---:|
| C2 contract | `5/5` |
| Notes UI contract | `4/4` |
| Window handoff contract | `3/3` |
| 全量测试文件 | `152/152` |
| Packaged C2 E2E | `PASS` |
| Renderer error | `0` |

机器证据：

- [`W71_FORMAL_MAIN_PATHS.json`](./evidence/W71_FORMAL_MAIN_PATHS.json)
- [`W71_FORMAL_LIBRARY_BOOK.png`](./evidence/W71_FORMAL_LIBRARY_BOOK.png)
- [`W71_FORMAL_LIBRARY_NARROW_INK.png`](./evidence/W71_FORMAL_LIBRARY_NARROW_INK.png)

## 3. 边界与后续

C2 只关闭首个推荐 RC 所需的代表性正式主路径。以下不删除、不伪装完成，但后移：

- 全模块 emoji/control 图标清零与统一 Icon System；
- 所有模块 × 所有主题 × 所有尺寸 × 全 DPI 的穷举视觉矩阵；
- 原窗口/窗格/焦点/顺序的完整 Session 拓扑恢复；
- 其他模块与运行时对象的全组合迁移、崩溃恢复与长时间 soak；
- W63–W86、Runtime/Replica/Event/Episode/多父/World/Organization/`.maz` 等完整主义扩展。

这些内容继续由《Mazz 当前未落地全景-W71归并版》承载。只有发现成为当前正式主链 P0/P1 的具体证据时，单项才可回流 W71。

## 4. 下一停止线

推荐封板现只剩：

```text
C3 发布与许可封口
+ C4 冻结 specimen 三次独立复跑
= 首个可信 Windows RC
```

C3 不新增功能；先处理跨版本策略、FFmpeg corresponding-source 选择、许可/secret/发布物清单和 unsigned RC 边界。
