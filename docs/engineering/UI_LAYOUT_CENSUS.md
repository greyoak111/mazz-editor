# W71 Layout Debt Census

> **W87 状态：** W87a–f 已执行范围通过；W87e Player 参考实现与 W87f Workspace Sidebar / empty Player 几何均完成 source + packaged Electron 复封。A–E 静态候选仍不是自动缺陷，完整 W71 Wave 5A 仍为 OPEN。见 [`W87_UI_CONVERGENCE_CHECKPOINT_2026-08-19.md`](./W87_UI_CONVERGENCE_CHECKPOINT_2026-08-19.md)、[`W87E_PLAYER_CONTROL_SURFACE_CHECKPOINT_2026-08-20.md`](./W87E_PLAYER_CONTROL_SURFACE_CHECKPOINT_2026-08-20.md) 与 [`W87F_SIDEBAR_PLAYER_LAYOUT_CHECKPOINT_2026-08-20.md`](./W87F_SIDEBAR_PLAYER_LAYOUT_CHECKPOINT_2026-08-20.md)。

> 状态：Wave 0 `PROVISIONAL_OWNER_REVIEW_REQUIRED`
> 机器证据：[`../../.mazz/audit/layout-debt.json`](../../.mazz/audit/layout-debt.json)
> 生成命令：`npm run audit:w71:census`

## 范围和结果

当前一方 UI 源码中共记录 640 条布局候选，分布于 67 个文件。A–E 是可重复的初筛，不是最终缺陷裁决；数字会随源码和审计规则演进，增加不等于产品回归。

| 分类 | 定义 | 候选数 |
|---|---|---:|
| A | 合理固定值/定位候选 | 182 |
| B | 合理 min/max constraint 候选 | 81 |
| C | 历史 magic-number workaround 候选 | 31 |
| D | structural layout debt 候选 | 295 |
| E | resize/sidebar/split 动态计算债候选 | 51 |

| 规则 | 命中行 |
|---|---:|
| 固定 `width: Npx` | 185 |
| `position:absolute` | 148 |
| `white-space:nowrap` | 125 |
| 固定 min-width | 81 |
| 固定 left/right | 31 |
| JS resize/ResizeObserver | 28 |
| Sidebar 像素耦合 | 12 |
| `flex-shrink:0` | 11 |
| `width:100vw` | 8 |
| `calc(100%/100vw - ...)` | 11 |

## Owner 热区

`renderer/styles/base.css` 是最大实际主窗热区（当前 346 条候选）；`renderer/base.css` 有 83 条，但加载可达性尚未证实，必须先查引用与历史职责，不能把它的数字直接混进运行态整改量，也不能据此删除。其后仍包括 Library、Browser、Factory、Slide、Shell 以及 Panel HTML。Player W87e 新增的响应式规则也会被静态审计计数；有明确 owner、尺寸合同和回归门的约束不应被机械判成债务。

## 人工复核纪律

- 图标固有尺寸、resize grip、hit target、带 ellipsis 的 nowrap 优先核为 A；
- min/max constraint 优先核为 B，但必须说明支持尺寸；
- 为某次 Windows/Surface 问题保留的坐标进入 C，并绑定 workaround ID；
- 会撑破 Pane、遮蔽控件或依赖 viewport 猜容器的进入 D；
- JS 读取 Sidebar/Pane 像素再重算、跨 split/window 的进入 E；
- 一个源码行可含多个性质，最终 owner 复核可拆项或改类。

## Wave 5A Gate

- 冻结 Layout Contract 与 L/M/S/XS；
- 建通用 width/DPI E2E helper；
- Player 参考实现：**实施、Node contract 及 source + packaged Electron runtime reseal 均已完成**；随后仍须推广至 Shell、Sheet、Browser、Factory、Library；
- 正式控件在支持尺寸下全部可达，More 中能力仍可达；
- 新代码不得新增未解释的 magic px/calc；
- 本 Census 完成不等于 Layout Convergence 完成。

Player 的固定边界探针为 `1200 / 960 / 959 / 900 / 720 / 600 / 599 / 560 / 440 / 439 / 420 / 320 px`，宽度真源是 Player controls container，不是主窗口 viewport。L/M/S/XS 只能移动同一真实控件节点；stage-local More 不升级为全局 Surface kind。W87e 只 supersede Player 上的 W58c `max-content`，继续保留 W58f fade 和 W58h 侧栏几何语义。

Workspace Sidebar 的已执行边界为 `180 / 232 / 320px`：8 个页签固定 `4×2`；`≤260px` 只隐藏装饰图标而不隐藏文字，标签不得换行、裁切或逃出 tabbar。空 Player 不再携带永久 inline right，只在真实 `side-open:not(.side-overlay)` 时随底栏共同让位。

当前 20 轮门只覆盖 resize/ownership convergence；真实媒体多轮打开关闭、内存回落与长时间 soak 必须由各自测试另行证明。完整 W71 Wave 5A 在其他五个 owner 完成前保持 OPEN。
