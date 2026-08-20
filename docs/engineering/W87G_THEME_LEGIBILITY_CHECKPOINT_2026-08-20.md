# W87g Paper / Ink 全软件可辨识度封板检查点

> 日期：2026-08-20
> 结论：**EXECUTED SCOPE SEALED**
> 门禁协议：`mazz.w87g-theme-legibility/v1`
> Computer Use：**DISABLED / NOT USED**

## 1. 问题与根因

本波不是只改某一页的“字太灰”。最初的 Paper/Ink 一方 UI 基线审计检出 `1829` 个文字或 SVG 控件对比度失败。主要根因是：

- `--fg-dim` 与多层 `opacity` 叠加，使次级文字、placeholder、disabled 和 SVG 控件跌破可辨识门；
- 旧模块仍消费 `--acc / --bd / --card / --mut`，主题未提供兼容别名，导致局部回退到错误亮色或暗色；
- SVG 线宽偏细且部分控件未稳定继承 `currentColor`；
- Slide 的局部 `data-theme="ink"` 与应用主题选择器同名，误触发整块暗色规则；
- Player 空态、Panel 警告/禁用态和 QuickNote 存在硬编码低对比色。

## 2. 落地边界

统一主题层现提供兼容别名和足够对比的次级前景色；一方 UI 的 placeholder、disabled、警告/成功状态、SVG control stroke 与常用硬编码灰色均回到主题 token。SVG 图标仍使用 `currentColor`，控制图标基准线宽提升到 `2px`。Slide 的内容主题改用独立 `data-slide-theme`，不再污染应用 Paper/Ink 主题。

本波没有把所有界面改成单一颜色，也没有改写文档内容、外部网页、媒体画面或第三方插件自绘 UI；检查对象是 Mazz 自有 UI 字体、placeholder、状态文字和作为交互控件的 SVG 图标。

## 3. 穷举矩阵

每种运行形态均执行以下 Paper/Ink 交叉矩阵：

- 16 个主界面状态：Welcome、Markdown、Text、Sheet、Slide、Code、Math、Notes、Search、Mindmap、Draw、Library、Viewer、Factory Desk、Organization、Browser；
- 24 类 PanelWindow：`favmgr / pwmgr / palette / shortcuts / annotate / settings / agreement / help / translate / plugins / recorder / dockfloat / bookmark / ctxmenu / splitpreview / sync / notif / factorycfg / newfile / picklist / fpreview / fedit / harvest / archive`；
- QuickNote。

合计 `2 × (16 + 24 + 1) = 82` 个 page/theme scope。门禁读取实际 computed style，并对祖先背景、透明度和有效 opacity 做合成；普通文字阈值 `4.5:1`，大字、disabled 与 SVG 控件阈值 `3:1`。SVG `<text>`、纯装饰 emoji、任意网页/文档内容不冒充一方控件。

## 4. 结果与证据

| 运行形态 | 范围 | 对比度失败 | Renderer error | 结果 |
|---|---:|---:|---:|---|
| Source Electron | 82 scopes | 0 | 0 | PASS |
| `release/win-unpacked` | 82 scopes | 0 | 0 | PASS |

机器证据：

- [`W87G_THEME_LEGIBILITY_SOURCE.json`](./evidence/W87G_THEME_LEGIBILITY_SOURCE.json)
- [`W87G_THEME_LEGIBILITY_PACKAGED.json`](./evidence/W87G_THEME_LEGIBILITY_PACKAGED.json)
- [`W87G_UI_MODULE_MATRIX_SOURCE_PAPER.png`](./evidence/W87G_UI_MODULE_MATRIX_SOURCE_PAPER.png) / [`SOURCE_INK`](./evidence/W87G_UI_MODULE_MATRIX_SOURCE_INK.png)
- [`W87G_UI_MODULE_MATRIX_PACKAGED_PAPER.png`](./evidence/W87G_UI_MODULE_MATRIX_PACKAGED_PAPER.png) / [`PACKAGED_INK`](./evidence/W87G_UI_MODULE_MATRIX_PACKAGED_INK.png)
- [`W87G_UI_PANEL_MATRIX_SOURCE_PAPER.png`](./evidence/W87G_UI_PANEL_MATRIX_SOURCE_PAPER.png) / [`SOURCE_INK`](./evidence/W87G_UI_PANEL_MATRIX_SOURCE_INK.png)
- [`W87G_UI_PANEL_MATRIX_PACKAGED_PAPER.png`](./evidence/W87G_UI_PANEL_MATRIX_PACKAGED_PAPER.png) / [`PACKAGED_INK`](./evidence/W87G_UI_PANEL_MATRIX_PACKAGED_INK.png)
- QuickNote source/packaged × Paper/Ink 四张独立截图同目录留证。

上述模块、Panel 和 QuickNote 接触表已人工逐张回看：两种主题确实分化；Draw 工具条不再误回退为白底；Player 空态按钮、Panel 次级文字和禁用态可辨；未见新的硬编码亮岛/暗岛。

## 5. 回归门

```text
W87g contract                            PASS 5 / 5
source Electron legibility matrix        PASS 82 / 82 scopes
packaged Electron legibility matrix      PASS 82 / 82 scopes
contrast failures / renderer errors       0 / 0
legacy W87 source UI matrix               PASS
full suite                                PASS 223 / 223 test files
release audit / OSS provenance            PASS / CURRENT
```

## 6. 条件边界

Computer Use 按维护者要求保持禁用，本波只以 Electron E2E、computed style、截图和安装包实跑作证。屏幕阅读器、触摸设备、异机 GPU、RDP/虚拟显示驱动、任意外部网页、用户文档内容和第三方插件自绘界面不在本次可证明范围内；它们出现可复现的一方 UI 可辨识问题时，必须继续进入 W87 回归账。
