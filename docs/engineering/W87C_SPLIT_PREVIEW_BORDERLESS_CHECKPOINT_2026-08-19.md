# W87c 分屏预览无框纯渐隐检查点

> 日期：2026-08-19  
> 起始坐标：`main@8afba6c`  
> 结论：**用户指出的分屏渐变彩色框线已从真实主线、拖拽叠层、焦点仲裁和备用实现四处同时根除**  
> 继承协议：`mazz.visual-composition/v1`

> 2026-08-19 W87d 修订：W87c 只关闭彩色框线，未关闭 WCV 先被 cloak 后露出的空白网页区；当时的“复合 Surface 已封住白屏”表述范围过宽。现行视觉连续性以 [`W87D_BROWSER_DRAG_VISUAL_CONTINUITY_CHECKPOINT_2026-08-19.md`](./W87D_BROWSER_DRAG_VISUAL_CONTINUITY_CHECKPOINT_2026-08-19.md) 为准。

## 1. 现象与像素实证

W87b 关闭跨窗身份、宿主迁移、盖顶和几何重组问题后，分屏拖拽预览仍在渐变透明端出现一条主题色细线；快速跨方向时旧边和新边还可能因 `transition: all` 短暂叠成 L 形或近似整圈。拖拽白底是随后由 W87d 独立关闭的另一条跨渲染面缺陷。

旧 packaged hardware R3 截图在 `y=500` 的分界位置留下单像素铁证：

```text
x=759  [22,24,29]
x=760  [100,109,187]  ← 孤立 accent 像素
x=761  [22,24,29]
```

W87c 同尺寸 packaged hardware 截图变为：

```text
x=759  [22,24,29]
x=760  [22,24,29]
x=761  [22,24,29]
```

渐变深端的 `[44,49,60]` 保持不变，证明本轮删除的是显式描边，不是把预览本体或主题渐变一并抹掉。

对照证据：

- [`W87B_BROWSER_DRAG_HARDWARE_R3.png`](./evidence/W87B_BROWSER_DRAG_HARDWARE_R3.png)
- [`W87B_BROWSER_DRAG_HARDWARE_W87C.png`](./evidence/W87B_BROWSER_DRAG_HARDWARE_W87C.png)
- [`W87B_BROWSER_DRAG_COMPATIBILITY_W87C.png`](./evidence/W87B_BROWSER_DRAG_COMPATIBILITY_W87C.png)

## 2. 根因分层

| 层 | 旧机制 | 为什么会成为“神秘框” | W87c 收敛 |
|---|---|---|---|
| 真实主线 | `renderer/shell/shell.js` 先 `border:none`，随后按方向写 `borderLeft/Right/Top/Bottom = 1.5px solid rgba(accent,.55)` | 边写在渐变透明端，肉眼像是渐变自己带框；shorthand 检查又看不见后写入的 longhand | 删除 `borderSide`、颜色边字段和全部方向描边；四边、outline、shadow 显式归零，只保留方向渐变 |
| 拖拽叠层 | `.pane.active` 常态有 `inset 1px accent 35%` | WCV 被 drag cloak 后，平时被原生 Surface 遮住的活动窗格整圈会暴露 | 只在 `body.tab-dragging` 期间抑制 active pane shadow；drop 完成后正常活动提示恢复 |
| 焦点层 | 统一 Overlay 栈会把栈顶 Overlay 纳入 Tab/focus 仲裁 | 非交互预览若偶然获得 `:focus-visible`，全局 outline 会再画一圈 | `split-drag` 登记 `focusPolicy:none`，不进入焦点仲裁；其他 modal/overlay 行为不变 |
| 备用旧路 | `renderer/panels/splitpreview.html` 复制同一方向锚线 | 当前主线虽停用，但一旦回切会复活同一缺陷 | 同步改成无 border/outline/shadow 的纯渐变备用件 |

`renderer/base.css` 历史镜像也加入同一拖拽态限定，避免旧入口或后续合并把全框带回。没有全局删除 `.pane.active` 的正常可见提示。

明确排除项：`#mazz-overlay-plane` 只有层级与定位，没有边框；原生 split preview 窗使用 `frame:false/hasShadow:false` 且当前主线停用；该线不是 Windows compositor、GPU 或 WebContentsView 自带产物。

## 3. 回归合同为何必须升级

旧 `scenes-panes` 只读 `overlay.style.borderStyle`，但产品代码恰好是：

```text
先 border = none
后 borderLeft / borderRight / borderTop / borderBottom = 1.5px solid ...
```

因此旧断言天然假绿。本轮改为读取 `getComputedStyle()` 的四条 longhand，并固定断言：

```text
borderTop/Right/Bottom/LeftWidth = 0px
outlineStyle = none
outlineWidth = 0px
boxShadow = none
dragging active pane shadow = none
drop 后 tab-dragging = false
drop 后 active pane cue != none
```

矩阵会在一次拖拽中依次跨过 `right → down → left → up → right`，覆盖快速换区，而不是只验一个方向。DOM 定位也由过时的“body 直属无 id/class div”改为稳定的 `.mazz-split-drag-overlay`。

W87d 又把合同推进到跨渲染面最终路径：渐变只允许 `transition:opacity`，left/top/width/height 一帧直达，禁止 `transition:all`；proxy、代理图片和渐变全部 `pointer-events:none`，四方向 `elementFromPoint` 必须继续命中 pane。这样“无框”不再只表示四边宽度为零，也包含没有几何插值扫带、没有代理挡输入。

## 4. 实证结果

| Gate | 结果 |
|---|---|
| W87c 专项合同 | `4/4 PASS` |
| W87 Browser composition 合同 | `6/6 PASS` |
| W87 UI convergence 合同 | `9/9 PASS` |
| 分屏专项 E2E（含四竖条、嵌套、迁签、删除清扫、预览、收缩） | `8/8 PASS` |
| renderer build | PASS |
| Source Electron / hardware 复合矩阵 | PASS |
| `release/win-unpacked` / hardware / W87C | PASS |
| `release/win-unpacked` / compatibility / W87C | PASS |
| W87d source/packaged × hardware/compatibility/light 六组最终矩阵 | `6/6 PASS` |
| OSS provenance | CURRENT |
| release audit | PASS |
| 全量测试 | `221/221` 个测试文件 PASS（W87c/W87d 专项均已登记总入口） |

两条 packaged 结果都证明：四方向四边均为 `0px`，outline/shadow 均为 `none`；拖拽期间 active pane shadow 为 `none`；drop 后 `tab-dragging=false`，活动窗格 cue 恢复；三个独立 WCV 原生抓帧 healthy，main fatal / renderer error=`0/0`。

机器证据：

- [`W87B_BROWSER_COMPOSITION_PACKAGED_HARDWARE_W87C.json`](./evidence/W87B_BROWSER_COMPOSITION_PACKAGED_HARDWARE_W87C.json)
- [`W87B_BROWSER_COMPOSITION_PACKAGED_COMPATIBILITY_W87C.json`](./evidence/W87B_BROWSER_COMPOSITION_PACKAGED_COMPATIBILITY_W87C.json)
- [`W87B_BROWSER_COMPOSITION_SOURCE_HARDWARE.json`](./evidence/W87B_BROWSER_COMPOSITION_SOURCE_HARDWARE.json)

W87c 上述文件保留为“彩框消失”的历史证据；当前跨渲染面最终状态由 W87d 六组矩阵承担，包含 main sender-host `captureVisibleHost`、瞬时集合/身份/几何精确校验、代理 relayout、Overlay 激活身份集合复核、三块同时可见 Surface、实际 pane topology 与单一 owner，以及非活动 source 先激活。详见 [W87d 检查点](./W87D_BROWSER_DRAG_VISUAL_CONTINUITY_CHECKPOINT_2026-08-19.md)。

兼容模式首轮曾在 Overlay/Surface 已恢复、双 `requestAnimationFrame` 清理尚未执行完的缝隙读取 `tab-dragging`，暴露的是探针采样过早。Gate 已改为等待 Overlay 归零、WCV 可见、拖拽 class 撤销和 active cue 恢复四条件同时成立；随后 compatibility GREEN。没有用无变化重跑掩盖失败。

## 5. 诚实边界

本轮只关闭分屏拖拽预览的彩色框线及其可复活路径，不重写渐变设计、不取消正常活动窗格提示、不删除 drag cloak/双帧稳定/Windows compositor 药方，也不宣称多显示器/DPI/RDP 全排列已经因此完成。W87d 的 Playwright CDP pointer 路径已通过 pointer-through，但 CDP 不是 Win32 `SendInput`；Computer Use 又因 `0x80004002` 无法捕获 frameless Electron 窗口，该工具失败既不能判产品失败，也不能反向充当产品通过证据。

若后续再出现彩框，首先检查 computed 四边、outline、shadow、active pane drag state 与 Overlay focus policy；不得先归咎 GPU，也不得以只读 shorthand 的测试封 Gate。

历史 `probe-split`、`probe-drag`、`scenes51` 也已从 `body.children/body > div` 的旧结构猜测迁到 `.mazz-split-drag-overlay` 稳定身份，避免 Overlay 被统一平面搬家后旧探针漏检或假红。

完整分屏专项复跑还稳定暴露出一个与彩框无关、但不能带红放行的旧数据缺陷：删除广播已统一成 `/` 且 Windows 盘符折小写，标签中的 `filePath` 却可能保留反斜杠/原大小写，`closeGhostTabs()` 用原字符串比较会留下虚空标签。现已令删除目标与每个标签路径共同使用 `normalizeChangePath()`，文件与目录级联删除场景重新纳入本轮最终 Gate。
