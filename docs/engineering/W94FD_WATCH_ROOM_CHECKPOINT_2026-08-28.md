# W94Fd Local/LAN Watch Room 检查点（2026-08-28）

> 结论：**PASS（定向合同、真实 TLS 配对与持久化重放）**；W94Fe 的 Source/Packaged 与双 Mazz 真实边界已补齐，详见 [W94Fe 检查点](./W94FE_PLAYER_ROOM_BOUNDARY_CHECKPOINT_2026-08-28.md)。W94F 总波仍为 PARTIAL。
> 施工参照：[W94F Player Transport + Watch Room](./W94F_PLAYER_TRANSPORT_AND_ROOM_SPEC.md)

## 本波落地

- 新增 `main/foundation/watch-room.js`，冻结 `mazz.watch-room-manifest/v0` 与
  `mazz.watch-room-event/v0`，manifest、成员、权限、Workspace identity、media identity、
  `clockEpoch + sequence` 和 `revision` 均做严格归一化。
- Room 事件仅允许 `play|pause|seek|buffer|rate|host-transfer|member-join|member-leave|
  chat-ref|danmaku-ref`；事件签名为 canonical payload 的 `sig:<sha256>`，坏签名、未知
  epoch、重复 sequence 冲突、非 host 播放控制和未配对加入均 fail closed。聊天/弹幕只携带
  `chat:` / `danmaku:` 来源引用，不写正文。
- 事件与文件、LAN state-fact 分成独立 `watch-rooms` / `watch-room-ack` 帧；复用现有 TLS
  配对通道，不新开公网发现、DHT、Tracker 或公共房间入口。
- 增加 Workspace-scoped durable room manifest/event/epoch store，支持 save → close/reopen →
  replay；host transfer 生成确定性新 epoch，历史事件按 epoch 顺序重放。
- 新增主进程 IPC：`sync:roomCreate/Get/List/Events/Replay/Append/Join/Leave/TransferHost`；
  `roomJoin` 默认拒绝，只有调用方明确携带 `paired: true` 才可加入。

## 必查结果

| Gate | 结果 | 证据 |
| --- | --- | --- |
| Identity / Privacy | PASS | manifest/event 拒绝路径、URL、正文、未知字段；mediaRef 只接受 blob/transport hash |
| Watch clock | PASS | play/pause/seek/buffer/rate 顺序重放；wall clock 只写审计时间，不参与 mediaTimeMs |
| Room permission | PASS | 非 host 控制拒绝；host transfer 需当前 host 与 active target；未配对 join 拒绝 |
| Replay / reconnect | PASS | duplicate frame 幂等；stale/unknown epoch 与 sequence 冲突拒绝；重连收敛 |
| Transport separation | PASS | 真实 TLS 配对交换 `watch-rooms`，文件与 `state-facts` store 保持独立 |
| Resource | PASS_WITH_SCOPE | 仅保留解释明确的 256 成员 / 10,000 事件持久化安全上限；不是业务字数/token/队列门；W94Fe reopen 后无 `watch-room` owner |

## 验证命令

```text
node tests/contract/w94fd-watch-room.test.mjs       # 5/5
node tests/contract/lansync.test.mjs                # 12/12（含既有 W94E TLS 轨）
node tests/contract/w83-danmaku-runtime.test.mjs    # 7/7
```

本检查点不宣称 W94F 总波完成：W94Fb 的正式 W93 Candidate/Edition/Rights Receipt bridge
与 Workspace A/B 迁移门仍未闭合；W94Fe 已以 PASS_WITH_SCOPE 完成 Source/Packaged 与第二个
Mazz 实例的同机 TLS 边界，真实公网 P2P/跨机器房间仍须显式 opt-in。
