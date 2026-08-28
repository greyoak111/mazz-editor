# W94Fe Source/Packaged + 双 Mazz Watch Room 边界检查点（2026-08-28）

> 结论：**PASS_WITH_SCOPE**；Source/Packaged、第二个真实 Electron Mazz、TLS loopback、断线重连、host transfer、新 epoch、durable replay 与 ResourceLedger 检查通过。真实公网 P2P、DHT/Tracker、跨机器房间仍按 W94F 施工参照保持显式 opt-in；W94F 总波仍为 PARTIAL（W94Fb 已闭合，最终公共面与审计红项未收口）。
> 施工参照：[W94F Player Transport + Watch Room](./W94F_PLAYER_TRANSPORT_AND_ROOM_SPEC.md)

## 本波定向边界

- `tests/e2e/w94fe-player-room-runtime.mjs` 以 Playwright 启动两个独立的 Mazz Electron 进程；没有 Python 端点、协议假人或直接注入 LanSync 对象。
- A 创建 `blob:<sha256>` 房间并追加 `play → seek → buffer`；B 只经真实配对同步加入事实，A 再次重连收敛成员。
- A 将控制权转移给 B，转移建立确定性新 `clockEpoch`；B 在新 epoch 追加 `pause`，再由 B 主机、A 反向加入收敛。
- 两个进程关闭后，A 使用同一 userData 与 Workspace 重开，离线 `roomReplay` 与关闭前事件序列一致。
- 未配对 `roomJoin`、未知 manifest 字段均由 IPC fail closed；聊天/弹幕正文没有进入测试 payload 或事件账。

## 证据

| Gate | Source | Packaged |
| --- | --- | --- |
| 双 Mazz runtime + TLS loopback | [`W94FE_PLAYER_ROOM_SOURCE.json`](./evidence/W94FE_PLAYER_ROOM_SOURCE.json) | [`W94FE_PLAYER_ROOM_PACKAGED.json`](./evidence/W94FE_PLAYER_ROOM_PACKAGED.json) |
| Room / epoch / timeline | `play, seek, buffer, member-join, host-transfer, pause`；active members `2` | 同左；EXE SHA-256 已写入证据 |
| Durable roundtrip | close → reopen → replay：PASS | close → reopen → replay：PASS |
| 帧隔离与隐私 | file/state-fact/watch-room 三条轨独立；external network `0`；runtime errors `[]` | 同左 |
| 故障注入 | 未配对加入、未知字段拒绝 | 同左 |
| ResourceLedger | reopen 后 `watchRoomOwners=0` | 同左 |

## 验证命令

```text
node tests/e2e/w94fe-player-room-runtime.mjs
node tests/e2e/w94fe-player-room-runtime.mjs --executable "release/win-unpacked/Mazz Editor.exe"
node tests/contract/w94fe-player-room-boundary.test.mjs       # 3/3
```

本波没有把真实公网 P2P 或跨机器连接伪装成默认通过；如要开该边界，必须另行显式 opt-in，并保留网络、权限、撤销和事故证据。
