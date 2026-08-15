# W71 Visual Census

> 状态：Wave 0 事实基线，不是视觉整改完成证明
> 可重复命令：`npm run audit:w71:census`
> 机器证据：[`../../.mazz/audit/ui-census.json`](../../.mazz/audit/ui-census.json)

## 范围与口径

扫描 `renderer` 下 209 个一方 `.css/.html/.js/.svg` 文件、55,782 行源码；排除 `renderer/dist` 和 `renderer/vendor`。计数单位是“命中规则的源码行”，不是运行态控件数，更不是缺陷数。

| 观察项 | 命中行 |
|---|---:|
| 原生表单控件候选 | 1,003 |
| inline `style` | 552 |
| `style.cssText` | 43 |
| loading 语义样本 | 35 |
| tooltip/title 规则样本 | 2 |
| 合计 | 1,635 |

当前结果足以确认视觉系统不是“改一份 CSS 即收口”：大量状态与样式由模块模板、运行时字符串和独立 Panel HTML 分别生成。它还不足以判断某一条是好是坏，运行态状态矩阵仍是 Wave 5B Gate。

## 首批 owner 队列

按命中密度，首批人工审阅归属为：

1. Factory、Shell、Browser、Library；
2. Mindmap、Viewer/Player、Draw、Sheet、Markdown；
3. `factorycfg/settings/sync` 等独立 Panel Surface；
4. Search、Recorder、Archive、Plugins 的空态、错误态、进度与取消态。

这只是审阅顺序，不代表对高命中文件进行机械重写。

## Wave 5B 前置 Gate

- 为正式入口建立 `default/hover/focus/active/disabled/loading/empty/error/success` 截图矩阵；
- 把“源码存在状态词”与“运行态有可达状态”分开验证；
- 主窗、Panel BrowserWindow、DOM modal、原生菜单分别取样；
- Dark/Light/Constructivist 与 100/150/200% DPI 组合验收；
- Product Polish 在矩阵完成前保持 `RED / UNASSESSED`，不赋百分数。

## 禁止误读

- inline style 不自动等于债，动态尺寸、内容色和打印内容可能合理；
- 原生 `<button>/<input>` 不自动等于不专业，关键是统一状态和 Theme Contract；
- 帮助文本、用户内容里的符号不属于控件视觉违规；
- 本 Census 不授权先改 UI，也不覆盖 W71 Correctness/Lifecycle 优先级。
