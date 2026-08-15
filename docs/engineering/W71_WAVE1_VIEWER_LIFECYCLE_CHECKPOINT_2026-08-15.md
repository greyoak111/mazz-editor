# W71 Wave 1 Viewer / Player 生命周期检查点

> 日期：2026-08-15
>
> 承接坐标：`main@84dcecf`
>
> 状态：Viewer 关签生命周期和已识别的 Player 全局资源已收敛，并完成 contract 与 packaged 20 轮；**没有宣称全部媒体资源、Wave 1 或 W71 结案**

## 1. 本轮关闭的真实问题

此前 Viewer 的 `deactivate` 会摘除 DOM 并销毁当前播放器，但模块没有 `dispose`，私有 `instances` 表、活动控制器锚点和转码缓存不会在关签时统一退役。Player 的 `destroy()` 也没有覆盖以下资源：

```text
window resize listener
document fullscreenchange listener
正在拖拽时临时挂到 window 的 mousemove / mouseup
音频共享链 AudioContext
频谱 requestAnimationFrame
GIF MediaRecorder / captureStream / 抽帧 interval
悬停缩略图与自动连播 timer
Chromium media src / decoder / file handle
```

此外，非 Electron 路径的文件读取和 ffmpeg 转码都可能在标签已经关闭后迟到返回，重新创建 Blob URL、临时转码文件或播放器。

## 2. 收敛实现

### Viewer owner

- 增加幂等 `dispose(state) → ctl.destroy()`；关签时从实例表删除 owner，并清空 `current` / `window.__activeViewerCtl`；
- `destroy()` 递增 load generation，令所有在途 load/transcode 失效；
- 图片编辑器、播放器、root DOM、当前 Blob URL、转码 Blob cache 一次性收尸；
- Electron 转码临时文件按 Viewer owner 记录，退役时通过 `fs:delete` 清理；
- `bootEmptyPlayer` 在动态导入前后都检查 owner 是否已经销毁，防止关签后空播放器复活；
- 图片/PDF/音视频的异步读取在物化 Blob 和挂 DOM 前重验 generation。

### Player owner

- 全局 `resize`、`fullscreenchange`、`keydown` 与拖拽临时监听全部 add/remove 对称；
- 进度、P2P、悬停、自动连播、控制栏、GIF 抽帧 timer 全部进入 `destroy()`；
- GIF 录制中关签会停止 recorder 与所有 stream track，不触发销毁后的转码；
- 解码 AudioContext 与共享增益链 AudioContext 去重关闭；
- 音频频谱 RAF 显式取消；
- 最终 pause、清空 `srcObject`、移除 `src` 并调用 `load()`，主动释放 Chromium 解码器与文件句柄；
- `destroy()` 可重复调用，不产生 rejected promise 或二次释放错误。

## 3. 可复验证据

### Contract / jsdom

[`w71-viewer-lifecycle.test.mjs`](../../tests/contract/w71-viewer-lifecycle.test.mjs) 覆盖：

```text
Viewer Blob URL 打开/关闭 × 20：live URL 每轮归零
关闭后才返回的 fs:readFileBase64：不创建 Blob、不复活 DOM
dispose / destroy 二次调用：幂等
Player resize/fullscreen/key/拖拽 listener：全部回到基线
Player interval：回到基线
Player media src：主动卸载
RAF / GIF / AudioContext / temp-file 清理：源码契约钉死
```

结果：新增测试 `3 / 3`；相关历史 W45、W58d 与本测试合计 `14 / 14`。

### Windows packaged app

重新执行 `npm.cmd run dist:dir` 后，`release/win-unpacked/Mazz Editor.exe` 在 Electron `33.4.11` 中连续 20 次真实打开和关闭 SVG Viewer。每轮都要求：

```text
图片已实际挂入 .viewer-body，且 complete=true / naturalWidth>0
关闭后 ModuleRegistry 中没有 viewer instance
关闭后没有 .viewer-root
关闭后 window.__activeViewerCtl 为空
```

同一个 packaged smoke 同时重跑原有六族 20 轮：

```text
PTY
Settings PanelWindow
WebContentsView
FileWatcher
WebTorrent client + server
Python process + temp driver
Viewer
```

结果：启动基线 `2`，最终活动资源 `2`；释放历史 `140`；Harness Session `0`；七族各 20 次通过。

## 4. 诚实边界

| 项目 | 当前结论 |
|---|---|
| Viewer 模块 owner / instance / DOM / active anchor | **PASS：packaged 20 次** |
| 非 Electron Blob URL | **PASS：contract 20 次 + stale callback** |
| Player 全局 listener / interval / media src | **PASS：行为契约** |
| AudioContext、GIF stream、频谱 RAF、转码临时件收尸代码 | **LANDED + CONTRACT；尚未在 packaged 中实际触发全部分支** |
| Recorder 的真实设备 MediaStream、权限与取消 | **OPEN** |
| Factory stream / task、Monaco worker、真实 Agent Adapter | **OPEN** |
| Viewer 多窗迁移、音视频长播、休眠恢复、RSS 斜率 | **OPEN** |

因此本检查点只把“Viewer 关签后 owner 和基础播放器资源是否持续累积”从未知变成可复验通过，不把整个 `media / Object URL` 大类误报为全部结案。

历史 W62e、W63、W64、W65、W67、W69、W70 与 W72–W81 仍以交付区《Mazz 当前未落地全景-W71归并版》为唯一总表。本轮没有实施 Post-W71 Runtime、Replica、Snapshot/Delta 或 8 小时 soak 设计。
