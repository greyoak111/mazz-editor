# W87b Browser 复合分屏 / 子窗 / 拖拽 Surface 收敛检查点

> 日期：2026-08-19  
> 起始坐标：`main@cd90a9a`  
> 结论：**SUPPORTED COMPOSITE MATRIX RESEALED；该矩阵已知 P0/P1 = 0**  
> 协议：`mazz.visual-composition/v1`

> 2026-08-19 修订：彩色锚线由 W87c 根除；随后维护者实机证明“拖拽期间全 Browser hidden”会留下空白网页区。W87b 的跨 renderer ID、宿主、迁移、几何与 child/Panel 结论继续有效，但拖拽视觉连续性已由 [`W87D_BROWSER_DRAG_VISUAL_CONTINUITY_CHECKPOINT_2026-08-19.md`](./W87D_BROWSER_DRAG_VISUAL_CONTINUITY_CHECKPOINT_2026-08-19.md) supersede：最终路径由 main 按 IPC sender-host 原子捕获可见 Surface，在代理预绘、身份集合复核与 relayout 完成后才 cloak。

## 1. 为什么必须重开 W87

原 W87 证明了模块、主题、Panel、单个 WebContentsView、Overlay 和最低窗口等单轴矩阵，但没有把以下状态同时压在一条运行链上：

```text
主工作台多个 Browser
+ Browser 标签迁入工作台子窗
+ 主/子窗交替盖顶
+ 已有复杂分屏再次拖拽分屏
+ PanelWindow 从子窗盖顶再关闭
```

这使“支持矩阵内已知 P0/P1=0”的旧表述覆盖面过宽。新 RED 合同最初为 `0/5`，硬件 Electron 首轮直接报出 `cross-window WebContentsView id collision: bt-1`；因此本轮不是视觉微调，而是对原封板缺口的正式 supersession。

## 2. 已关闭的根因

| 根因 | 旧行为 | 收敛 |
|---|---|---|
| 跨 renderer ID 冲突 | 每个工作台 renderer 都从 `bt-1` 起号，子窗创建同名 View 时主进程把主窗 View 当 `replaced` 销毁 | Browser View 改用跨 renderer UUID；恢复只操作目标 `ctl`，不再经全局 `current/MazzCommands` 串窗 |
| 只遮 active Browser | 复杂分屏有多个可见 WCV；只 cloak active 会被其他原生面盖住，而立即全 cloak 又会露空底 | IPC sender 锁定真实 host；main 原子捕获全部应可见 WCV 的集合、身份、几何和像素；renderer 预绘/relayout 后由 Overlay 激活门复核身份集合，再统一 cloak |
| 非活动 source 漏捕 | document capture 阶段早于 Tabs 自身写入 DataTransfer；拖非活动 Browser 外壳签时，capture 可能只看到旧 active Surface | tab DOM 暴露稳定 `data-tab-id`；拖拽捕获相先激活 source，等待两帧完成布局和 bounds 写回，再调用 `captureVisibleHost` |
| 代理挡输入 / 几何扫带 | 通用 Overlay 规则可能把代理恢复为可输入；`transition:all` 会令 0×0 渐变从页面原点插值扫过 | proxy/frame/gradient 均 pointer-through，`elementFromPoint` 仍命中 pane；只过渡 opacity，几何一帧直达 |
| 迁移前提前解遮挡 | `drop` 先 cleanup，再 split；旧 Surface 会在旧矩形短暂复活 | 有效 drop 保持 cloak/token，先迁移，连续两帧布局稳定后才按新矩形一次性复活 |
| 分屏靠网络 reload 重画 | `pane:tabMoved` 强制 reload，页面内存态、登录态、离线页会丢并产生白帧 | 增加 `bv:recompose`，只做 bounds + invalidate + compositor 振荡，不触碰网络文档 |
| 旧延迟帧回写旧几何 | 60/180ms 振荡 timer 捕获旧矩形，快速再次分屏后仍可能把 WCV 写回旧 bounds | 每次几何重组递增 `compositionGen`；timer 同时核对 generation 和当前 desiredRect，陈旧回调自动失效 |
| 子窗裸壳先显示 | `ready-to-show` 只证明工作台 DOM 可画，Browser handoff 尚未恢复 | 带 handoff 的 child 使用 `deferShow`，只有目标 renderer ACK 后才 show/focus/recompose |
| Panel 首帧与焦点错宿主 | 普通透明 Panel 创建即显示；从 child 打开后关闭仍强制 focus main | 全部普通 Panel 等 `ready-to-show`；关闭按 `__panelHost` 归还真实宿主，show/close/rehost 后刷新该 host |
| 迟到主页覆盖真网页 | HOME 的 `document.write` IPC 不在导航队列内；真网页先加载后又被迟到主页重写，Window 属性残留令状态探针假绿 | `renderHome` 变为可等待任务并纳入 `queueNav`；像素证据不再被 JS 残留欺骗 |

保留但收窄的 Windows 药方：`backgroundThrottling:false`、`invalidate()`、±1px 双帧振荡、drag cloak、host-aware destroy、per-session protocol 与 native context menu。没有用 workaround B 替换 workaround A，也没有一次性迁移全部 Surface owner。

## 3. 新增复合验收矩阵

自动化入口：`tests/e2e/w87-browser-composition-matrix.mjs`。

每轮固定执行：

1. 主窗打开 Browser A/B，将 B 交接到 child，证明三个 WCV ID/host 不冲突；
2. 主/子工作台交替 show/focus 五轮，两个 WCV 始终可执行、可见且归各自宿主；
3. 主窗再开 Browser C，先分屏，再用受控 renderer `DragEvent` 将 C 拖入另一侧；drop 后 pane 数必须恰增 1，C 在 pane tree 中恰有一个 owner；
4. main 通过 sender-host `captureVisibleHost` 捕获全部可见 WCV，capture 前后集合、`tabId/webContentsId` 和 bounds 完全一致；代理 PNG hash 必须与各自 WCV 一一相同；
5. 代理完成 decode、双帧 paint 与当前 DOM 几何 relayout 后，Overlay 激活门再次验证身份全集，随后主宿主 WCV 才可 hidden；
6. proxy/gradient 必须 pointer-through，四方向 `elementFromPoint` 均仍命中 pane；渐变没有 `transition:all`；
7. drop 后两页 JS 内存标记不丢、网络文档不 reload、native bounds 与 DOM bounds 四项误差不超过 2 px；
8. 再建立第三块同时可见 Browser Surface；三帧集合、像素 hash、恢复状态和 Overlay 账全部通过；
9. 从 child 打开 Settings Panel，native parent/logical host 均为 child；Panel 首帧完成，底下 Browser 仍活；关闭后焦点回 child；
10. 分别经 `bv:capture` 获取 mainA/mainC/mainD/childB 独立 WCV 像素，不用只看抓不到原生子 Surface 的 renderer CDP 截图冒充画面证据；
11. 主进程 fatal 与全部 renderer `pageerror/console.error` 必须为 0。

## 4. 实证结果

| 运行形态 | GPU / 主题 | 结果 |
|---|---|---|
| Source Electron | hardware / Ink | PASS |
| Source Electron | compatibility / Ink | PASS |
| Source Electron | hardware / Construct light | PASS |
| `release/win-unpacked` | hardware / Ink | PASS |
| `release/win-unpacked` | compatibility / Ink | PASS |
| `release/win-unpacked` | hardware / Construct light | PASS |

最终 W87d 六组矩阵均为 PASS；全量测试为 `221/221`。像素结果必须按整窗与独立 Surface 分开：

```text
整窗拖拽 Ink colorfulRatio        ≈ 0.5665–0.5666
整窗拖拽 Construct colorfulRatio  ≈ 0.9100–0.9128
独立 WCV colorfulRatio            ≈ 0.924–0.988
整窗 whiteRatio                   ≈ 0.0072–0.0075
fatal / renderer errors = 0 / 0
```

核心机器证据：

- [`W87B_BROWSER_COMPOSITION_SOURCE_HARDWARE_W87D.json`](./evidence/W87B_BROWSER_COMPOSITION_SOURCE_HARDWARE_W87D.json)
- [`W87B_BROWSER_COMPOSITION_SOURCE_COMPATIBILITY_W87D.json`](./evidence/W87B_BROWSER_COMPOSITION_SOURCE_COMPATIBILITY_W87D.json)
- [`W87B_BROWSER_COMPOSITION_SOURCE_HARDWARE_W87DLIGHT.json`](./evidence/W87B_BROWSER_COMPOSITION_SOURCE_HARDWARE_W87DLIGHT.json)
- [`W87B_BROWSER_COMPOSITION_PACKAGED_HARDWARE_W87D.json`](./evidence/W87B_BROWSER_COMPOSITION_PACKAGED_HARDWARE_W87D.json)
- [`W87B_BROWSER_COMPOSITION_PACKAGED_COMPATIBILITY_W87D.json`](./evidence/W87B_BROWSER_COMPOSITION_PACKAGED_COMPATIBILITY_W87D.json)
- [`W87B_BROWSER_COMPOSITION_PACKAGED_HARDWARE_W87DLIGHT.json`](./evidence/W87B_BROWSER_COMPOSITION_PACKAGED_HARDWARE_W87DLIGHT.json)
- [`W87D_BROWSER_CDP_POINTER_AFTER_DROP_HARDWARE.json`](./evidence/W87D_BROWSER_CDP_POINTER_AFTER_DROP_HARDWARE.json)（其 `input` 明示为 Playwright CDP pointer，不是 Win32 `SendInput`）
- [`W87D_BROWSER_CDP_POINTER_DURING_DRAG_HARDWARE.png`](./evidence/W87D_BROWSER_CDP_POINTER_DURING_DRAG_HARDWARE.png)
- [`W87D_BROWSER_CDP_POINTER_AFTER_DROP_HARDWARE.png`](./evidence/W87D_BROWSER_CDP_POINTER_AFTER_DROP_HARDWARE.png)

额外回归：W87 全 UI 源码矩阵重新完成 14 模块双主题、24 Panel、native overlay 与最低窗口，fatal/error=`0/0`；最终全量 `221/221` 个测试文件通过；OSS provenance=`CURRENT`，release audit=`PASS`。

## 5. 封板边界

本检查点只重新封住已执行的 Windows 10 / Electron 33、六组 source/packaged 图形与主题矩阵、主窗多 Browser、工作台 child、Panel child 与拖拽分屏组合。确定性主矩阵使用 renderer `DragEvent`；额外 Playwright CDP pointer 路径已通过 pointer-through 与真实 pane topology/owner，但 CDP 不是 Win32 SendInput。

Computer Use 因 `0x80004002` 无法捕获 frameless Electron 窗口；该工具失败既不是产品失败证据，也不是产品通过证据。Win32 物理输入、RDP hard-safe、多显示器跨 DPI 拖窗、睡眠恢复、第三方网页自身崩溃和异机驱动仍是条件矩阵；出现新证据必须重开，不得再用“W87 已封板”拒绝复现。
