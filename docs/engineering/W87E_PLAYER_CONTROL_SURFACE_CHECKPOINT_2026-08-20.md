# W87e Player Control Surface 检查点

> 日期：2026-08-20
> 起始坐标：`main@02c67d5`
> 状态：**SOURCE + PACKAGED ELECTRON RESEALED / CURRENT**
> 归属：Player stage-local DOM owner；**不是** `mazz.visual-composition/v1` 的新 Surface kind

## 1. 结论

Player 底部控制栏已经从“整条 `max-content` 控件带被 Pane 裁切”改为按**控件实际容器宽度**收敛的 L/M/S/XS Control Surface。核心播放、进度、时间和 More 保持可达；次要能力按优先级搬入 stage 内的 Control Center。迁移的是同一批真实 DOM 节点，不复制 handler、状态或媒体能力。

P1 加固后的 source 与 packaged Electron 已在干净重建后重新通过；此前 GPU 子进程 `0xC0000135` 只是一次已解除的环境阻断，不再是当前状态。12 个精确宽度、真实分屏 + Player 侧栏、极窄 overlay、焦点/锁定/ARIA、音频 capability 与 20 轮 resize/ownership 均由当前证据重新生成。

## 2. 根因与所有权

旧 W58c 为防底栏压缩错位给 `.mz-bar` 加了 `min-width:max-content`。在全宽 Player 中该药方能稳定按钮，但进入分屏、媒体侧栏或窄 Pane 后，控件自然宽度大于可用宽度；上层 `.mz-stage` 再裁切 overflow，于是尾部控制被确定性截断。该问题不是 z-index，也不是需要全局 Overlay 仲裁的原生 Surface 问题。

W87e 的所有权边界如下：

```text
Player capability/state/actions
              ↓
stage-local Player Control Surface
  ResizeObserver · L/M/S/XS · More · focus/lifecycle
              ↓
same DOM controls, inline ↔ Control Center
```

- Player 继续拥有媒体状态、动作和控制定义；
- Control Surface 只拥有 Player stage 内的响应式排布、More 开闭、焦点与观察器生命周期；
- Control Center 不申请 host-wide occlusion，不登记为 `dom-overlay`，也不进入全局 Visual Composition registry；
- W87e **只在 Player 上 supersede W58c 的 `max-content` 布局药方**；
- W58f 的无边框渐隐/窗口模式常驻控制和 W58h 的侧栏 CSS/JS 同上限、无幽灵占位继续保留。

## 3. 已落地范围

1. `renderer/modules/viewer/player-controls.js` 建立 Player 专用响应式 owner，使用 `.mz-controls` 的真实容器宽度，而不是 viewport 宽度。
2. 尺寸档为 `L ≥ 960`、`M ≥ 600`、`S ≥ 440`、`XS < 440`；边界探针固定覆盖：

   ```text
   1200 / 960 / 959 / 900 / 720 / 600 / 599 / 560 / 440 / 439 / 420 / 320 px
   ```

3. 同一 DOM 节点在 inline bar 与 Control Center 间移动；不 clone、不代理 click、不生成第二套状态。
4. More 是 stage-local dialog；S/XS 转为底部控制面，Escape、外点和动作关闭后焦点回到稳定入口。
5. 音频态的 video-only 控件以 `hidden` 为事实，作者样式不能在 More 中把它复活。
6. 侧栏拆分 `preferred width` 与当前 Pane 的 `effective width`；极窄 Pane 改为 stage 内 overlay，缩窄后再放宽不会永久丢失用户宽度偏好。
7. 无边框态可由键盘焦点唤回控制栏；锁定态把其余控件移出 Tab/指针序列，并保留单一可见解锁入口。
8. 进度条升为可键盘操作的 ARIA slider；toggle 控件同步 `aria-pressed`。
9. `selectProxy` 的临时命令和 change listener 按唯一 source 对称注销；Player 销毁能处理迟到 dynamic import。
10. MutationObserver/ResizeObserver/全局监听均有幂等 destroy，且布局刷新不再反复写回相同 observed attribute。

## 4. 当前验证账

| 门 | 当前结果 | 说明 |
|---|---|---|
| W87e Node contract | **PASS 13/13** | 容器尺寸档、同节点迁移、More/focus、音频 hidden、侧栏 preferred/effective、锁定/无边框、ARIA、selectProxy 生命周期 |
| W71 Viewer/Player lifecycle | **PASS 4/4** | 含多轮 Player create/destroy 后临时命令回基线与迟到 import 不复活 |
| P1 加固后 source Electron | **PASS / CURRENT** | 12 个 exact-width、真实分屏/侧栏、极窄 overlay、焦点/锁定/ARIA、音频态与 20× ownership 均通过；fatal/error 0 |
| P1 加固后 packaged Electron | **PASS / CURRENT** | `release/win-unpacked` 同矩阵通过；fatal/error 0 |
| 全量 / 发布 | **PASS** | `222/222`；Windows unpacked 重建、release audit PASS、OSS provenance CURRENT |
| W71 完整 Wave 5A | **OPEN** | Player 只是第一参考实现；Shell、Sheet、Browser、Factory、Library 尚未按同一布局门完成推广 |

## 5. 当前证据

下列 8 张图和两个 JSON 已由 P1 加固后的最终代码重新生成，现为 **CURRENT**：

- `W87E_PLAYER_CONTROLS_{SOURCE,PACKAGED}_{INK,PAPER}.png`
- `W87E_PLAYER_CONTROL_CENTER_{SOURCE,PACKAGED}_{INK,PAPER}.png`
- `W87E_PLAYER_CONTROL_SURFACE_SOURCE.json`
- `W87E_PLAYER_CONTROL_SURFACE_PACKAGED.json`

两个 JSON 均带 `ok:true / verdict:PASS`，且 source/packaged 的 `createdAt` 晚于最终产品代码与重建包。截图已回看：Paper/Ink 主题真实分化；窄分屏底栏没有横向裁切或重叠；Control Center 约束在 Player stage 内；侧栏展开时控制位与媒体位一致让开。

20 轮仍只表示 **resize / DOM ownership convergence**：验证每轮节点唯一、More 单例、观察器/排布收敛。它不是 20 次真实媒体打开关闭，不是内存回落，也不是长时间媒体 soak。

## 6. 复封结果与边界

W87e 的复封门已逐项满足：

1. source 与 packaged Electron 均完成无环境故障的重跑；
2. 12 个精确宽度在 Paper/Ink 下无横向裁切、控件重叠、More 重复或舞台外逸；
3. 真实分屏 + 侧栏、极窄 overlay、缩窄再放宽恢复 preferred width 通过；
4. 音频态 video-only 控件不可见且不可聚焦；More 动作/Escape 焦点回收、锁定/解锁和无边框键盘唤回通过；
5. source/packaged JSON 与 8 张截图由最终代码重新生成并回看；
6. 全量 `222/222`、Windows unpacked 构建、发布审计与 provenance 均通过。

完成 W87e 也只关闭 Player 参考实现，不等于完成 W71 Wave 5A，更不等于所有模块的 L/M/S/XS 布局债务已经清零。随后发现的 Workspace Sidebar 与空 Player 侧栏几何缺陷由 [`W87F_SIDEBAR_PLAYER_LAYOUT_CHECKPOINT_2026-08-20.md`](./W87F_SIDEBAR_PLAYER_LAYOUT_CHECKPOINT_2026-08-20.md) 独立关闭。
