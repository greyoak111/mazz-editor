# W87d Browser 拖拽分屏跨渲染面视觉连续性检查点

> 日期：2026-08-19
> 起始坐标：`main@0dc3dcf`
> 结论：**Browser 拖拽分屏不再以“WCV 已隐藏”冒充通过；代理帧在位前不 cloak，原生面复活前不撤代理**
> 继承：`mazz.visual-composition/v1`、W87b 复合 Surface、W87c 无框纯渐隐

## 1. 用户现场与根因

Browser 工具栏和页签属于 renderer DOM，网页正文属于独立 `WebContentsView`。旧路径在 `dragstart` 立即对当前宿主全部 WCV 执行 `_dragCloak`，Visual Composition 的 host occlusion 又将原生面置为 `hidden + 0×0`；随后 DOM 渐变实际画在空的 `.br-view-host` 背景上。因此“工具栏仍在、网页区整块白/灰、渐变存在”不是网页加载失败，而是两个渲染面之间没有视觉交接。

W87b 旧矩阵把 `states.every(hidden)` 当作 GREEN，renderer screenshot 又天然抓不到 WCV；drop 后的 `bv:capture` 只能证明客页进程仍可产出像素，不能证明拖拽期间用户看到了网页。W87c 只删除彩色锚线，没有关闭这条白屏链。两份旧结论均由本检查点精确修订。

## 2. 收敛方案

本轮没有直接复活 dormant `splitpreview` 原生透明子窗。它需要重新证明 Win32 真实拖放命中、输入穿透、跨 WebContents 回派、child/rehost、DPI/RDP 和崩溃收尸；历史合成 `DragEvent` 不能承担这些结论。

当前主线使用最后可见帧代理事务：

```text
IDLE
→ CAPTURING（WCV 保持可见）
→ DECODED + APPENDED + TWO-RAF PAINTED
→ ACTIVE（代理已覆盖，才登记 overlay token 并 cloak WCV）
→ RESTORING（先释放 token、uncloak、recompose）
→ WCV 在最终 bounds 明确 visible
→ REMOVE PROXY
→ IDLE
```

捕获集合不再由 renderer DOM 猜测。renderer 通过 `bv:captureVisibleHost` 请求快照，主进程用 IPC `event.sender` 反解真实发送宿主，并从 BrowserViews 的 native owner 账中原子枚举该宿主全部 `desiredVisible && !occluded` WCV。每一帧携带 `tabId + webContentsId + bounds + PNG`；capture 前后再次精确比较集合、原生身份和几何，任一变化即整批拒绝，禁止部分代理后再做 host-wide cloak。

若拖起的是某窗格中的非活动 Browser 外壳标签，Shell 会先激活该 source，再等待两帧让 DOM 和同 sender 的 bounds 写回稳定，然后才请求主进程捕获。全部图片 decode、节点进入统一 overlay plane 并完成两帧绘制后，代理会按 renderer 当前几何再 `relayout`；Overlay 激活时主进程重新核对将被遮挡的 `tabId + webContentsId` 身份集合。这样既不拿两帧间合法的 1px 舍入漂移制造假拒绝，也不允许漏掉第三块 Surface 后全宿主遮挡。

渐变仍由现有 DOM DnD 路线负责，所以多窗格分区、drop 与无框纯渐隐语义不变；页面不 reload，URL、JS 内存态和滚动上下文继续属于原 WCV。代理、代理图片和渐变均为 `pointer-events:none`；自动化同时验证 `elementFromPoint` 仍命中目标 pane。渐变几何一帧直达目标区，只允许 `transition:opacity`，禁止 `transition:all` 从页面原点扫出色带。

任一 capture/decode/会话校验失败会进入 `degraded-visible`：不挂 overlay token、不 cloak、不提交本次分屏。恢复没有“超时后硬撤图”的出口；只要相应 DOM host 仍应可见，就持续在代理下重组并等待 native state 回到 `!hidden && !occluded && bounds>2`。已经关闭、换成非活动签或离开本宿主的旧 Surface 不再阻塞释放。

## 3. 不变量与回归合同

1. capture 请求必须按 IPC sender 锁定真实宿主；renderer 不能提交“可见 WCV 权威清单”。
2. capture 前后集合、`tabId/webContentsId` 身份和 native bounds 必须精确一致；任一帧缺失即整批失败。
3. 非活动 source 必须先激活并等待布局稳定，再开始 host capture。
4. `capture → decode all → append → two RAF → relayout → overlay identity gate → cloak`，顺序不可颠倒。
5. 捕获期间 `dragover` 只保存最后 zone，不能提前 mount overlay 制造白洞。
6. 捕获、解码或 Overlay 激活失败必须 fail visible；无 `active` 代理的 drop 不得修改分屏树。
7. `release token → uncloak → recompose → visible + pixel gate → remove proxy`，不得用固定超时绕过恢复门。
8. 新 drag 在旧 restoration 完成前被拒绝；watchdog、pointerup、blur、dragend 共用同一 cleanup。
9. 代理与图片均 `pointer-events:none`、无 border/outline/shadow；pointer-through 后 pane 仍可命中。
10. 渐变只允许 `transition:opacity`；left/top/width/height 不得参加过渡。
11. 有效 drop 必须令 pane 数恰增 1，且 source tab 在 pane tree 中恰有一个 owner。
12. 合同进入 `tests/run.js`；旧 W55/W56/W57/W71 测试不再把“先 cloak”或 `body > div` 结构猜测写成成功标准。

## 4. 已执行矩阵

| 运行形态 | 图形模式 / 主题 | 结果 |
|---|---|---|
| Source Electron | hardware / Ink | PASS |
| Source Electron | compatibility / Ink | PASS |
| Source Electron | hardware / Construct(Paper) | PASS |
| `release/win-unpacked` | hardware / Ink | PASS |
| `release/win-unpacked` | compatibility / Ink | PASS |
| `release/win-unpacked` | hardware / Construct(Paper) | PASS |

六组 `source/packaged × hardware/compatibility/Construct light` 均为 PASS；全量测试为 `221/221`。

复合矩阵同时覆盖：主窗两个 Browser WCV、工作台 child、主/子窗五轮盖顶、右/下/左/上快速换区、实际 pane topology 与单一 tab owner、drop 后页面内存态守恒、图片解码失败注入和 20 次取消循环。随后再建立第三块同时可见 Browser Surface，验证三帧捕获集合、代理身份和 PNG SHA-256 一一相同，取消后三个 native Surface 与 Overlay 账全部恢复。

像素口径必须分开：整窗拖拽复合截图 Ink 的 `colorfulRatio≈0.5665–0.5666`，Construct 浅色约 `0.9100–0.9128`；独立 WCV 原生抓帧约 `0.924–0.988`。整窗 `whiteRatio≈0.0072–0.0075`；main fatal / renderer error=`0/0`。代理、data URI、overlay token、cloak 与拖拽 class 在每轮结束时归零。

直接对应维护者浅色现场的证据：

- [`W87B_BROWSER_COMPOSITION_SOURCE_HARDWARE_W87DLIGHT.json`](./evidence/W87B_BROWSER_COMPOSITION_SOURCE_HARDWARE_W87DLIGHT.json)
- [`W87B_BROWSER_DRAG_SOURCE_HARDWARE_W87DLIGHT.png`](./evidence/W87B_BROWSER_DRAG_SOURCE_HARDWARE_W87DLIGHT.png)
- [`W87B_BROWSER_COMPOSITION_PACKAGED_HARDWARE_W87DLIGHT.json`](./evidence/W87B_BROWSER_COMPOSITION_PACKAGED_HARDWARE_W87DLIGHT.json)
- [`W87B_BROWSER_DRAG_PACKAGED_HARDWARE_W87DLIGHT.png`](./evidence/W87B_BROWSER_DRAG_PACKAGED_HARDWARE_W87DLIGHT.png)

其余机器证据：

- [`W87B_BROWSER_COMPOSITION_SOURCE_HARDWARE_W87D.json`](./evidence/W87B_BROWSER_COMPOSITION_SOURCE_HARDWARE_W87D.json)
- [`W87B_BROWSER_COMPOSITION_SOURCE_COMPATIBILITY_W87D.json`](./evidence/W87B_BROWSER_COMPOSITION_SOURCE_COMPATIBILITY_W87D.json)
- [`W87B_BROWSER_COMPOSITION_PACKAGED_HARDWARE_W87D.json`](./evidence/W87B_BROWSER_COMPOSITION_PACKAGED_HARDWARE_W87D.json)
- [`W87B_BROWSER_COMPOSITION_PACKAGED_COMPATIBILITY_W87D.json`](./evidence/W87B_BROWSER_COMPOSITION_PACKAGED_COMPATIBILITY_W87D.json)
- [`W87D_BROWSER_CDP_POINTER_AFTER_DROP_HARDWARE.json`](./evidence/W87D_BROWSER_CDP_POINTER_AFTER_DROP_HARDWARE.json)（`input` 明示为 Playwright CDP pointer，不是 Win32 `SendInput`）
- [`W87D_BROWSER_CDP_POINTER_DURING_DRAG_HARDWARE.png`](./evidence/W87D_BROWSER_CDP_POINTER_DURING_DRAG_HARDWARE.png)
- [`W87D_BROWSER_CDP_POINTER_AFTER_DROP_HARDWARE.png`](./evidence/W87D_BROWSER_CDP_POINTER_AFTER_DROP_HARDWARE.png)

## 5. 诚实边界

代理帧在一次短拖拽期间是冻结画面；视频不会白，但该几十到数百毫秒窗口内不是实时帧。DRM、受保护硬件 overlay 或极端显存压力可能使 `capturePage` 失败，此时产品会保持原 WCV 可见并取消本次预览，而不是回退白屏。

确定性矩阵使用 renderer `DragEvent` 验证状态机、像素、身份、几何、topology 和 owner；另一次 Playwright CDP pointer 拖拽也已通过，并证明代理的 pointer-through 没有挡住 pane 命中和 drop。但 CDP pointer 仍不是 Win32 `SendInput`，不能据此把物理 OS 输入链声明为已封板。

本轮尝试用 Computer Use 获取物理窗口证据时，工具因 `0x80004002` 无法捕获该 frameless Electron 窗口。这是外部自动化/捕获能力缺口，既不能据此判产品失败，也不能反向冒充产品通过。

真正实时的 native split overlay 仍可作为远期 PoC，但必须先用物理 Win32 输入完成主/子窗、100/125/150% DPI、多显示器、RDP、Alt-Tab、崩溃与 100 次循环门禁。未经这些证据，不得以“不同渲染方案”为由直接复活旧透明子窗。
