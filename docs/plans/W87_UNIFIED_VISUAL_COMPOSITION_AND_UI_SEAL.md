# W87 Unified Visual Composition / 全软件 UI 封板

> 状态：**W87a–f EXECUTED SCOPE SEALED；W71 COMPLETE WAVE 5A OPEN**
> 日期：2026-08-19（2026-08-20 W87e 修订）
> 起始坐标：`main@c125454`
> 原始修正材料：`C:\Users\Administrator\.codex\attachments\a4eebcc8-a823-4edd-8853-c512143d9092\pasted-text.txt`
> 来源 SHA-256：`ED8AF6DA040EEA93A04ECA93939BCB7941D2A5A11C6DAA0E922BC4EDCB4331B6`
> 实施检查点：[W87_UI_CONVERGENCE_CHECKPOINT_2026-08-19.md](../engineering/W87_UI_CONVERGENCE_CHECKPOINT_2026-08-19.md)
> Player 响应式增量：[W87E_PLAYER_CONTROL_SURFACE_CHECKPOINT_2026-08-20.md](../engineering/W87E_PLAYER_CONTROL_SURFACE_CHECKPOINT_2026-08-20.md)
> Sidebar / Player 几何增量：[W87F_SIDEBAR_PLAYER_LAYOUT_CHECKPOINT_2026-08-20.md](../engineering/W87F_SIDEBAR_PLAYER_LAYOUT_CHECKPOINT_2026-08-20.md)

## 1. 决策

W71 当时依据“代表性 P0/P1 已由局部 owner 关闭”冻结 SurfaceManager PoC；该结论在当时证据下成立。此后 Browser 原生 Surface 遮挡、DOM 弹层、宿主归属、几何、焦点和瞬时面板竞态再次以同一病系出现，且维护者明确要求全软件 UI 收敛。W87 因而满足旧报告规定的启动条件。

本波不把全部资源 owner 重写成万能 SurfaceManager。落地的是更小而完整的统一视觉合成运行时：

```text
WindowManager / PanelWindows / BrowserViews / DOM Overlay
                         ↓
              VisualCompositionRuntime
       registry · host · geometry · focus · occlusion
                         ↓
              ResourceLedger（独立验收）
```

本地 owner 继续创建、迁移和销毁真实资源；统一运行时只持有视觉注册、宿主关系、遮挡令牌、几何快照和焦点仲裁。这样既消除各模块私自 cloak 的分叉，又不冒险一次性重构成熟生命周期。

2026-08-20 的 Player 窄分屏复核又暴露了另一类此前未纳入 W87a–d 复合矩阵的布局债：DOM 控制条在组件容器内的渐进收缩。W87e 采用 Player stage-local owner 关闭第一参考切片，并已完成 source/packaged Electron 复封。随后 W87f 又关闭 Workspace Sidebar 八页签窄栏溢出与空 Player 收栏残余右偏移。两者都不是新的全局 Surface kind，也不改写 W87a–d 已通过的 Browser/Panel 合成结论；W71 完整 Wave 5A 仍为 OPEN。

## 2. 不变量

1. 任何进入跨 host 合成、能够遮挡 native Surface 或拥有独立 native window 的受支持实体必须登记到 `mazz.visual-composition/v1`；严格限制在模块 DOM stage 内的普通控件仍由 local owner 管理。
2. `window / panel-window / web-contents-view / dom-overlay` 使用同一注册表和显式 host。
3. DOM Overlay 先取得主进程遮挡确认再显示，避免弹层出现而原生 Surface 尚未退场的单帧穿帮。
4. 同一 host 的 Overlay 使用令牌引用计数；关闭一层不得提前恢复下层 WebContentsView。
5. 几何只接受有限数值和非负尺寸；渲染层不能把坏矩形传给原生 Surface。
6. 隐藏页签在隐藏前交还焦点，并以 `aria-hidden + inert` 同步隔离。
7. PanelWindow 的 logical host、native parent 和事件回派目标必须一致。
8. 本地 owner 的销毁仍是资源真相；VisualComposition 注销和 ResourceLedger 回基线均须成立。
9. Windows 已实证 workaround 保留，删除必须另有等价 packaged 探针和回滚证据。
10. Browser 拖拽 capture 必须由 main 依据 IPC sender 反解真实 host；renderer 不能自报权威 WCV 清单。
11. `captureVisibleHost` 捕获前后可见集合、`tabId/webContentsId` 与 native bounds 必须精确一致；非活动 source 必须先激活并等待布局稳定。
12. 全部代理 decode/预绘后须按当前 DOM 几何 relayout；Overlay 激活再复核身份全集，成功后才允许 cloak。
13. proxy/frame/gradient 必须 pointer-through；渐变只过渡 opacity，几何不得使用 `transition:all`。
14. 有效 drop 后 pane 数必须恰增 1，source 在 pane tree 中恰有一个 owner；恢复必须等待 native visible/bounds Gate 后再撤代理。
15. 纯 DOM、严格限制在模块 stage 内且不遮挡 native Surface 的控制面由模块 local owner 管理；不能为了“统一”强行登记成全局 Surface kind。
16. 密集控件条必须按组件容器而非 viewport 分档；能力降级只能移动同一真实节点，不能复制 handler 或状态。

## 3. 实施波次

| 子波 | 内容 | 退出门 |
|---|---|---|
| W87-0 | Predecessor/Backlog Gate；231 个一方 UI 文件、33 条 Surface 证据、24 类 PanelWindow 全量清单 | 清单可重复生成；旧 W71 判断显式 supersede |
| W87-1 | 纯 `VisualCompositionKernel` 与主进程 Runtime | kind/host/bounds/overlay token/来源退出收尸合同通过 |
| W87-2 | WindowManager、PanelWindows、BrowserViews 接入 | 所有正式 native surface 进入唯一注册表，local ownership 不迁移 |
| W87-3 | Renderer Global Overlay Plane、焦点/输入/尺寸档 | 嵌套遮挡引用计数、Escape/Tab 仲裁、焦点恢复通过 |
| W87-4 | 24 面板共享运行时、全局控件 SVG、主题/窄窗/QuickNote 收敛 | Panel runtime/CSP/shared CSS 全覆盖；正式控件无已知 emoji fallback |
| W87-5 | 源码与安装包真实 Electron 矩阵、截图人工复核、20× 生命周期、发布与全量回归 | 检查点全部为 GREEN |
| W87b–d 复开 | 复杂 Browser/child/Panel 复合矩阵、无框渐隐、跨渲染面代理帧交接 | 六组 source/packaged × hardware/compatibility/light 全 PASS；三块同时 Surface、实际 topology/owner、pointer-through 和恢复账通过 |
| W87e Player Control Surface | Player stage-local L/M/S/XS、同节点 More、侧栏 preferred/effective、焦点/锁定/ARIA/lifecycle | Node `13/13`、lifecycle `4/4`、P1 加固后 source/packaged Electron、12 宽度档与 20× ownership 全 PASS |
| W87f Sidebar / empty Player geometry | Sidebar `4×2` + container density；空 Player 与 controls 共用 side-open 真值 | source/packaged：`180/232/320px`、开关侧栏 20×、fatal/error 0；全 PASS |

## 4. 支持矩阵

本轮“封板”是以下可测试范围的封板，不是对未知硬件作不可证伪的零缺陷宣言：

- Windows 10 / Electron `33.4.11` 当前主机；
- 14 个主模块：Markdown、Text、Sheet、Slide、Code、Math、Notes、Search、Mindmap、Draw、Library、Viewer、Factory Desk、Organization；
- Paper / Ink 两个基底主题，且 computed token 与截图必须真实分化；
- 24 类原生面板；
- Browser WebContentsView 与嵌套 DOM Overlay；
- Browser 复合链包含主窗多 WCV、工作台 child、child Panel、五轮盖顶、非活动 source、三块同时可见 Surface 与四方向分屏；
- Browser 最终矩阵包含 source/packaged 各自 hardware Ink、compatibility Ink、hardware Construct light，共六组；
- 主窗 `1280×800` 与最低支持窗口 `960×600`；
- 打包目录 `release/win-unpacked` 的真实运行路径。

W87e 的目标组件宽度矩阵为 `1200 / 960 / 959 / 900 / 720 / 600 / 599 / 560 / 440 / 439 / 420 / 320 px`，现已在 P1 加固后的 source 与 packaged Electron 中通过；8 张图与两个 JSON 已由最终代码重新生成。W87f 另覆盖 Workspace Sidebar `180 / 232 / 320px` 与空 Player 侧栏 20 轮开关。

## 5. 保留项

下列机制继续 `KEEP`：`invalidate`、±1px 双帧振荡、`backgroundThrottling:false`、local recompose convergence、drag cloak、pane move resync、native context menu、host-aware destroy、per-session protocol、safe graphics。W87 统一的是治理面，不以“架构更整齐”为由删除已实证平台药方；Pane/Window 迁移不得以网络 reload 求收敛。W87d 追加限制：drag cloak 前必须由 main sender-host `captureVisibleHost` 完成瞬时集合/身份/几何精确校验，并为全部可见 WCV 完成代理帧解码、双帧预绘和 relayout；Overlay 激活门复核身份全集后才可 cloak。恢复后必须以 native visible/bounds Gate 再撤代理；直接 cloak 不再是合法路径。

## 6. Definition of Done

- 支持矩阵中已知 P0/P1 UI 缺陷为 0；
- 主模块与面板无 raw control emoji、无无名图标按钮、无主文档横向溢出；
- Paper/Ink 的 `--bg` 分别精确收敛为 `#f7f6f3` / `#16181d`；
- DOM Overlay 与 WebContentsView 嵌套遮挡引用计数通过，恢复后有真实 capture bytes；
- Browser 六组 source/packaged × hardware/compatibility/light 矩阵全部通过；
- 三块同时可见 Browser Surface 的 capture 集合、身份与 PNG hash 一一对应；capture 前后集合、`tabId/webContentsId`、bounds 精确一致；
- 非活动 source 先激活；代理 relayout 与 Overlay 身份 Gate 通过；proxy/gradient 四方向 pointer-through，几何无 `transition:all`；
- 有效 drop 后 pane 数恰增 1、source 只有一个 owner；原 WCV 在最终 bounds visible 后代理才撤销；
- 所有 PanelWindow native parent 等于 logical host；
- 主进程 fatal log 与 renderer error 均为 0；
- 20 WebContentsView + 20 PanelWindow 全关后 ResourceLedger 回基线，工作集回落率均不低于 90%；
- 源码与 packaged UI E2E 均通过，packaged 至少连续两轮无竞态；
- 全量测试 `222/222` 个文件通过；
- 发布审计与 OSS provenance 为 CURRENT；
- 截图由施工方人工回看，不以测试生成文件存在冒充视觉验收。

上列 DoD 记录的是 W87a–f 已执行范围。W87e/W87f 的附加 DoD 以独立检查点为准：20 轮 resize/ownership 或侧栏开关 convergence 不得写成真实媒体打开关闭、内存回落或媒体 soak；Player 与 Workspace Sidebar 完成也不替代 Shell、Sheet、Browser、Factory、Library 的完整 Wave 5A 推广。

## 7. 条件边界

确定性 Browser 主矩阵使用 renderer `DragEvent`；额外 Playwright CDP pointer 已通过，但 CDP 不是 Win32 `SendInput`。Computer Use 因另一路工具故障在 W87f 明确禁用，本轮所有结论只来自 Electron E2E、截图与几何证据；不能用工具失败判产品失败或通过。此前 W87e 的 GPU `0xC0000135` 阻断已在后续干净重跑中解除。多显示器、100/150/200% DPI 全排列、真实 Win32 物理拖放、屏幕阅读器实机、触屏、摄像头/麦克风权限、RDP/虚拟显示驱动、第三方插件自绘 UI、任意用户内容和异机 GPU 仍是外部矩阵。它们不被伪写成已通过；一旦出现可复现问题，按 W87 协议归属到统一 host/geometry/focus/occlusion/lifecycle 之一处理，不再新增模块私有视觉补丁。
