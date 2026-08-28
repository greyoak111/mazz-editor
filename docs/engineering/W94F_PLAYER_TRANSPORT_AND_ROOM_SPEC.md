# W94F Player Transport + Watch Room 施工参照

> 状态：**SPEC READY / W94F PARTIAL · W94Fb PASS_WITH_SCOPE · W94Fc PASS · W94Fd PASS · W94Fe PASS_WITH_SCOPE**
> 日期：2026-08-27  
> 上位参照：[W94 Unified Capability, Artifact & Public Plane](../plans/W94_UNIFIED_CAPABILITY_ARTIFACT_AND_PUBLIC_PLANE.md)  
> 前置真源：[W93 Library Resource Freedom](../plans/W93_LIBRARY_RESOURCE_FREEDOM.md)、[W93F Torrent Book Transport](./W93F_TORRENT_BOOK_TRANSPORT_SPEC.md)、[W83 Danmaku Runtime](../plans/W83_DANMAKU_RUNTIME.md)  
> 历史边界：[06｜Player、P2P、弹幕、陪看、Feed 与 Library](../archaeology_v2/06_Player_P2P弹幕陪看Feed与Library.md)

## 1. 本波裁决

W94F 只收敛 Player 的传输事实和本地/LAN watch room。播放器仍是媒体消费者，W93
Acquisition Service 是书库取得的耐久 owner，W83 继续拥有 media-clock danmaku runtime；
三者共享可寻址身份和资源账，但不互相偷取状态真相。

本波不把历史上的“接入 WebTorrent”“陪看聊天落盘”自述倒写成已完成协议，不上线公共
房间、陌生人发现、Feed 推荐、Hub 排行或支付。真实公网 DHT/Tracker/Peer 只在用户明确
opt-in 的专项验证中出现，默认合同和测试保持离线。

任何字数、token、章节、文件数量或下载队列条数都不是业务完成门。磁盘、路径、协议、
签名、解压、进程和内存安全可以拒绝或暂停，但必须是可解释的安全/资源事实，不能静默
丢弃任务或截断用户内容。

## 2. 现有基座与不得复制的真相

### 2.1 可复用

- `main/library-acquisition-service.js`：W93 durable Job、Workspace 绑定、暂停/恢复/重试/
  取消、staging、校验和 promotion。
- `main/library-torrent-book-transport.js`：public-DHT magnet 的 BTIH、选档、流式写入与
  owner 收敛；它不接受 private tracker、webseed 或未经同意的 P2P。
- `main/library-resource-surface-service.js`：Candidate、Rights、P2P consent、selected file
  的主进程边界。
- `main/torrent-daemon.js`：当前媒体播放器的兼容传输 owner、Range stream 与下载控制；
  W94F 将逐步把它变成共享 owner 的兼容适配层，不再新增第三套 Job 真相。
- W83 的 media clock、seek、danmaku timeline/scheduler；Watch Room 只广播时钟相关事实，
  不把 wall clock 当播放位置。

### 2.2 明确不复制

- 不让 Renderer `Map`、当前标签页或动态 loopback URL 成为下载任务、媒体身份或恢复事实。
- 不把 Player 的内存 `jobs/torrents` 直接当 Library 的 durable acquisition ledger。
- 不把 magnet、tracker、peer、DHT 节点、绝对路径、响应正文、字幕正文、聊天正文或凭据
  写入 Workspace Event、Branch、Room manifest 或公共投影。
- 不让 Player 直接接管 W83 的解码、弹幕调度或公共 W69 Event Feed。

## 3. 冻结身份与数据合同

### 3.1 Transport identity

传输身份必须由完整 BTIH 与规范化 selected-file identity 组成：

```text
transport:<sha256(canonicalInfoHash + "\\0" + canonicalSelectedFilePath + "\\0" + declaredSize)>
```

取得完成后，完整 SHA-256 Blob 是内容身份；BTIH 仅保留为可重建的 transport reference。标题、
URL、动态端口和 UI 标签不能代替身份。跨 Workspace 恢复先核 Workspace identity、Candidate/
Job revision 与 selected file，再由主进程重建 transport。

### 3.2 Player transport session

```json
{
  "schema": "mazz.player-transport-session/v0",
  "sessionId": "player-session:<id>",
  "workspaceId": "workspace:<sha256>",
  "transportRef": "transport:<sha256>",
  "blobRef": "blob:<sha256>|unknown",
  "selectedFileRef": "file:<sha256>",
  "state": "queued|downloading|paused|completed|failed|cancelled",
  "revision": "rev:<id>",
  "sourceRefs": [],
  "capabilityRef": "capability:<opaque-id>|none",
  "createdAt": "…",
  "updatedAt": "…"
}
```

Renderer 只拿短命 `capabilityRef` 或受控 `mazz-res://` 消费句柄，不拿任意 loopback host/port、
本地路径或 transport coordinates。所有读 Range、删除、保留和恢复操作由主进程核对当前
Workspace 与 capability 后执行。

### 3.3 Watch room manifest 与事件

```json
{
  "schema": "mazz.watch-room-manifest/v0",
  "roomId": "room:<id>",
  "workspaceId": "workspace:<sha256>",
  "mediaRef": "blob:<sha256>|transport:<sha256>",
  "hostMemberId": "member:<id>",
  "clockEpoch": "epoch:<id>",
  "members": [],
  "permissions": { "join": "invite", "control": "host", "chat": "members" },
  "eventCursor": "event:<id>",
  "createdAt": "…",
  "updatedAt": "…"
}
```

Room 事件只写 `play|pause|seek|buffer|rate|host-transfer|member-join|member-leave|chat-ref|danmaku-ref`
等操作、媒体时间和引用；聊天/弹幕正文另有本地资产或 W69/W83 来源账，不能内嵌进 room
ledger。事件以 `clockEpoch + sequence` 排序，迟到事件按 epoch/revision 明确拒绝或重放。
wall clock 只用于观测，不用于推导播放位置。

## 4. 施工拆波

### W94Fa — 兼容 Player 队列去业务条数门（本次）

- 删除 `main/torrent-daemon.js` 中固定下载队列条数拒绝；不同 BTIH 任务不因条数被静默
  丢弃。
- 保留重复 BTIH 的幂等收敛、显式 pause/resume/retry/remove 和 ResourceLedger owner。
- 不改变媒体路径、WebTorrent 网络策略、Range 消费、现有播放器 IPC 形状。
- 资源不足、协议错误或进程失败必须以任务状态/错误事实返回；不能以“队列满”冒充业务
  规则。后续 durable migration 再处理跨重启任务账。

### W94Fb — PlayerTransportAdapter durable projection

- 先冻结 `PlayerTransportAdapter`，把现有 `tor:*` 控制映射到 Workspace-scoped durable
  session projection；兼容 UI 只消费主进程快照，内存 `jobs/torrents` 只能作运行时索引。
- 媒体 Player 的任意 Magnet 可能没有 W93 Candidate、Edition 或 Rights Receipt，不能伪造
  一个书库 Acquisition Job。书籍来源仍必须走 W93 `LibraryAcquisitionService`；已有 Candidate
  的 Player 请求经显式 W94Fb bridge 复用该入口，并把 W93 Job 投影到同一 Workspace/.resources
  session；Candidate-less 媒体保持兼容轨，不复制第三套网络 owner。
- 重启时 queued/downloading 只恢复为 durable `paused`，不自动恢复网络；显式 resume、
  pause、retry、cancel/remove 都先完成主进程 revision 更新。迁移期间不自动导入无身份旧任务；
  无法依据可验证 BTIH 重建的事实保持不可见/错误可观测，不静默丢弃。

### W94Fc — 消费 capability 与流式读取（已落地）

- 将 stream URL、file path、subtitle bytes 等读取统一到短命 capability 与精确 Range/
  selected-file 投影；Capability 过期、Workspace 切换或窗口销毁后立即失效。
- 大文件不得经 IPC `Buffer` 整体复制；改为受控流/Range，保留 W93 的 containment、hash、
  format 和 owner 检查。任何安全/资源拒绝须说明原因，不能截断内容。
- 当前实现与证据：[W94Fc 检查点](./W94FC_PLAYER_CAPABILITY_RANGE_CHECKPOINT_2026-08-28.md)。

### W94Fd — Local/LAN Watch Room

- 当前实现与证据：[W94Fd 检查点](./W94FD_WATCH_ROOM_CHECKPOINT_2026-08-28.md)。
- 先做同机与显式配对的 LAN room：manifest、成员、host transfer、时钟 epoch、断线重连、
  seek/pause/buffer 重放和本地聊天/弹幕引用。
- state-fact 与文件 frame 分离；签名、Workspace identity、revision 和权限失败均 fail closed。
- Room 只影响观看状态，不授予取得、发布、Rights、Canon 或 Hub 权限。

### W94Fe — Source/Packaged 与真实边界

- 每个子波都要有定向合同、durable roundtrip、故障注入、ResourceLedger、Source/Packaged
  运行证据和 checkpoint。
- 默认 fake swarm/loopback 离线；真实 P2P、第二个 Mazz 实例和跨机器房间必须显式 opt-in，
  不能用临时 Python 端点冒充第二个 Mazz。
- 已完成：两个独立 Electron Mazz 在 Source/Packaged 均通过真实 TLS loopback 完成显式配对、
  成员回传、断线重连、host transfer/new epoch、host-only pause、反向收敛和 close/reopen/replay；
  未配对/未知字段拒绝、file/state-fact/watch-room 三轨隔离与 ResourceLedger 结果见
  [W94Fe 检查点](./W94FE_PLAYER_ROOM_BOUNDARY_CHECKPOINT_2026-08-28.md)。

## 5. 必查矩阵

| Gate | 必须证明 |
| --- | --- |
| Identity | BTIH + selected file 稳定；完成后 Blob hash 接管内容身份；标题/URL/端口不冒充身份 |
| Queue | 任意数量的不同任务不因固定条数业务门被拒；重复 BTIH 幂等；资源/协议失败可观测 |
| Durable | save → close → reopen → replay；Workspace、Job revision、selected file 和 owner 不串 |
| Stream | capability 短命、Range/containment 严格；不把任意 loopback/path/整本 Buffer 暴露给 Renderer |
| Watch clock | epoch/sequence 可重放；seek/pause/rate 不依赖 wall clock；迟到事件不穿越时间线 |
| Room | offline、断线、重连、host transfer、成员权限和坏签名均有明确结果；不上传正文 |
| Resource | client/torrent/iterator/listener/timer/window/temporary/process 回到基线或稳定子集 |
| Privacy | JSON、事件、日志、截图不含 Key、Cookie、tracker、peer、绝对路径或用户正文 |
| Regression | W83、W93A–G、W94A–E、full test、build、dist、provenance、secret、release |

## 6. Final Gate

W94F 只有在 Player 与 Library 使用同一 durable transport truth、Source/Packaged 重启与
Workspace A/B、LAN room 断线/重连/host transfer、资源收敛和隐私审计全部通过后才可写 PASS。

第二个 Mazz 实例若缺少可运行的同代 Node/Electron runtime，只能记录 `PASS_WITH_SCOPE` 或
`BLOCKED` 及精确复开条件；不能用 Python 协议 fixture 缩小口径。W94Fa 的单项通过不代表
W94F 或 W94 总波通过。
