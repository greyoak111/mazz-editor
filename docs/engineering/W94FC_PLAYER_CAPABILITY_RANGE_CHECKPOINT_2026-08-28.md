# W94Fc Player capability + Range 检查点（2026-08-28）

> 结论：**PASS（定向合同与源代码门）**；W94Fb/W94Fd 已通过，W94Fe 已有 PASS_WITH_SCOPE 边界证据，W94F 总波仍为 PARTIAL。
> 施工参照：[W94F Player Transport + Watch Room](./W94F_PLAYER_TRANSPORT_AND_ROOM_SPEC.md)
> 上位计划：[W94 Unified Capability, Artifact & Public Plane](../plans/W94_UNIFIED_CAPABILITY_ARTIFACT_AND_PUBLIC_PLANE.md)

## 1. 本波交付

- `main/torrent-daemon.js` 新增 Workspace-scoped、短时 `tor:fileCapabilityUrl`：只接受当前
  torrent 的精确 selected-file，记录 Workspace、owner、过期时间，并在 renderer window
  `destroyed`/`render-process-gone` 时立即失效。
- `mazz-res://tor-cap/<opaque-token>` 在主进程协议层打开 WebTorrent File 的 Range 流；支持
  单一 `bytes=start-end`、suffix、HEAD、Content-Range/Length/MIME，不经 IPC `Buffer` 整体复制。
- 播放器媒体和种子内 `.ass/.srt/.ssa` 均通过 capability URL 消费；renderer 不再接收 loopback
  stream URL、torrent 绝对路径或 `tor:fileBytes` 的 IPC Buffer。
- “存到媒体库”改走主进程 `tor:materialize`，destination 只能是当前 Workspace 内相对路径，
  源文件只能是当前 torrent store 内精确 selected-file。
- `tor:fileBytes` 保留为旧调用方兼容通道，但移除人为 32 MiB 内联门；新播放器不再调用。

## 2. 必查结果

| Gate | 结果 |
| --- | --- |
| 定向行为 | `node --test tests/contract/w94f-player-transport.test.mjs`：**3/3 PASS**；覆盖 51 任务、重启 paused/resume、capability Range/owner invalidation |
| 相邻契约 | `node --test tests/contract/player-w25.test.mjs`：**5/5 PASS**；播放器/桥/主进程入口与旧 Buffer 禁用关系一致 |
| 门限回归 | `node tests/unit/w67-accumulator-budgets.test.mjs`：**4/4 PASS**；媒体读取不再含 `MAX_INLINE_FILE_BYTES` 或 32 MiB 业务门 |
| 安全边界 | capability 绑定 Workspace + selected-file + owner；过期、窗口销毁、Workspace 变化和坏 Range 均 fail closed |
| 资源 | Range 使用 WebTorrent `createReadStream`；不在 IPC/renderer 侧整读大媒体，不新增网络 owner |
| 隐私 | capability token 为随机不透明值；不把磁盘路径、loopback 端口、tracker/peer 写入 renderer projection |

## 3. 未覆盖与下一波

- 本检查点未宣称 W94F 总波完成：W94Fd 的 Local/LAN Watch Room 已有独立检查点；W94Fe 的
  Source/Packaged capability 协议证据与真实边界仍待补齐。
- W94Fb 的正式 Candidate/Edition/Rights Receipt bridge 与 Workspace A/B 迁移已在
  [`W94F 检查点`](./W94F_PLAYER_TRANSPORT_AND_ROOM_CHECKPOINT_2026-08-27.md)及 Source/Packaged
  证据中通过；没有 Candidate 的媒体 Magnet 仍不会伪造书籍 Acquisition Job。
- 下一施工项：继续按 W94F 总波矩阵补齐最终公共面/World 与剩余审计红项，不扩大媒体 Magnet 的权限边界。
