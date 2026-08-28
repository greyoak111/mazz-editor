# W94F Player Transport + Watch Room 检查点（2026-08-27）

> 结论：**PARTIAL / W94Fa PASS，W94Fb PASS_WITH_SCOPE，W94Fc PASS，W94Fd PASS，W94Fe PASS_WITH_SCOPE**
> 施工参照：[W94F Player Transport + Watch Room](./W94F_PLAYER_TRANSPORT_AND_ROOM_SPEC.md)  
> 上位计划：[W94 Unified Capability, Artifact & Public Plane](../plans/W94_UNIFIED_CAPABILITY_ARTIFACT_AND_PUBLIC_PLANE.md)

## 1. 本次落地

- 删除 `main/torrent-daemon.js` 中固定 `50` 项下载队列拒绝分支。
- 保留不同 BTIH 的主进程任务 owner、同 BTIH 幂等、暂停/恢复/重试/删除和退出收敛。
- 未改变现有 `tor:*` IPC 形状、WebTorrent 网络策略、媒体路径、Range 流和字幕读取。
- 新增 `main/player-transport-session-store.js`：Workspace/.resources 下的 durable session
  projection，原子写入、workspace identity、revision/CAS；队列运行时 Map 不再承担恢复真相。
- 重启时 `queued/downloading` 只水合为 `paused`，显式 `resume` 后才启动 WebTorrent；直接
  `tor:add`、`tor:addBuffer`、pause/resume/retry/remove 均同步 durable session。
- `main/player-transport-w93-bridge.js` 将有明确 W93 Candidate/Offer/fingerprint/selected-file
  的 Player 请求桥接到既有 `LibraryResourceSurfaceService.acquireTorrent`；Candidate-less Magnet
  仍保持媒体专属，不猜测成书籍 Job。桥接 session 持久化 `transportRef/blobRef/selectedFileRef/
  sourceRefs/capabilityRef`，W93-linked session 不会被 Player 重启水合成第二个 WebTorrent owner。
- `workspace:setCurrent` 在发布新 Workspace 前先重绑定 Player durable store；Source/Packaged A/B
  运行证据覆盖切换隔离、切回恢复与 close/reopen/replay。
- 新增 fake-runtime 合同：`51` 个不同 BTIH 同时进入主进程队列，重启水合/显式恢复，再清理归零。
- W94Fc 已把媒体、字幕消费和“存到媒体库”改为主进程 capability/Range/materialize 边界；
  详见 [W94Fc 检查点](./W94FC_PLAYER_CAPABILITY_RANGE_CHECKPOINT_2026-08-28.md)。

## 2. 定向证据

| Gate | 结果 |
| --- | --- |
| W94Fa/Fc 合同 | `node --test tests/contract/w94f-player-transport.test.mjs`：**3/3 PASS**（含 W94Fc Range/owner 失效） |
| W94Fb bridge 合同 | `node --test tests/contract/w94fb-player-library-bridge.test.mjs`：**2/2 PASS**（显式 W93 refs、重复桥接拒绝、Workspace A/B） |
| 队列门 | `51` 个不同 BTIH 均入队；无固定条数业务拒绝 |
| 幂等/控制 | 既有 W65c 合同继续覆盖同 BTIH、pause/resume/retry/remove |
| 资源 | fake client/server/torrent 在 `destroy()` 后无活动队列；临时 Workspace 已清理 |
| 隐私 | 测试只使用合成 BTIH/标题；不访问公网，不写凭据或用户正文 |
| Source Electron | [`W94F_PLAYER_TRANSPORT_SOURCE.json`](./evidence/W94F_PLAYER_TRANSPORT_SOURCE.json)：**PASS**，真实 IPC 接收 51 项，重启 paused → 显式 resume，清理后 torrent owner `0` |
| Packaged Electron | [`W94F_PLAYER_TRANSPORT_PACKAGED.json`](./evidence/W94F_PLAYER_TRANSPORT_PACKAGED.json)：**PASS**，`win-unpacked` 重跑重启门，EXE SHA-256 `e941eee4a1dfbbdfb962ab6d5b33a407206d90a7ff5ca4ab511c067219005383` |
| W94Fb Source / Packaged | [`W94FB_PLAYER_LIBRARY_SOURCE.json`](./evidence/W94FB_PLAYER_LIBRARY_SOURCE.json)、[`W94FB_PLAYER_LIBRARY_PACKAGED.json`](./evidence/W94FB_PLAYER_LIBRARY_PACKAGED.json)：**PASS**，W93 Job imported、Player session completed、Player network owner `0`、A/B `1→0→1`、重启无重复下载 |
| Runtime | Source/Packaged 均 `networkCalls=0`、`runtimeErrors=[]`；运行后 `Mazz Editor` 进程数 `0` |
| W94Fc 相邻契约 | `node --test tests/contract/player-w25.test.mjs`：**5/5 PASS**；W67 门限回归 **4/4 PASS** |
| Regression | W94Fb/W94Fe/W94E 定向合同、Source/Packaged、build/dist 通过；当前全量 `279/281`，仅 W71 release foundation 与 W72c provenance 两个既有审计漂移失败 |

## 3. 尚未通过的项

- W94Fb scope：没有 W93 Candidate/Edition/Rights Receipt 的媒体 Magnet 仍不会进入书库取得，
  这是明确的权限/身份边界而非缺口；公共公网 P2P 和跨机器 Watch Room 仍按 W94F 的显式 opt-in
  条件保留。Player/W93 桥接本身已通过定向合同与 Source/Packaged A/B 运行证据。
- W94Fc：**PASS**。旧 `tor:fileBytes` 仅保留兼容入口且已移除 32 MiB 人为门；新播放器统一走
  短命 capability + Range/流式读取。完整 Source/Packaged runtime 证据留到 W94Fe 统一补齐。
- W94Fd：**PASS**。独立 Watch Room manifest/event/epoch、显式配对 TLS 帧、成员权限、host
  transfer、断线重连和 durable replay 已落地，详见 [W94Fd 检查点](./W94FD_WATCH_ROOM_CHECKPOINT_2026-08-28.md)。
- W94Fe：**PASS_WITH_SCOPE**。Source/Packaged 两个独立 Electron Mazz 通过真实 TLS loopback
  完成显式配对、成员回传、断线重连、host transfer、新 epoch 控制、反向收敛和 close/reopen/replay；
  未配对/未知字段 fault injection、三轨帧隔离、ResourceLedger 与运行错误也有证据，详见
  [W94Fe 检查点](./W94FE_PLAYER_ROOM_BOUNDARY_CHECKPOINT_2026-08-28.md)。公网 P2P、DHT/Tracker、
  跨机器房间不在默认证据范围内。

因此不能把 W94F 或 W94 总波标成 PASS：W94F 尚有公共面、真实公网 P2P/跨机器 Watch Room 与审计红项需要后续波次收口；W94Fb 的 W93 bridge 与 Workspace A/B 切换门已闭合。
真实公网 P2P 和公共 Watch Room 仍是显式 opt-in/后置边界。
