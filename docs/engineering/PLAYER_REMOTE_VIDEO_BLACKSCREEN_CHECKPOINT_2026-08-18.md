# Player 远程/虚拟显示视频黑屏修复检查点

日期：2026-08-18  
范围：Player、本机图形模式选择、真实 AVC/HEVC 播放  
结论：`FIXED / VERIFIED ON CURRENT WINDOWS HOST`

## 1. 用户症状与复现

用户在 spacedesk 远程显示环境播放 H.265/HEVC MKV 时，时间轴已经推进到 `42:17`，但视频区全黑；主进程同时反复输出 `Unsupported pixel format: -1`。旧播放器只监听 `HTMLMediaElement.error`，因此面对 `readyState=4`、`error=null`、时间继续推进但 `videoWidth=0`、解码帧始终为 0 的“假播放”不会失败，也不会给出恢复路径。

本轮使用用户 Downloads 中两份真实文件复现和验收，媒体本体没有复制进仓库：

| 样本 | 大小 | 用途 |
|---|---:|---|
| `[CASO&SumiSora]...Madoka...x264_FLACx2....mkv` | 1,433,156,268 bytes | AVC/x264 正常基线，跳转 60 秒 |
| `鬼灭之刃...Infinity.Castle...x265...mkv` | 3,304,035,373 bytes | HEVC/x265 缺陷样本，精确跳转 2,537 秒（42:17） |

## 2. 根因

当前机器同时存在 Intel、NVIDIA 与 `spacedesk Graphics Adapter`。旧 `detectUnsafeGraphicsHost()` 把任何虚拟显示驱动都升级为完整安全图形模式，并执行 `app.disableHardwareAcceleration()`、`--disable-gpu`、`--disable-gpu-compositing` 和 `--disable-software-rasterizer`。这连同 Chromium 的平台 HEVC 解码路径一起被关闭，最终形成“有音频/有时间、无视频帧”的黑屏。

旧 WMI 探测超时只有 1.5 秒，而当前机器冷调用约需 2.8 秒，同一主机还会因探测是否超时在 hardware/safe 间随机抖动。

对照实验证明：

- 完整 safe 模式下，HEVC 在 42:17 为 `videoWidth=0 / decoded frames=0`；
- 保留 GPU，仅关闭 DirectComposition 和视频独立叠加层时，同一文件同一时间点稳定解出 1920×1080 画面；
- AVC/x264《魔法少女小圆》在兼容模式仍正常播放。

## 3. 修复

图形策略改为三态：

| 模式 | 触发条件 | 行为 |
|---|---|---|
| `hardware` | 普通本机或显式强制 | 保持默认 GPU/合成路径 |
| `compatibility` | spacedesk、virtual/mirror/indirect display 等虚拟显示 | 保留 GPU 与平台视频解码，只关闭 DirectComposition 及其视频叠加层 |
| `safe` | 真正 RDP/ICA/PCoIP、显式 safe、`--disable-gpu` | 保留原完整无 GPU 兜底 |

WMI 探测超时提高到 5 秒，消除当前主机上的随机模式漂移；`app:graphicsMode` 提供只读运行诊断。

Player 另加解码帧真值门：播放至少 4 秒且时间已推进时，如果画面尺寸和解码帧/帧回调仍为零，则主动暂停并显示可操作的失败面板。用户可以重试画面或交给系统播放器；HEVC 能力确实缺失时显示官方组件指引。播放器不再把“时间会走”冒充“画面已播”。

## 4. 真实文件验收

自动探测在当前主机稳定选择：

```text
mode=compatibility
reason=检测到虚拟显示驱动 spacedesk
```

| 样本/位置 | readyState | 画面 | 解码帧 | 帧回调 | dropped | Player 失败面板 | 结果 |
|---|---:|---:|---:|---:|---:|---|---|
| Madoka AVC / 60s | 4 | 1920×1080 | 149 | 30 | 0 | 否 | PASS |
| Demon Slayer HEVC / 42:17 | 4 | 1920×1080 | 283 | 30 | 0 | 否 | PASS |

两项均 `error=null`，主进程与 renderer 错误计数均为 0。真实文件回归脚本现在会把“应有帧”或“应出现兜底面板”作为硬断言，失败即非零退出。

可视证据：

- [`PLAYER_REAL_MADOKA_AVC.png`](./evidence/PLAYER_REAL_MADOKA_AVC.png)
- [`PLAYER_REMOTE_HEVC_4217.png`](./evidence/PLAYER_REMOTE_HEVC_4217.png)
- [`PLAYER_SAFE_ZERO_FRAME_FALLBACK.png`](./evidence/PLAYER_SAFE_ZERO_FRAME_FALLBACK.png)
- [`PLAYER_REMOTE_VIDEO_BLACKSCREEN.json`](./evidence/PLAYER_REMOTE_VIDEO_BLACKSCREEN.json)

## 5. 定向验证

```text
hotfix-remote-gpu                    4/4 PASS
player-video-frame-health            3/3 PASS
player-w23                           5/5 PASS
player-w25                           5/5 PASS
real-file AVC + HEVC                 2/2 PASS
npm run build                        PASS
```

本轮没有运行无关全量，也没有重建安装包；不得把开发态真 Electron 证据冒充 packaged Gate。当前修复关闭的是用户已复现的 spacedesk/HEVC 黑屏及其无提示失败，不声称覆盖所有 GPU、驱动、RDP、HDR、色深和编码组合。

