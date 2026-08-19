# W71 Global Overlay / Multi-Surface Z-order Census

> **2026-08-19 supersession：** 本文保留 W71 当时的证据和判断，但“无需统一调度器”已被复发缺陷与维护者新授权推翻。W87 已落 `mazz.visual-composition/v1`，统一登记 Window、PanelWindow、WebContentsView 与 DOM Overlay；local resource owner 和既有 Windows workaround 仍保留。现行结论见 [`W87_UI_CONVERGENCE_CHECKPOINT_2026-08-19.md`](./W87_UI_CONVERGENCE_CHECKPOINT_2026-08-19.md)。

> **2026-08-19 W87d 再修订：** 本文当时把“拖拽期 WCV hidden + DOM 预览可见”误当成通过，实际会把网页挖成空底。现行路径必须先预绘每个可见 WCV 的代理帧，才允许 cloak；恢复也必须先确认原生面在最终 bounds 可见再撤代理。见 [`W87D_BROWSER_DRAG_VISUAL_CONTINUITY_CHECKPOINT_2026-08-19.md`](./W87D_BROWSER_DRAG_VISUAL_CONTINUITY_CHECKPOINT_2026-08-19.md)。历史 JSON/截图仅说明 W71 当时状态，不再承担拖拽视觉连续性 Gate。

> 日期：2026-08-16
> 状态：代表性 Windows packaged 路径已产证；不是 Universal Overlay Manager 立项
> 机器证据：[`evidence/W71_OVERLAY_ZORDER.json`](./evidence/W71_OVERLAY_ZORDER.json)

## 1. 判断

Mazz 当前不需要为了封板建立万能 Overlay Manager。现有三种机制可以按根因继续保留：

1. 跨 `WebContentsView` 的正式全局浮层使用带主窗 `parent` 的原生 `PanelWindow`；
2. 只在同一 DOM/Canvas Surface 内工作的局部浮层继续留在模块内部；
3. 页签拖拽继续用 DOM 分区命中，但必须先完成可见 WCV 代理帧的 capture/decode/双帧预绘，随后才可临时 cloak，清理时先恢复同一原生 Surface 再撤代理。

`z-index` 只在同一 DOM 合成域内有意义，不能作为跨 `WebContentsView` 修复。

## 2. 本轮发现并修复的根因缺陷

### 2.1 首启协议漏过原生子窗入口

Ribbon 手动入口已经使用 `agreement` PanelWindow，但 `maybeAutoShowAgreement()` 仍直接创建主窗 DOM modal。默认 Browser Surface 存在时，协议会被原生视图压住，首启用户可能看不见或无法操作。

修复后 `showAgreement()` 成为单一入口：Electron 先开原生 `agreement` 子窗，网页预览才回退 DOM。打包程序在干净 userData 下验证：协议窗是主窗受控子窗、位于活动 `WebContentsView` 上方，“后续不再弹出”能够落盘，关闭后 PanelWindow 资源归还。

### 2.2 Browser 临时分享确认仍使用 DOM modal

“当前网页生成 10 分钟局域网链接”成功后曾在 Browser 前台创建 DOM modal，同样存在被客页 Surface 遮挡的根因。Electron 路径现改为 OS 原生信息对话框；DOM modal 只保留网页预览 fallback。

## 3. Overlay Census

| Overlay 家族 | owner / host | 当前实现 | 跨原生 Surface 策略 | 本轮状态 |
|---|---|---|---|---|
| 首启协议 | Agreement / 主窗 | `agreement` PanelWindow | 原生 child window | **FIXED + packaged PASS** |
| Mazz 上下文菜单 | MenuService / 主窗 | `ctxmenu` PanelWindow | 原生 child window | **packaged PASS** |
| Browser 客页右键 | BrowserViews / 客页 | Electron `Menu.popup` | OS/native menu surface | KEEP；既有路径不删除 |
| Quick Switcher | Shell / 主窗 | `palette` PanelWindow | 原生 child window | **packaged PASS** |
| Settings / Help / Plugins / Recorder 等正式全局面板 | PanelWindows / 主窗 | 独立 BrowserWindow | 原生 child window | 同协议；代表性路径已验证 |
| 页签分屏预览 | Shell / Pane | WCV 最后帧代理 + DOM fixed overlay | 代理完整预绘后 `_dragCloak`；落下/pointerup/blur/watchdog 先恢复 WCV 再撤代理 | **W87d packaged PASS** |
| Browser 临时分享确认 | Browser module / 主窗 | OS message box | 原生系统对话框 | **FIXED** |
| 模块内 selection / handle / tooltip | 各模块本地 host | DOM/Canvas overlay | 只承诺模块 Surface 内部层级 | 保持局部 owner |
| Annotate / Split Preview | PanelWindows / 主窗 | transparent always-on-top BrowserWindow | 独立 overlay window | KEEP |

## 4. Packaged 证据

执行：

```text
npm.cmd run dist:dir
node tests/e2e/w71-overlay-zorder.mjs
```

结果：

- 首启协议、上下文菜单、Quick Switcher 都是 `parentId == main.id` 的可见原生子窗；
- 四条路径均在活动 Browser `WebContentsView` 存在时运行；
- 该历史 run 只证明拖拽期客页 `hidden=true` 与 DOM 分区预览存在，不能证明用户仍看见网页；视觉连续性由 W87d 新矩阵承担；
- 操作前后 ResourceLedger active count 相等；
- 测试没有使用公网网页，客页使用本地可重复 Surface；
- Chromium `desktopCapturer` 会排除本进程窗口，因此截图由主窗、`WebContentsView.capturePage()` 与子窗按 Electron 实际 bounds 做无缩放合成；拓扑断言与像素证据分开保存，不把拼图当作 OS z-order API。

截图：

- [`W71_OVERLAY_FIRST_RUN_AGREEMENT.png`](./evidence/W71_OVERLAY_FIRST_RUN_AGREEMENT.png)
- [`W71_OVERLAY_CONTEXT_MENU.png`](./evidence/W71_OVERLAY_CONTEXT_MENU.png)
- [`W71_OVERLAY_COMMAND_PALETTE.png`](./evidence/W71_OVERLAY_COMMAND_PALETTE.png)
- [`W71_OVERLAY_DRAG_CLOAK.png`](./evidence/W71_OVERLAY_DRAG_CLOAK.png)

## 5. Gate 与边界

本轮关闭的是“代表性真实路径没有被 Native/WebContents Surface 遮挡”的子 Gate，不是全部浮层逐项验收。RDP、多显示器、多 DPI、Browser 原生 `Menu.popup` 的 OS 抓帧和更广模块组合仍属于后续矩阵。

原生菜单、host-aware destroy、bounds convergence 等 workaround 继续 KEEP。`drag cloak` 只允许在代理帧已绘制后使用；“直接 cloak”已由 W87d 判为复发缺陷，不得借历史 W71 证据恢复。
