# W71 Surface / Protocol Reality / Workaround Register

> **2026-08-19 supersession：** W71 draft 已由 W87 `mazz.visual-composition/v1` 吸收。统一视觉注册/host/geometry/focus/occlusion 已落地，但 WindowManager、PanelWindows、BrowserViews 仍分别持有资源；本文 workaround register 全部继续 KEEP。现行证据见 [`W87_UI_CONVERGENCE_CHECKPOINT_2026-08-19.md`](./W87_UI_CONVERGENCE_CHECKPOINT_2026-08-19.md)。

> 状态：Wave 0 现实清单与 `Surface v1` 接口草案
> 决策：不实施 SurfaceManager，不迁移现有 Surface，不删除 workaround
> 机器证据：[`../../.mazz/audit/surface-census.json`](../../.mazz/audit/surface-census.json)

## Surface inventory

| Surface 家族 | owner | host / move | destroy | ResourceLedger |
|---|---|---|---|---|
| 主 BrowserWindow | WindowManager | OS 顶层窗 | `closed` | `browser-window` |
| 分离 BrowserWindow | WindowManager | OS 顶层窗；接收 handoff | `closed`，并触发 `destroyByHost` | `browser-window` |
| Quick Note | WindowManager | always-on-top 独立窗 | `closed` | `browser-window` |
| Print worker | `print:html` + WindowManager 观测 | 隐藏离屏打印窗 | `finally → destroy` | `browser-window` |
| 25 类 PanelWindow | PanelWindows | parent/main；部分 follow/drag/stair | 统一 `_prepare` + `closed` | `panel-window` |
| Browser WebContentsView | BrowserViews | 调用窗 `contentView`；pane/window 后同步 bounds | `destroy` / `destroyByHost` / webContents destroyed | `web-contents-view` |
| DevTools / Menu / system dialog | Electron / OS | 不属于 Mazz 统一 Surface owner | Electron/OS | 暂不纳入业务对象数 |

已识别持久会话：`persist:mazz-browser`、`persist:mazz-author`；动态 BrowserView partition 仍由 tab spec 指定。`mazz-res` 必须对独立 browser session 单独注册，默认 session 不能代表所有 partition。

## Protocol reality

- ownership：WindowManager、PanelWindows、BrowserViews 各有成熟局部 owner；不存在统一 SurfaceManager；
- host：WebContentsView 通过 `BrowserWindow.fromWebContents(event.sender)` 确认宿主并记录 `hostWin`；
- move：渲染层完成 Pane/Window handoff 后，原生视图通过 bounds/recompose/invalidate convergence 收敛；不得网络 reload；
- destroy：局部 owner 的 `closed/destroy/destroyByHost` 是权威路径，ResourceLedger 只观察，不持有资源；
- recovery：render gone、unresponsive 与隐显合成恢复已经存在多条平台专用路径。

## Surface v1 interface draft

```text
create(spec, host)
attach(host)
setBounds(rect, visible)
focus()
snapshot()
move(nextHost)
dispose(reason)

events:
ready / state / crashed / unresponsive / disposed
```

不变量：单一 owner、单一当前 host；dispose 幂等；move 带代际保护且可回滚；关闭后资源数回到操作前基线；既有 workaround 在适配器内部保留。此草案只用于对照现实现，不是迁移授权。

## Workaround register

| ID | owner | 当前决定 | 删除前证据 |
|---|---|---|---|
| WKR-BV-INVALIDATE | BrowserViews | KEEP | Windows packaged 隐→显像素与状态探针 |
| WKR-BV-BOUNDS-OSCILLATION | BrowserViews | KEEP | 去除后多轮 D3D/多 DPI 无白屏且可回滚 |
| WKR-BACKGROUND-THROTTLING | WindowManager/BrowserViews | KEEP | Recorder 长录与遮挡 Surface 均不断帧 |
| WKR-RELOAD-CONVERGENCE | Browser module | KEEP | Home/about:blank 与普通 URL 同时通过 |
| WKR-DRAG-CLOAK | Shell/BrowserViews/VisualComposition | KEEP | 同宿主全部可见 WCV 已 capture/decode/双 RAF 预绘；`tabId/webContentsId` 集合校验一致；代理 computed `pointer-events:none` 且 `elementFromPoint` 命中 pane；四方向预览、一次真实 drop、像素恢复及 20 次循环通过 |
| WKR-PANE-MOVE-RESYNC | Shell/Browser | KEEP | Pane/Window 迁移后 bounds、像素、导航稳定 |
| WKR-NATIVE-CONTEXT-MENU | BrowserViews | KEEP | 不引回 DOM/native layering 白屏 |
| WKR-HOST-AWARE-DESTROY | WindowManager/BrowserViews | KEEP | 宿主关闭 20 次无幽灵 view/webContents |
| WKR-PER-SESSION-PROTOCOL | Main/session | KEEP | 每个 partition 的 `mazz-res` packaged probe |
| WKR-SAFE-GRAPHICS | Main startup | KEEP | 远程/虚拟显示驱动矩阵无 GPU 崩溃弹窗 |

所有条目删除条件相同：等价 Windows packaged-runtime 探针先通过，修改影响面和回滚路径有记录。当前没有任何条目满足删除 Gate。

`WKR-DRAG-CLOAK` 是“代理先行 → 身份校验 → 临时遮挡 → 像素恢复”的复合事务；`hidden/0×0` 本身永远不是 PASS，renderer 截图也不能单独证明 WebContentsView 像素存在。

## 决策

现有局部 owner 已能接入统一账本，尚无证据证明必须重构成 SurfaceManager 才能关闭 P0/P1。因此 W71 继续双轨观测与 20 次循环，不启动全量迁移；若未来出现无法由现 owner 关闭的 P0/P1，再单独申请一个 Surface Adapter PoC。
