# W71 Layout Debt Census

> **W87 状态：** `960×600` 正式窗口门、尺寸档、Panel 窄窗共享层与 document overflow 运行检查已通过；A–E 静态候选仍不是自动缺陷。见 [`W87_UI_CONVERGENCE_CHECKPOINT_2026-08-19.md`](./W87_UI_CONVERGENCE_CHECKPOINT_2026-08-19.md)。

> 状态：Wave 0 `PROVISIONAL_OWNER_REVIEW_REQUIRED`
> 机器证据：[`../../.mazz/audit/layout-debt.json`](../../.mazz/audit/layout-debt.json)
> 生成命令：`npm run audit:w71:census`

## 范围和结果

一方 UI 源码中共记录 587 条布局候选，分布于 61 个文件。A–E 是可重复的初筛，不是最终缺陷裁决。

| 分类 | 定义 | 候选数 |
|---|---|---:|
| A | 合理固定值/定位候选 | 166 |
| B | 合理 min/max constraint 候选 | 75 |
| C | 历史 magic-number workaround 候选 | 29 |
| D | structural layout debt 候选 | 279 |
| E | resize/sidebar/split 动态计算债候选 | 38 |

| 规则 | 命中行 |
|---|---:|
| 固定 `width: Npx` | 180 |
| `position:absolute` | 142 |
| `white-space:nowrap` | 106 |
| 固定 min-width | 75 |
| 固定 left/right | 29 |
| JS resize/ResizeObserver | 21 |
| Sidebar 像素耦合 | 10 |
| `flex-shrink:0` | 9 |
| `width:100vw` | 8 |
| `calc(100%/100vw - ...)` | 7 |

## Owner 热区

`renderer/styles/base.css` 是最大实际主窗热区；其后是 Library、Browser、Factory、Slide、Shell 以及 Panel HTML。`renderer/base.css` 虽有大量候选，但加载可达性尚未证实，必须先查引用与历史职责，不能把它的数字直接混进运行态整改量，也不能据此删除。

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
- Player 先做参考实现，再推广至 Shell、Sheet、Browser、Factory、Library；
- 正式控件在支持尺寸下全部可达，More 中能力仍可达；
- 新代码不得新增未解释的 magic px/calc；
- 本 Census 完成不等于 Layout Convergence 完成。
