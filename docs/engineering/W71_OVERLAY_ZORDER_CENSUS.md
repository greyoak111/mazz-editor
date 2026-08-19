# W71 Global Overlay / Multi-Surface Z-order Census

> **2026-08-19 supersession：** 本文保留 W71 当时的证据和判断，但“无需统一调度器”已被复发缺陷与维护者新授权推翻。W87 已落 `mazz.visual-composition/v1`，统一登记 Window、PanelWindow、WebContentsView 与 DOM Overlay；local resource owner 和既有 Windows workaround 仍保留。现行结论见 [`W87_UI_CONVERGENCE_CHECKPOINT_2026-08-19.md`](./W87_UI_CONVERGENCE_CHECKPOINT_2026-08-19.md)。

> 日期：2026-08-16
> 状态：代表性 Windows packaged 路径已产证；不是 Universal Overlay Manager 立项
> 机器证据：[`evidence/W71_OVERLAY_ZORDER.json`](./evidence/W71_OVERLAY_ZORDER.json)

## 1. 判断

Mazz 当前不需要为了封板建立万能 Overlay Manager。现有三种机制可以按根因继续保留：

1. 跨 `WebContentsView` 的正式全局浮层使用带主窗 `parent` 的原生 `PanelWindow`；
2. 只在同一 DOM/Canvas Surface 内工作的局部浮层继续留在模块内部；
3. 页签拖拽必须先临时 cloak `WebContentsView`，再绘制零延迟 DOM 分区预览，清理后恢复同一原生 Surface。

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
| 页签分屏预览 | Shell / Pane | DOM fixed overlay | 拖起先 `_dragCloak`，落下/pointerup/blur/watchdog 恢复 | **packaged PASS** |
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
- 拖拽期客页 `hidden=true`、bounds 归零，DOM 分区预览可见；pointerup 后原 bounds 恢复；
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

没有出现现有 owner 无法关闭的 P0/P1，也没有证据触发 SurfaceManager PoC。`drag cloak`、原生菜单、host-aware destroy、bounds convergence 等 workaround 继续 KEEP；不得因本轮通过而删除。
