# W94F Player Transport + Watch Room 检查点（2026-08-27）

> 结论：**PARTIAL / W94Fa PASS，W94Fb 重启切片 PASS · 其余 PARTIAL，W94Fc–Fe 未开始**  
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
- 新增 fake-runtime 合同：`51` 个不同 BTIH 同时进入主进程队列，重启水合/显式恢复，再清理归零。

## 2. 定向证据

| Gate | 结果 |
| --- | --- |
| W94F 合同 | `node --test tests/contract/w94f-player-transport.test.mjs`：**2/2 PASS** |
| 队列门 | `51` 个不同 BTIH 均入队；无固定条数业务拒绝 |
| 幂等/控制 | 既有 W65c 合同继续覆盖同 BTIH、pause/resume/retry/remove |
| 资源 | fake client/server/torrent 在 `destroy()` 后无活动队列；临时 Workspace 已清理 |
| 隐私 | 测试只使用合成 BTIH/标题；不访问公网，不写凭据或用户正文 |
| Source Electron | [`W94F_PLAYER_TRANSPORT_SOURCE.json`](./evidence/W94F_PLAYER_TRANSPORT_SOURCE.json)：**PASS**，真实 IPC 接收 51 项，重启 paused → 显式 resume，清理后 torrent owner `0` |
| Packaged Electron | [`W94F_PLAYER_TRANSPORT_PACKAGED.json`](./evidence/W94F_PLAYER_TRANSPORT_PACKAGED.json)：**PASS**，同代 `win-unpacked` 重跑重启门，EXE SHA-256 `a13a0c9203dc2937d6947518eeff35fc8af2e87c238b2a6b06fb41eade55a8a9` |
| Runtime | Source/Packaged 均 `networkCalls=0`、`runtimeErrors=[]`；运行后 `Mazz Editor` 进程数 `0` |
| Regression | 全量 `277/277`；`build`、`dist:dir`、provenance、secret、release、W71 census、`git diff --check` 全绿 |

## 3. 尚未通过的项

- W94Fb remaining：Player 的媒体 Magnet 可能没有 W93 Candidate/Edition/Rights Receipt，本次
  已落 Workspace durable session projection；有 Candidate 的书籍仍由 W93 Acquisition
  Service 负责，二者尚未完成“单一 W93 Job projection”的正式桥接；Workspace A/B 切换门也
  尚未闭合。因此只记“重启切片 PASS / W94Fb PARTIAL”，不把它写成整波通过。
- W94Fc：现有 Player 仍有 `tor:fileBytes` 的内联读取路径，尚未统一为短命 capability +
  Range/流式读取。
- W94Fd：本地/LAN watch room manifest、epoch、host transfer、断线重连尚未施工。
- W94Fe：本波 Source/Packaged 重启与真实双端 room 证据尚未生成。

因此不能把 W94F 或 W94 总波标成 PASS；下一施工项是先冻结 PlayerTransportAdapter 的
durable projection，再做 Source/Packaged 重启故障注入。真实公网 P2P、第二个 Mazz 实例和
公共 Watch Room 仍是显式 opt-in/后置边界。
