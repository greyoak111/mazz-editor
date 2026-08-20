# W87 全软件 UI / Unified Visual Composition 封板检查点

> 日期：2026-08-19
> 起始坐标：`main@c125454`
> 结论：**W87a–f EXECUTED SCOPE RESEALED；W71 COMPLETE WAVE 5A OPEN**
> 协议：`mazz.visual-composition/v1`

> 2026-08-19 修订：原封板遗漏“主窗多 Browser + 工作台 child + 主/子窗盖顶 + 已有分屏再次拖拽 + child Panel 盖顶”的复合矩阵，后被 W87b RED 证伪。该组合根因已关闭，并完成 source/packaged × hardware/compatibility 复验；详见 [`W87B_BROWSER_COMPOSITION_CHECKPOINT_2026-08-19.md`](./W87B_BROWSER_COMPOSITION_CHECKPOINT_2026-08-19.md)。原报告的单轴证据保留，但不再单独承担复合场景封板结论。

> 2026-08-19 W87d 再修订：W87b 又把“拖拽期全部 WCV hidden”误当成功，遗漏用户实际看到的网页空底。跨渲染面视觉连续性现以 [`W87D_BROWSER_DRAG_VISUAL_CONTINUITY_CHECKPOINT_2026-08-19.md`](./W87D_BROWSER_DRAG_VISUAL_CONTINUITY_CHECKPOINT_2026-08-19.md) 为准；W87/W87b 其他单轴与复合结论不受影响。

> 2026-08-20 W87e/f 修订：Player 底栏在窄 Pane/侧栏组合下仍会被 W58c `max-content` 药方裁切；Workspace Sidebar 八页签与空 Player 又暴露组件级宽度和状态几何缺口。W87e/f 已在最终代码上完成 source/packaged Electron 复封；详见 [`W87E_PLAYER_CONTROL_SURFACE_CHECKPOINT_2026-08-20.md`](./W87E_PLAYER_CONTROL_SURFACE_CHECKPOINT_2026-08-20.md) 与 [`W87F_SIDEBAR_PLAYER_LAYOUT_CHECKPOINT_2026-08-20.md`](./W87F_SIDEBAR_PLAYER_LAYOUT_CHECKPOINT_2026-08-20.md)。这仍不等于 W71 全部 Wave 5A 已推广。

## 1. 结果

本轮没有把 Browser 局部即时 cloak 当成视觉解决方案。Main Window、PanelWindow、WebContentsView 和 DOM Overlay 已进入同一视觉注册与仲裁面；local owner 继续持有真实资源，统一运行时持有 host、geometry、focus、occlusion 和视觉生命周期。W87d 保留 drag cloak 作为 Windows 命中药方，但把它严格放在 sender-host 捕获、代理预绘、relayout 和 Overlay 身份门之后。

同时对主应用、24 个独立 Panel HTML、QuickNote、主题、图标、焦点、禁用态、最小窗口和瞬时菜单执行了全量收敛。原单轴支持矩阵与 W87b Browser 复合矩阵中没有已知未关闭 P0/P1；外部硬件与第三方内容边界单列，不冒充已验。

这里的“全量”现在指 W87a–f 明列且已有运行证据的执行范围；它仍不代表 W71 Wave 5A 已在 Shell、Sheet、Browser、Factory、Library 全面推广。

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
| Browser drag continuity | main 按 IPC sender-host 执行 `captureVisibleHost`；捕获瞬间精确校验可见集合、`tabId/webContentsId` 与 bounds；代理预绘后 relayout，Overlay 激活复核身份全集，再 cloak；恢复通过 native visible/bounds Gate |
| Player Control Surface | stage-local L/M/S/XS；同一真实控件 inline ↔ Control Center；侧栏 preferred/effective、焦点/锁定/ARIA 与 lifecycle 闭环 |
| Sidebar / empty Player layout | Workspace Sidebar `4×2` + container density；空 Player 只在真实 push-side open 时让位，收栏与底栏同步铺满 |

## 3. 本轮抓到并关闭的真实缺陷

1. **主题启动竞态**：用户刚切 Paper，迟到的 `boot()` 设置又改回 Ink。现有 `MazzBoot` 完成承诺和 theme revision，新的用户选择永远压过旧启动值。
2. **无障碍焦点冲突**：Sheet 的输入代理在持有焦点时标记 `aria-hidden`，页签切换也可能隐藏仍有焦点的子树。Chromium 报 AX tree `NOTREACHED`。移除错误标记并统一 blur + inert 后，源码和 packaged 严格日志门均不再复现。
3. **瞬时面板假 blur**：`ctxmenu/picklist` 创建即显示，前一面板的收尾 focus 可能使新窗尚未绘制就自闭。现改为 `ready-to-show → show/focus → arm blur`。
4. **Overlay 双主权**：Browser 曾自己观察 `.mazz-palette-mask/.help-mask` 并维护 `_cloaked`。该观察器和状态已退役，统一令牌是唯一遮挡真相；拖拽 `_dragCloak` 作为 Windows 命中药方保留。
5. **Panel host 漂移**：事件与 native context menu 曾默认回主窗；现在按实际 host 路由，已有单例跨窗调用时显式 rehost。
6. **首帧/空态视觉债**：Context Menu 的透明黑闪、Organization 暗色孤岛、Browser host 白底、QuickNote 只跟 OS 主题均已收口。
7. **死 Surface kind**：`quickopen` 已被 palette 吸收却仍留在主进程白名单，且没有 HTML。现删除死 kind 并加反复活合同。
8. **跨工作台 Browser ID 冲突**：主窗和 child renderer 都从 `bt-1` 起号，子窗恢复会误销毁主窗 WCV。现改为跨 renderer UUID，并把恢复限定在目标 Browser controller。
9. **复杂拖拽的跨平面交接**：旧逻辑只 cloak active Browser，其他 WCV 会盖住预览；W87b 改成立即全 cloak 又会把网页挖成空底。W87d 由 main 依据 IPC sender 锁定真实 host，`captureVisibleHost` 在捕获前后精确核对可见集合、`tabId/webContentsId` 和 bounds；非活动 source 先激活并等待两帧。全部代理 decode/预绘后按当前 DOM 几何 relayout，Overlay 激活再复核身份全集，才统一 cloak 并持有 host token；恢复时原生面未回最终 bounds 就不撤代理。proxy/gradient 均 pointer-through，渐变只过渡 opacity，不允许几何 `transition:all`。
10. **迁移靠网络 reload 收敛**：`pane:tabMoved` 曾以 reload 掩盖合成失配，带来白帧和页面状态丢失。现改为本地 `bv:recompose`，并以 generation 使旧几何 timer 失效。
11. **child / Panel 首帧与焦点错宿主**：Browser handoff 未完成时 child 已显示，普通 Panel 也会裸壳先显；child Panel 关闭后还会抢回 main。现统一延迟到 handoff ACK / `ready-to-show`，并向实际 host 归还焦点。
12. **迟到 HOME 假绿**：异步 `document.write` 可在真网页加载后覆盖画面，而 Window JS 标记仍存活。现将 HOME 写入串进导航队列，并用 WCV 原生像素抓取而非只看状态探针验收。
13. **Player `max-content` 裁切**：W58c 的“控件不缩”药方在窄 Pane 中变成静默裁切。W87e 改为按 control seat 容器宽度分档并把同一真实节点有序迁入 More。
14. **Sidebar 文字竖排 / 空 Player 假侧栏**：八页签单行 flex 挤压标签；空画面永久 inline right 在收栏后仍占位。W87f 分别改为 `4×2` container grid 与 class-driven side geometry。

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
| [`W87B_BROWSER_COMPOSITION_SOURCE_HARDWARE_W87D.json`](./evidence/W87B_BROWSER_COMPOSITION_SOURCE_HARDWARE_W87D.json)、[`SOURCE_COMPATIBILITY_W87D`](./evidence/W87B_BROWSER_COMPOSITION_SOURCE_COMPATIBILITY_W87D.json)、[`SOURCE_HARDWARE_W87DLIGHT`](./evidence/W87B_BROWSER_COMPOSITION_SOURCE_HARDWARE_W87DLIGHT.json) | source：hardware/compatibility Ink + hardware Construct light 三组最终 Browser 复合矩阵均 PASS |
| [`W87B_BROWSER_COMPOSITION_PACKAGED_HARDWARE_W87D.json`](./evidence/W87B_BROWSER_COMPOSITION_PACKAGED_HARDWARE_W87D.json)、[`PACKAGED_COMPATIBILITY_W87D`](./evidence/W87B_BROWSER_COMPOSITION_PACKAGED_COMPATIBILITY_W87D.json)、[`PACKAGED_HARDWARE_W87DLIGHT`](./evidence/W87B_BROWSER_COMPOSITION_PACKAGED_HARDWARE_W87DLIGHT.json) | packaged：相同三组矩阵均 PASS；独立 WCV `colorfulRatio≈0.924–0.988` |
| [`W87D_BROWSER_CDP_POINTER_AFTER_DROP_HARDWARE.json`](./evidence/W87D_BROWSER_CDP_POINTER_AFTER_DROP_HARDWARE.json)、[`DURING_DRAG`](./evidence/W87D_BROWSER_CDP_POINTER_DURING_DRAG_HARDWARE.png)、[`AFTER_DROP`](./evidence/W87D_BROWSER_CDP_POINTER_AFTER_DROP_HARDWARE.png) | Playwright CDP pointer：pointer-through、drop 后 topology/owner 与清理通过；明确不是 Win32 `SendInput` |
| [`W87E_PLAYER_CONTROL_SURFACE_SOURCE.json`](./evidence/W87E_PLAYER_CONTROL_SURFACE_SOURCE.json)、[`PACKAGED`](./evidence/W87E_PLAYER_CONTROL_SURFACE_PACKAGED.json) 与 8 张 Player 图 | **CURRENT / PASS**：P1 加固后 source/packaged；12 宽度档、真实分屏/侧栏、焦点/锁定/ARIA、20× ownership；fatal/error 0 |
| [`W87F_SIDEBAR_PLAYER_LAYOUT_SOURCE.json`](./evidence/W87F_SIDEBAR_PLAYER_LAYOUT_SOURCE.json)、[`PACKAGED`](./evidence/W87F_SIDEBAR_PLAYER_LAYOUT_PACKAGED.json) 与 4 张图 | **CURRENT / PASS**：Sidebar `180/232/320px` 与空 Player 侧栏开关 20×；fatal/error 0 |

截图已逐张回看：Paper/Ink 确实分化；Organization、Browser host、Panel 空态已同盘；最低窗口没有横向裁切；Overlay 下方 native 页面不穿透；面板矩阵没有新的黑闪或未主题化孤岛。

## 5. 验证

```text
W87 kernel/contracts                     PASS
source Electron UI matrix                PASS
packaged Electron UI matrix              PASS × 2 consecutive
Browser composite source HW/compat/light PASS / PASS / PASS
Browser composite package HW/compat/light PASS / PASS / PASS
capture set/identity/geometry exact       PASS
proxy relayout + overlay identity gate    PASS
three simultaneous Browser Surface       PASS
actual pane topology + single owner       PASS
four-way pointer-through                  PASS
main/child alternating focus cycles       PASS × 5
post-drop JS state + geometry ≤ 2px       PASS
14 modules × Paper/Ink                    PASS
24 PanelWindow kinds                      PASS
nested overlay reference counting         PASS
main fatal logs / renderer errors          0 / 0
20 WebContentsView lifecycle              PASS
20 PanelWindow lifecycle                  PASS
release audit                              PASS
OSS provenance                             CURRENT
full suite at W87d coordinate              221 / 221 test files PASS
```

上表是 W87d 封板坐标的历史验证账。W87e/f 的最终增量账如下：

```text
W87e Player Node contract                 PASS 13 / 13
W71 Viewer/Player lifecycle               PASS 4 / 4
P1-hardened source Electron               PASS / CURRENT
P1-hardened packaged Electron             PASS / CURRENT
W87f Sidebar/empty Player source          PASS / CURRENT
W87f Sidebar/empty Player packaged        PASS / CURRENT
final full suite                          PASS 222 / 222 test files
release audit / OSS provenance            PASS / CURRENT
W71 complete Wave 5A                      OPEN
```

W87e 的精确组件宽度门为 `1200 / 960 / 959 / 900 / 720 / 600 / 599 / 560 / 440 / 439 / 420 / 320 px`。W87f 的 Sidebar 门为 `180 / 232 / 320px`。两者的 20 轮分别只验 resize/DOM ownership 与侧栏开关几何 convergence，不是 20 次真实媒体打开关闭、内存回落或媒体 soak。

拖拽整窗像素口径为 Ink `colorfulRatio≈0.5665–0.5666`、Construct `≈0.9100–0.9128`；独立 WCV 为 `≈0.924–0.988`。二者观察对象不同，不得混写为同一分数。

W67 本轮数据：baseline `351.2 MiB`；WCV peak/after `2039.6/356.0 MiB`；Panel peak/after `3025.0/425.5 MiB`；event-loop max lag `35 ms`。峰值来自刻意同时创建 20 个原生对象，不是日常稳态目标；关键门是关闭后的账本和回落率。

## 6. 对旧结论的 supersession

| 旧记录 | W87 处理 |
|---|---|
| W71 “当前不实施 SurfaceManager” | 保留为历史判断；复发证据满足 PoC 启动条件，现由更小的 VisualCompositionRuntime supersede |
| W71 Surface v1 draft | 方法语义被 W87 registry/overlay/focus/host 协议吸收；不实施全量 owner 迁移 |
| W46/W50 Browser module-local cloak | 正式 modal 遮挡逻辑退役；统一 Overlay token 取代 |
| drag cloak / invalidate / bounds oscillation 等 | 继续 KEEP；但 drag cloak 只能位于 W87d 代理预绘之后，直接 cloak 已禁止 |
| W58c Player `.mz-bar min-width:max-content` | 仅由 W87e Player Control Surface supersede；不把这次局部替换扩写成全局 CSS 删除许可 |
| W58f fade / W58h side geometry | 继续 KEEP；W87e 在其上补焦点唤回与 preferred/effective 宽度，不抹掉既有窗口/侧栏语义 |

## 7. 封板边界

“已知 P0/P1 = 0”只针对计划文件中的 W87a–f 已执行范围，不覆盖完整 W71 Wave 5A。Player Control Center 是 stage-local DOM owner，不是 `mazz.visual-composition/v1` 新 kind。确定性 Browser 主矩阵使用 renderer `DragEvent`；Playwright CDP pointer 路径虽已通过，但 CDP 不是 Win32 `SendInput`。Computer Use 在 W87f 按维护者要求禁用，本轮不以该工具作证；此前 GPU `0xC0000135` 阻断已由后续 clean rerun 解除。多显示器与多 DPI 全排列、真实 Win32 物理拖放、真实屏幕阅读器/触摸设备、第三方插件 UI、摄像头/麦克风许可、RDP/spacedesk/异机 GPU 和任意外部网页仍是条件矩阵。它们出现新证据时必须进入 W87 协议和回归账，不允许以“封板”名义拒绝修复，也不允许现在伪报已通过。
