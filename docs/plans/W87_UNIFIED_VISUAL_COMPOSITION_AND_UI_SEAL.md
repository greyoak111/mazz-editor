# W87 Unified Visual Composition / 全软件 UI 封板

> 状态：**COMPLETE / SUPPORTED-SCOPE SEALED**
> 日期：2026-08-19
> 起始坐标：`main@c125454`
> 原始修正材料：`C:\Users\Administrator\.codex\attachments\a4eebcc8-a823-4edd-8853-c512143d9092\pasted-text.txt`
> 来源 SHA-256：`ED8AF6DA040EEA93A04ECA93939BCB7941D2A5A11C6DAA0E922BC4EDCB4331B6`
> 实施检查点：[W87_UI_CONVERGENCE_CHECKPOINT_2026-08-19.md](../engineering/W87_UI_CONVERGENCE_CHECKPOINT_2026-08-19.md)

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

## 2. 不变量

1. 任何受支持的可见、可输入或可遮挡实体必须登记到 `mazz.visual-composition/v1`。
2. `window / panel-window / web-contents-view / dom-overlay` 使用同一注册表和显式 host。
3. DOM Overlay 先取得主进程遮挡确认再显示，避免弹层出现而原生 Surface 尚未退场的单帧穿帮。
4. 同一 host 的 Overlay 使用令牌引用计数；关闭一层不得提前恢复下层 WebContentsView。
5. 几何只接受有限数值和非负尺寸；渲染层不能把坏矩形传给原生 Surface。
6. 隐藏页签在隐藏前交还焦点，并以 `aria-hidden + inert` 同步隔离。
7. PanelWindow 的 logical host、native parent 和事件回派目标必须一致。
8. 本地 owner 的销毁仍是资源真相；VisualComposition 注销和 ResourceLedger 回基线均须成立。
9. Windows 已实证 workaround 保留，删除必须另有等价 packaged 探针和回滚证据。

## 3. 实施波次

| 子波 | 内容 | 退出门 |
|---|---|---|
| W87-0 | Predecessor/Backlog Gate；231 个一方 UI 文件、33 条 Surface 证据、24 类 PanelWindow 全量清单 | 清单可重复生成；旧 W71 判断显式 supersede |
| W87-1 | 纯 `VisualCompositionKernel` 与主进程 Runtime | kind/host/bounds/overlay token/来源退出收尸合同通过 |
| W87-2 | WindowManager、PanelWindows、BrowserViews 接入 | 所有正式 native surface 进入唯一注册表，local ownership 不迁移 |
| W87-3 | Renderer Global Overlay Plane、焦点/输入/尺寸档 | 嵌套遮挡引用计数、Escape/Tab 仲裁、焦点恢复通过 |
| W87-4 | 24 面板共享运行时、全局控件 SVG、主题/窄窗/QuickNote 收敛 | Panel runtime/CSP/shared CSS 全覆盖；正式控件无已知 emoji fallback |
| W87-5 | 源码与安装包真实 Electron 矩阵、截图人工复核、20× 生命周期、发布与全量回归 | 检查点全部为 GREEN |

## 4. 支持矩阵

本轮“封板”是以下可测试范围的封板，不是对未知硬件作不可证伪的零缺陷宣言：

- Windows 10 / Electron `33.4.11` 当前主机；
- 14 个主模块：Markdown、Text、Sheet、Slide、Code、Math、Notes、Search、Mindmap、Draw、Library、Viewer、Factory Desk、Organization；
- Paper / Ink 两个基底主题，且 computed token 与截图必须真实分化；
- 24 类原生面板；
- Browser WebContentsView 与嵌套 DOM Overlay；
- 主窗 `1280×800` 与最低支持窗口 `960×600`；
- 打包目录 `release/win-unpacked` 的真实运行路径。

## 5. 保留项

下列机制继续 `KEEP`：`invalidate`、±1px 双帧振荡、`backgroundThrottling:false`、reload convergence、drag cloak、pane move resync、native context menu、host-aware destroy、per-session protocol、safe graphics。W87 统一的是治理面，不以“架构更整齐”为由删除已实证平台药方。

## 6. Definition of Done

- 支持矩阵中已知 P0/P1 UI 缺陷为 0；
- 主模块与面板无 raw control emoji、无无名图标按钮、无主文档横向溢出；
- Paper/Ink 的 `--bg` 分别精确收敛为 `#f7f6f3` / `#16181d`；
- DOM Overlay 与 WebContentsView 嵌套遮挡引用计数通过，恢复后有真实 capture bytes；
- 所有 PanelWindow native parent 等于 logical host；
- 主进程 fatal log 与 renderer error 均为 0；
- 20 WebContentsView + 20 PanelWindow 全关后 ResourceLedger 回基线，工作集回落率均不低于 90%；
- 源码与 packaged UI E2E 均通过，packaged 至少连续两轮无竞态；
- 全量测试文件全部通过；
- 发布审计与 OSS provenance 为 CURRENT；
- 截图由施工方人工回看，不以测试生成文件存在冒充视觉验收。

## 7. 条件边界

多显示器、100/150/200% DPI 全排列、屏幕阅读器实机、触屏、摄像头/麦克风权限、RDP/虚拟显示驱动、第三方插件自绘 UI、任意用户内容和异机 GPU 仍是外部矩阵。它们不被伪写成已通过；一旦出现可复现问题，按 W87 协议归属到统一 host/geometry/focus/occlusion/lifecycle 之一处理，不再新增模块私有视觉补丁。
