# W87i UI Interaction Convergence / 交互态收敛检查点

> 日期：2026-08-21
> 状态：**CURRENT / PASS；W87a–i EXECUTED SCOPE RESEALED**
> 产品实现坐标：`main@831776b`
> 运行口径：Windows 10 / Electron 33.4.11；SOURCE + `release/win-unpacked`
> 自动化口径：Electron / Playwright E2E；**Computer Use 已禁用且全程未使用**

## 1. 结论

维护者提交的 16 张截图不是 16 个互不相关的 CSS 小洞，而是八类交互状态债：系统标题栏被通用图标运行时误伤、组件宽度真相缺失、页签重建丢失滚动意图、跨窗口拖拽缺少统一坐标原点、Panel 只继承颜色而不继承结构、窗口能力没有按用途分级、状态消息抢占内容角落，以及开发终端编码未在启动链闭环。

W87i 已把这些问题落到各自 owner，并在最终代码上完成 SOURCE / PACKAGED 双态复封。结论不是“肉眼看过几张图”，而是：

- `mazz.w87i-ui-state-convergence/v1`：SOURCE / PACKAGED 均 `PASS`；
- `mazz.w87i-pane-dock-continuity/v4`：SOURCE / PACKAGED 均 `PASS`；
- W87g Paper / Ink 可辨识度：每种运行态 `82/82` scope，失败 `0`；
- 全页面巡检：每种运行态 `110/110` scene，issue `0`、runtime error `0`；
- 全量回归：`228/228` 测试文件通过；
- `dist:dir`、`audit:release`、OSS provenance 均通过 / CURRENT。

W87i 不声称 Ribbon 内部永远为 `0 overflow`。完整 Markdown Ribbon 在 1920px 仍有少量剩余宽度，当前正式合同是：能力按 `full → compact → icon` 有序降级；文字不竖排、不挤压、不重叠；主文档不横溢；剩余能力通过**显式可横滚**的 Ribbon 自身访问。把这个合法残余写成“零溢出”会制造假绿。

## 2. 十六张截图逐项归并

| 图 | 可见问题 | 根因层 | 最终处置 | 运行门 |
|---:|---|---|---|---|
| 1 | 最小化 / 最大化 / 关闭像日历、缺口或歪斜图形 | Windows caption 被 W87h 通用 24px 图标映射接管 | 标题栏改用独立 12×12 caption primitive；46×36 命中区；线宽固定 1.15，居中误差 0 | state v1 校验三按钮几何、markup、computed stroke |
| 2 | 分屏后页签跑到窗格右侧 | 页签定位受窗格结构变化影响 | 页签带由自身伪间隔统一右靠，`pane-close` 不再拥有 auto margin | pane/dock v4 单窗与分屏 `rightGap=0` |
| 3 | 合并后同一页签又跳回左侧 | `Tabs.render()` 全删重建却不保存 `scrollLeft` / 活动签锚 | 删前采样、挂载后恢复；右缘意图与活动签可见成为显式状态 | 12 长签 split/join 往返后仍封右 |
| 4 | 智能创作执行台在子窗或窄窗溢出 | Factory 使用窗口宽度而非容器宽度判断 | 指令台改为 container-responsive 网格；执行器 / 模型列可收缩 | 300px dock command/harness overflow 均为 0 |
| 5 | 构成主义下指令台同款溢出、控件越界 | 主题改变视觉后暴露同一组件宽度债 | 同一容器合同覆盖 Paper / Ink / Construct 与自定义 Construct | state v1 + pane/dock v4 双态通过 |
| 6 | Markdown Ribbon 中文变竖排、标签互相挤压 | Ribbon 只看 viewport，且允许文字参与压缩 | 自身 ResizeObserver 驱动 `full/compact/icon`；label `nowrap/keep-all`；最终层自身横滚 | 1920→1440→1100→960→回程无 wrap/overlap、document overflow 0 |
| 7 | 书库提示气泡占左下内容和状态文字 | toast 使用页面左下绝对浮层 | 普通通知进入 statusbar 中央独立 slot；左右状态区各自占位，不重叠 | state v1 校验 exact center 与左右区无交叠 |
| 8 | 书库页签复现忽左忽右 | 真实模块标题变化触发页签全量 render | 使用真实 Library 页签做 active/rename/dirty 锚定；不只测伪标签 | pane/dock v4：Library active 可见，改名后 `activeLeft` 不变 |
| 9 | Construct 首页 hover 后图标与卡片同色，像消失 | hover 改背景却仍沿用 accent 前景 | hover/active 图标与文字统一切到 `--accent-fg` | SOURCE / PACKAGED Construct hover 截图与 computed gate |
| 10 | 同一卡片状态在不同操作后颜色不一致 | hover、focus、active 状态分散覆盖 | 收敛到同一语义前景 token，不为单一卡片加颜色补丁 | W87g 82 scopes × 2，失败 0 |
| 11 | 文档文字色 / 突出显示色块没有可信初始语义 | ColorPicker 未声明初值 | 文字色初值黑色；突出显示初值红色，并保留后续状态同步 | state v1 精确读取 swatch 黑 / 红 |
| 12 | 字体等固定内容子窗可任意拉伸，空白面积异常 | 所有 PanelWindow 共用同一 resizable 默认值 | Panel 按用途分 `fixed` / `workbench`；fixed 同时锁 min/max/resize/maximize/fullscreen | state v1 真实读取 22 类 BrowserWindow native policy |
| 13 | Agreement / Help 层级不一致，Help 图标和主题色过强 | Help 被当成强调动作而非并列文字入口 | Help 去 SVG 和 accent，改为 Agreement 的中性文字同级 | state v1 比较两入口结构、颜色与字体 |
| 14 | 智能创作子窗被统一圆角包围；构成主题语法失真 | Panel 只收到色值，没收到结构 token；共享 CSS blanket rounding | 主题快照增加 `soft/hard-edge` 结构；Construct 和自定义 Construct 传播到已打开 Panel；只对矩形语义控件去圆角，保留圆形 / pill | 22 Panel `pwinRadius=0`、rounded offender 0；Paper 恢复 soft |
| 15 | 浮动态工具坞内容落后、草稿或焦点易丢 | 浮窗复制展示但没有完整 snapshot/owner 协议；冷启动工具清单把空数组当终态 | Factory 快照携带 command desk；重绘保存 draft/selection/focus/adapter/model；owner ready 有界重试并主动补推 | v4：二次拖拽、草稿焦点保留、冷启动 18 卡均通过 |
| 16 | `npm run dev` 中文日志乱码 | Windows shell code page 未在真实启动入口设为 UTF-8 | Windows dev 启动包装器先切 65001，再运行构建和 Electron | contract + 实际 dev 输出中文复核 |

## 3. 根因与修法

### 3.1 Caption 不是普通业务图标

W87h 把正式控件收敛到语义 SVG 的方向正确，但 Windows caption 具有固定视觉语法，不能复用普通工具栏图标尺寸和描边。W87i 将三枚 caption 从通用 registry 剥离，使用专用 primitive 和固定 hit target；全局 `button svg` 规则不得覆盖其 1.15 线宽。

### 3.2 Ribbon 的真相是组件宽度和能力优先级

旧实现以整窗宽度猜测 Ribbon 密度，分屏、Sidebar、Dock 出现后组件实际可用宽度并不等于 viewport。W87i 让 Ribbon 观察自身，并按优先级逐级降级。最终证据中的 residual overflow 是 Ribbon 内部能力超出物理宽度后的显式滚动面，不是主文档裁切，也不是文字挤压：

```text
full
  ↓ 容器不足
compact
  ↓ 仍不足
icon
  ↓ 仍有完整能力
Ribbon 自身 overflow-x:auto
```

往返 `1920 → 1440 → 1100 → 960 → 1100 → 1440 → 1920` 后密度、overflow 和标签几何收敛；标签始终 `horizontal-tb + nowrap + keep-all`，overlap 为 0，document overflow 为 0。

### 3.3 页签需要滚动状态机，不是一个 auto margin

`.tabbar::before { margin-left:auto }` 只能解释未溢出时的右靠。真实横跳来自 `render()` 重建全部页签后，浏览器自行钳位 `scrollLeft`。W87i 现在维护：

```text
before render:
  scrollLeft + rightPinned + renderedActive + visibleAnchor
after render:
  rightPinned ? maxScroll : restore visibleAnchor
  → ensure active tab fully visible
  → one final layout-frame convergence
```

v4 使用 12 个长页签，而非两枚短签制造假绿：最后一签 dirty + rename 后仍 `rightGap=0`；切到真实书库页，改名和 dirty 后 `activeLeft` 保持；再激活末签重新封右；split 为 `11+1` 后两窗格都 right-pinned 且 active visible；join 回 12 签后再次轮转书库仍可见。

### 3.4 Dock 跨窗口拖拽必须区分两种坐标原点

主窗停靠坞第一次拖出使用 host 坐标原点，并在新浮窗盖住源窗口期间临时 click-through，把 move/up 留给源窗；浮窗的第二次拖动使用 float 原点，不能继续 click-through。W87i v4 对两条路径分别记账，验证三帧 pointer/window 位移连续，up/cancel/blur/close 均能撤销 drag session。

浮窗重绘不再摧毁工作态：未提交草稿、selection、focus、adapter 和 model 由本地 snapshot 恢复；工具清单冷启动空响应不是终态，owner ready 后主动补推，最终稳定为 18 卡。

### 3.5 主题包含结构，窗口包含能力

Construct 不只是另一组颜色，还声明 hard-edge；Paper / Ink 是 soft。W87i 把结构 token 与颜色一起广播给已打开 Panel，且自定义 Construct pack 同样携带结构。共享样式只处理矩形语义容器，圆形状态点和 pill 不被粗暴方形化。

PanelWindow 也不再共享一个 resizable 默认值：palette、shortcuts、agreement、bookmark、newfile、picklist、ctxmenu 等固定工具窗锁定尺寸能力；settings、plugins、translate、recorder、dockfloat、factorycfg、archive、fpreview 等工作台窗保留伸缩、最大化和全屏能力。状态证据直接读取 native BrowserWindow 属性，不以 CSS resize 代替系统窗口真相。

### 3.6 状态消息和终端编码由宿主负责

普通 toast 进入 statusbar 中央槽，左右状态文字不会被抢占；focus-mode 仍使用可见的中央 Seat，仅 fullscreen / player-borderless 等状态栏不可用场景保留受控浮层 fallback。Windows dev 入口统一 UTF-8 code page，乱码不再靠维护者手工执行 `chcp`。

## 4. 最终证据

| 证据 | 结论 |
|---|---|
| [`W87I_UI_STATE_CONVERGENCE_SOURCE.json`](./evidence/W87I_UI_STATE_CONVERGENCE_SOURCE.json) | `mazz.w87i-ui-state-convergence/v1`；SOURCE PASS；caption、Ribbon、色块、Help/Agreement、status toast、22 Panel policy、主题结构与竞态均通过 |
| [`W87I_UI_STATE_CONVERGENCE_PACKAGED.json`](./evidence/W87I_UI_STATE_CONVERGENCE_PACKAGED.json) | 相同状态矩阵在真实 `release/win-unpacked` PASS |
| [`W87I_PANE_DOCK_CONTINUITY_SOURCE.json`](./evidence/W87I_PANE_DOCK_CONTINUITY_SOURCE.json) | `mazz.w87i-pane-dock-continuity/v4`；12 长签/书库/dirty/rename/split/join、Dock 主窗拖出/二次拖、草稿焦点与 cold tools 18 卡 PASS |
| [`W87I_PANE_DOCK_CONTINUITY_PACKAGED.json`](./evidence/W87I_PANE_DOCK_CONTINUITY_PACKAGED.json) | 相同连续性矩阵在 packaged PASS |
| [`W87I_RIBBON_STATUS_SOURCE.png`](./evidence/W87I_RIBBON_STATUS_SOURCE.png)、[`PACKAGED`](./evidence/W87I_RIBBON_STATUS_PACKAGED.png) | Ribbon 文字无竖排/重叠，状态消息位于底栏中央 |
| [`W87I_CONSTRUCT_HOVER_SOURCE.png`](./evidence/W87I_CONSTRUCT_HOVER_SOURCE.png)、[`PACKAGED`](./evidence/W87I_CONSTRUCT_HOVER_PACKAGED.png) | Construct hover 图标与文字可见 |
| [`W87I_PANEL_STRUCTURE_SOURCE.png`](./evidence/W87I_PANEL_STRUCTURE_SOURCE.png)、[`PACKAGED`](./evidence/W87I_PANEL_STRUCTURE_PACKAGED.png) | Construct/custom Construct Panel hard-edge；Paper 回切 soft |
| [`W87G_THEME_LEGIBILITY_SOURCE.json`](./evidence/W87G_THEME_LEGIBILITY_SOURCE.json)、[`PACKAGED`](./evidence/W87G_THEME_LEGIBILITY_PACKAGED.json) | 每种运行态 `82/82` scope；contrast failure 0、renderer error 0 |
| [`UI_PAGE_SWEEP_SOURCE.json`](./evidence/UI_PAGE_SWEEP_SOURCE.json)、[`PACKAGED`](./evidence/UI_PAGE_SWEEP_PACKAGED.json) | 每种运行态 `110/110` scene；issue 0、runtime error 0；各 2 条 Sheet 内部合法横滚 warning |

最终验证账：

```text
full test files                           PASS 228 / 228
W87i state convergence SOURCE/PACKAGED   PASS / PASS
W87i pane+dock v4 SOURCE/PACKAGED        PASS / PASS
W87g legibility scopes                   82/82 × 2 · failure 0
UI page sweep                            110/110 × 2 · issue 0 · runtime 0
Sheet legal horizontal-scroll warnings  2 × 2（非 document overflow）
dist:dir                                 PASS
audit:release                            PASS
OSS provenance                          CURRENT / PASS
Computer Use                            DISABLED / NOT USED
```

## 5. 条件边界

1. Ribbon residual 是组件内部可访问横滚，不是 `0 overflow`；只有文字竖排、重叠、不可达能力、主文档横溢或往返不收敛才算失败。
2. UI sweep 每种运行态的 2 条 warning 都来自 Sheet 自身可横滚网格，是受支持交互，不是页面或文档溢出。
3. 22 类可打开 Panel 的 native policy 与结构已实测；透明、瞬时或条件型 Surface 仍由各自拓扑合同验收。
4. 本轮只背书当前 Windows 10 / Electron 33.4.11 主机、SOURCE 与现有 packaged specimen；多显示器、多 DPI、RDP/spacedesk、异机 GPU 和真实 Win32 物理拖放仍属外部矩阵。
5. 自定义 Construct 的结构传播已验；任意第三方主题包若绕过正式 token 合同，不自动获得背书。
6. Computer Use 因维护者要求明确禁用，本轮没有把它用于点击、截图或通过判定；全部结论来自 Electron/Playwright、native BrowserWindow 查询、computed audit 和最终截图。
7. W87i 关闭的是这 16 张截图对应的当前交互态问题族，不把未知用户内容、第三方插件自绘或所有未来条件态写成数学意义的“零缺陷”。

## 6. Final Gate

W87i 在上述支持矩阵内为 **SEALED**。W87 总状态更新为：

```text
W87a–i EXECUTED SCOPE RESEALED
W71 COMPLETE WAVE 5A OPEN
```

任何后续修改只要触碰标题栏 SVG、Ribbon 密度、Tabs render/scroll、Panel theme/policy、statusbar toast、Dock snapshot/drag 或 Windows dev 启动链，就必须重跑对应 W87i SOURCE + PACKAGED 门；仅保留旧 JSON 或截图不得宣称 CURRENT。
