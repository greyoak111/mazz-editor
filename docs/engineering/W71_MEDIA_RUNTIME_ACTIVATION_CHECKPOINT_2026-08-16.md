# W71 Media Runtime Activation 检查点（2026-08-16）

> 范围：Viewer / Player 已有音频 WebAudio 链与本地视频 GIF 录制链。
>
> 结论：**本地文件的 packaged AudioContext / GIF 正常完成 / GIF 中断释放子门禁 PASS；真实媒体设备、设备权限与 Recorder 主模块仍 OPEN。**
>
> 冻结：不实施 W64 AI/人格陪看，不扩大为媒体功能开发。

## 1. 为什么需要这一检查点

此前 Viewer 生命周期检查点已经把 AudioContext、MediaRecorder、captureStream 与临时件纳入 `destroy()`，但只具备源码契约，正式 packaged 程序并未真实激活这些路径。本轮用正式 `release/win-unpacked/Mazz Editor.exe` 补齐本地文件运行态证据，并在激活过程中发现两个产品根因：

1. GIF 停止分支把 `MediaRecorder` 实例误当成带 `rec` 字段的包装对象，导致正常停止没有真正调用 `stop()`；
2. 已保存的音量增益大于 100% 时，加载阶段会提前创建 WebAudio 图；Chromium 在无用户手势时可让上下文保持 `suspended`，原播放按钮只调用 `media.play()`，存在时间推进但增益链无声的风险。

修复后，GIF 分支直接按 `rec.state` 停止真实 recorder；播放按钮在同一用户手势内先恢复当前 AudioContext，再启动媒体播放。

## 2. 正式 packaged 激活矩阵

| 路径 | 真触发 | 结果 | 释放证据 |
|---|---|---|---|
| 本地 WAV + 已保存 150% 增益 | 正式 Electron 打开、显式播放 | 上下文 `running`，播放时间推进，声道/采样率元数据已读出 | 关签后上下文 `closed`，`close()` 仅 1 次 |
| 本地 WebM → GIF 正常完成 | 正式 Canvas captureStream + MediaRecorder 生成输入；产品现有 GIF / ffmpeg WASM 链导出 | 产出 `GIF89a`，55,254 bytes | recorder `inactive`、stop event 1 次、全部 track `ended` |
| GIF 录制中关闭 Viewer | 第二次真实录制后直接关签 | 不产生销毁后续写 | recorder `inactive`、stop event 1 次、全部 track `ended` |
| 共享资源台账 | 激活前后读取主进程 ResourceLedger | 基线 `2` → 最终 `2` | 无新增活动资源残留 |

测试输入全部为本地样本：WAV 复用仓库 fixture；短 WebM 由正式 packaged Chromium 的 Canvas、captureStream 与 MediaRecorder 生成，不依赖网络或外部 ffmpeg。GIF 输出经过真实产品路径和 vendored ffmpeg WASM，不使用假的导出结果。

## 3. 自动证据

- packaged E2E：`npm.cmd run test:w71:media-runtime`
- 生命周期契约：`tests/contract/w71-viewer-lifecycle.test.mjs`
- 结构化证据：[`W71_MEDIA_RUNTIME.json`](./evidence/W71_MEDIA_RUNTIME.json)

证据同时记录可执行文件路径、合成视频 MIME/字节数、AudioContext 状态与调用次数、GIF 签名/大小、两次 recorder/track 终态以及 ResourceLedger 基线。测试插桩只观察浏览器原生对象的创建、状态与释放，不替换产品的音频、MediaRecorder 或 ffmpeg 实现。

最终同一轮发布物还通过：

```text
npm.cmd test                     143 / 143 测试文件
npm.cmd run dist                 正式 NSIS + win-unpacked
npm.cmd run audit:release        schema v2 发布边界审计
npm.cmd run test:w71:installer   schema v5 真安装/覆盖/五入口/20 轮/卸载
```

最终 specimen：

```text
installer      141,033,837 bytes
SHA-256        3F1907786A8A59C1E54017643532A1F322AA8441115E09866A345C9BFA783482
win-unpacked   597,418,673 bytes
app.asar       290,115,373 bytes
source maps    0
```

安装回归保持 ResourceLedger `2→2`、九个运行族各 20 轮、五种系统入口可见、UserChoice 原值不改写，卸载后安装目录/注册/关联残留归零；证据见 [`W71_RELEASE_BASELINE.json`](./evidence/W71_RELEASE_BASELINE.json) 与 schema v5 [`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json)。

## 4. Gate 结论与边界

| Gate | 结论 |
|---|---|
| 本地音频 WebAudio 激活、播放手势恢复与关签关闭 | **PASS** |
| 本地视频 GIF 正常停止、真实导出与资源释放 | **PASS** |
| GIF 录制中关签的 recorder / track 收尸 | **PASS** |
| 真实摄像头、麦克风、屏幕设备授权/拒绝/取消 | **OPEN** |
| Recorder 主模块的真设备录制、最小化、休眠恢复与长录制 | **OPEN** |
| 长音视频、硬件编解码、多显示器/RDP 与 RSS 斜率 | **OPEN** |

因此，本检查点只关闭旧总表中的“packaged AudioContext/GIF 激活”分支。`realMediaDeviceUsed=false` 是刻意保留的事实边界；它不能外推为真实设备、系统权限或完整媒体工作台已经封板。
