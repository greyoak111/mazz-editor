# W87 全软件 UI / Unified Visual Composition 封板检查点

> 日期：2026-08-19
> 起始坐标：`main@c125454`
> 结论：**SUPPORTED-SCOPE SEALED；已知 P0/P1 = 0**
> 协议：`mazz.visual-composition/v1`

## 1. 结果

本轮没有继续叠加 Browser 局部 cloak。Main Window、PanelWindow、WebContentsView 和 DOM Overlay 已进入同一视觉注册与仲裁面；local owner 继续持有真实资源，统一运行时持有 host、geometry、focus、occlusion 和视觉生命周期。

同时对主应用、24 个独立 Panel HTML、QuickNote、主题、图标、焦点、禁用态、最小窗口和瞬时菜单执行了全量收敛。支持矩阵中没有已知未关闭 P0/P1；外部硬件与第三方内容边界单列，不冒充已验。

## 2. 落地件

| 层 | 落地 |
|---|---|
| Kernel | `main/visual-composition-kernel.js`：严格 kind、有限 bounds、Surface register/update/unregister、Overlay token 引用计数、source cleanup、确定性 snapshot |
| Main Runtime | `main/visual-composition.js`：五条 IPC、host 解析、来源销毁/导航收尸、native occlusion、panel rehost、focus arbitration |
| Native adapters | WindowManager、PanelWindows、BrowserViews 全接注册表；事件发回实际 host；Panel native parent 与 logical host 同步 |
| Renderer Runtime | `renderer/core/visual-composition.js`：唯一 `#mazz-overlay-plane`、pending hide、Mutation/Resize observer、focus trap/restore、Escape 仲裁、尺寸档 |
| UI Contract | `convergence.css`、`panel-runtime.js`、`panel-shared.css`：focus-visible、disabled、图标、滚动、窄窗、reduced motion、统一 panel 装载 |
| Icon Runtime | 已知控制符统一转 `currentColor` SVG，并为无文本图标补 `aria-label`；`iconHtml()` 字面量全命中 |
| Theme | Paper/Ink 真实 computed gate；QuickNote 接应用主题；Organization 和 Browser host 清除硬编码暗岛/白底 |
| Lifecycle | 页签隐藏前 blur，隐藏 view 同步 `aria-hidden + inert`；瞬时菜单只在首帧 ready 并取得焦点后武装 blur-close |

## 3. 本轮抓到并关闭的真实缺陷

1. **主题启动竞态**：用户刚切 Paper，迟到的 `boot()` 设置又改回 Ink。现有 `MazzBoot` 完成承诺和 theme revision，新的用户选择永远压过旧启动值。
2. **无障碍焦点冲突**：Sheet 的输入代理在持有焦点时标记 `aria-hidden`，页签切换也可能隐藏仍有焦点的子树。Chromium 报 AX tree `NOTREACHED`。移除错误标记并统一 blur + inert 后，源码和 packaged 严格日志门均不再复现。
3. **瞬时面板假 blur**：`ctxmenu/picklist` 创建即显示，前一面板的收尾 focus 可能使新窗尚未绘制就自闭。现改为 `ready-to-show → show/focus → arm blur`。
4. **Overlay 双主权**：Browser 曾自己观察 `.mazz-palette-mask/.help-mask` 并维护 `_cloaked`。该观察器和状态已退役，统一令牌是唯一遮挡真相；拖拽 `_dragCloak` 作为 Windows 命中药方保留。
5. **Panel host 漂移**：事件与 native context menu 曾默认回主窗；现在按实际 host 路由，已有单例跨窗调用时显式 rehost。
6. **首帧/空态视觉债**：Context Menu 的透明黑闪、Organization 暗色孤岛、Browser host 白底、QuickNote 只跟 OS 主题均已收口。
7. **死 Surface kind**：`quickopen` 已被 palette 吸收却仍留在主进程白名单，且没有 HTML。现删除死 kind 并加反复活合同。

## 4. 机器与视觉证据

| 证据 | 结果 |
|---|---|
| [`W87_UI_CONVERGENCE_RUNTIME_SOURCE.json`](./evidence/W87_UI_CONVERGENCE_RUNTIME_SOURCE.json) | 14 模块 × 2 主题、24 面板、native overlay、960×600；fatal 0 / renderer error 0 |
| [`W87_UI_CONVERGENCE_RUNTIME_PACKAGED.json`](./evidence/W87_UI_CONVERGENCE_RUNTIME_PACKAGED.json) | `release/win-unpacked` 同矩阵通过；连续两轮无瞬时面板/主题竞态 |
| [`W87_UI_MODULE_MATRIX_PAPER.png`](./evidence/W87_UI_MODULE_MATRIX_PAPER.png) | 14 模块 Paper 人工复核 |
| [`W87_UI_MODULE_MATRIX_INK.png`](./evidence/W87_UI_MODULE_MATRIX_INK.png) | 14 模块 Ink 人工复核 |
| [`W87_UI_PANEL_MATRIX_INK.png`](./evidence/W87_UI_PANEL_MATRIX_INK.png) | 22 个可截图面板；Annotate/SplitPreview 由透明 Surface 拓扑验收 |
| [`W87_UI_OVERLAY_NATIVE_OCCLUSION.png`](./evidence/W87_UI_OVERLAY_NATIVE_OCCLUSION.png) | 第二层 Overlay 可见，native Surface 已按 host 遮挡 |
| [`W87_UI_MINIMUM_WINDOW_INK.png`](./evidence/W87_UI_MINIMUM_WINDOW_INK.png) | `960×600`、`uiSize=md`，无 document horizontal overflow |
| [`W67_MEMORY_RUNTIME.json`](./evidence/W67_MEMORY_RUNTIME.json) | 20 WCV + 20 Panel；Resource converged；工作集回落 99.71% / 97.40% |
| [`W71_RELEASE_BASELINE.json`](./evidence/W71_RELEASE_BASELINE.json) | Windows unpacked 发布边界审计通过 |

截图已逐张回看：Paper/Ink 确实分化；Organization、Browser host、Panel 空态已同盘；最低窗口没有横向裁切；Overlay 下方 native 页面不穿透；面板矩阵没有新的黑闪或未主题化孤岛。

## 5. 验证

```text
W87 kernel/contracts                     PASS
source Electron UI matrix                PASS
packaged Electron UI matrix              PASS × 2 consecutive
14 modules × Paper/Ink                    PASS
24 PanelWindow kinds                      PASS
nested overlay reference counting         PASS
main fatal logs / renderer errors          0 / 0
20 WebContentsView lifecycle              PASS
20 PanelWindow lifecycle                  PASS
release audit                              PASS
OSS provenance                             CURRENT
full suite                                 219 / 219 test files PASS
```

W67 本轮数据：baseline `351.2 MiB`；WCV peak/after `2039.6/356.0 MiB`；Panel peak/after `3025.0/425.5 MiB`；event-loop max lag `35 ms`。峰值来自刻意同时创建 20 个原生对象，不是日常稳态目标；关键门是关闭后的账本和回落率。

## 6. 对旧结论的 supersession

| 旧记录 | W87 处理 |
|---|---|
| W71 “当前不实施 SurfaceManager” | 保留为历史判断；复发证据满足 PoC 启动条件，现由更小的 VisualCompositionRuntime supersede |
| W71 Surface v1 draft | 方法语义被 W87 registry/overlay/focus/host 协议吸收；不实施全量 owner 迁移 |
| W46/W50 Browser module-local cloak | 正式 modal 遮挡逻辑退役；统一 Overlay token 取代 |
| drag cloak / invalidate / bounds oscillation 等 | 继续 KEEP；W87 snapshot 明示 `workaroundRemovalAuthorized=false` |

## 7. 封板边界

“已知 P0/P1 = 0”只针对计划文件的支持矩阵。多显示器与多 DPI 全排列、真实屏幕阅读器/触摸设备、第三方插件 UI、摄像头/麦克风许可、RDP/spacedesk/异机 GPU 和任意外部网页仍是条件矩阵。它们出现新证据时必须进入 W87 协议和回归账，不允许以“封板”名义拒绝修复，也不允许现在伪报已通过。
