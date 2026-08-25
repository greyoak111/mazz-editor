# W93F Torrent Book Transport / 书库 Torrent 书籍运输规格

> 状态：**PASS / W93G NEXT**
> 日期：2026-08-25
> 上位设计：[W93 Library Resource Freedom](../plans/W93_LIBRARY_RESOURCE_FREEDOM.md)
> 前置：W93A–E 均 PASS；Factory 继续冻结；现有播放器 Torrent 队列保持原样。
> 用户授权：继续推进；每波必须独立检查。

## 1. 本波目标

W93F 为书库增加一条独立、可追责、可恢复的 P2P 书籍运输链：

```text
用户粘贴 public-DHT magnet 并明确知情
  → main 解析 BTIH（不补 tracker、不持久原 magnet）
  → WebTorrent metadata-only inspect（deselect:true）
  → 严格过滤并冻结可读书文件目录
  → 用户逐文件确认“有权取得”与 P2P 网络暴露
  → W93C Rights Receipt
  → W93A awaiting-selection → queued 原子选档事务
  → 只选择该书文件、流式写入 W93B staging
  → fsync / SHA-256 / 格式校验 / 原子 promotion
  → Inbox → 现有书架 CAS
```

“支持 Torrent”不等于复用播放器的内存队列。书库运输必须绑定 Workspace、Candidate、Rights Receipt、选档目录和 durable Job；App 重启后从 `infoHash + selectedFiles` 重建运输，不从 Renderer 或事件 payload 恢复事实。

## 2. 范围与非目标

### 2.1 本波交付

1. 主进程独立 `LibraryTorrentBookTransport`；metadata inspect 默认不选择任何文件。
2. public-DHT magnet 的严格 BTIH 解析；40 hex/32 base32 归一为 40 位小写 hex。
3. 只展示 `epub/pdf/txt/mobi/azw3/cbz`；完整保留合法相对路径、字节数和 format。
4. Candidate 快照冻结 exact `infoHash + selectableFiles`，选档只能属于该快照。
5. `user-owned` 明确声明与 P2P 知情确认；未经确认不启动 metadata/DHT，也不下载。
6. 同一 intent 的 durable selection、下载、暂停、恢复、重试、取消、退出收敛。
7. 只把所选文件流式写入 W93B staging；不把整种下载目录暴露给书库。
8. Source + Packaged 离线 fake swarm 运行门；真实公网 P2P 仅显式 opt-in，不作为结案唯一证据。

### 2.2 本波明确不做

- 不修改或复用 `main/torrent-daemon.js`；不改变播放器下载/播放行为。
- 不自动追加公共 tracker，不把书库任务交给播放器全局 queue。
- 不接收或持久化 tracker-bearing magnet、private torrent、Web seed、`.torrent` 文件；这些在 W93G 后另行安全评审。
- 不支持批量全选、自动下载整个种子、后台自动抓 magnet、自动 seeding 策略。
- 不绕 DRM、登录、验证码、受控借阅或来源 Rights Gate。
- 不把 magnet、peer、tracker、DHT 节点、绝对路径或响应正文返回 Renderer。

## 3. 不可协商安全边界

### 3.1 Magnet 合同

首期只接受：

```text
magnet:?xt=urn:btih:<40hex-or-32base32>[&dn=<display-only>]
```

- 必须且只能有一个 `xt=urn:btih:`；归一后必须由 W93A `normalizeInfoHash` 再验证。
- `tr/ws/xs/as/kt/x.pe/so` 等运输或选择参数一票拒绝；不静默删除后继续。
- `dn` 仅作当前交互显示，不进 Candidate identity、Job、日志或错误正文。
- 传输恢复只用 `magnet:?xt=urn:btih:<canonicalInfoHash>` 重建，绝不从 Renderer 重交原 magnet。

### 3.2 P2P 告知

metadata inspect 之前和正式取得之前都必须有当次显式 `p2pConsent === true`。UI 必须说明：

- P2P 会把公网 IP 暴露给 DHT/peer；
- 下载期间协议可能向 peer 上传已经取得的 piece；
- P2P 只是运输，不证明版权；用户必须对所选文件作 `user-owned` 声明。

确认不是可持久的“永远允许”开关；重开页面或新 intent 必须重新确认。

### 3.3 Metadata 与文件路径

- `client.add(..., { deselect: true })` 是硬合同；inspect 阶段不得调用 `select()`。
- 文件目录必须逐项是普通对象、原生 string 路径、安全非负整数 size。
- 拒绝绝对路径、空段、`.`、`..`、NUL、反斜杠歧义、ADS、设备名、尾点/尾空格和路径重复。
- 不支持格式的条目只从可取得目录过滤，不作为默认选中。
- 同一 Candidate 的 `selectableFiles` 和 format/size 事实由完整规范快照指纹绑定；同 ID 目录替换必须拒绝。

## 4. Owner 与真相层

### 4.1 Transport owner

每次 inspect 或 download 建立一个 main-owned owner：AbortController、WebTorrent client、torrent instance、选中文件 iterator 和 ResourceLedger key。任一完成/失败/取消都必须按顺序：停止 iterator → destroy torrent/client → 等 close → release ledger。不得用固定超时把未完成 owner 伪装成成功退出。

### 4.2 Acquisition owner

W93B `LibraryAcquisitionService` 继续是 durable Job 的唯一协调器。新增接口只能接受：

- canonical Workspace selector；
- durable jobId + expectedRevision；
- durable Candidate 原快照；
- 已注入的 Torrent transport。

Renderer 不得提供 staging path、target path、headers、tracker、peer 或任意 transport callback。

### 4.3 Selection 事务

取得请求先用 frozen Candidate + W93C Decision 创建 `awaiting-selection` Job，再由 Store 的受控事务提交 exactly one `selectedFiles` 路径并进入 `queued`。选档后：

- Candidate fingerprint、offerId、infoHash、selectedFiles 与 intentId 不可变；
- 同 intent 同选择精确重放；同 intent 改选显式冲突；新 intent 才能取得同一种子中的另一册；
- restart 不重新询问 Renderer 选了什么。

## 5. 流式下载与耐久边界

1. Transport 只对 exact selected path 调 `file.select()`，其他文件保持 deselected。
2. 通过 async iterator 逐块写入 Job-owned `payload.<format>.part`；不 `Buffer.concat`、不 Base64。
3. 进度事实只有在 payload fd `fsync` 后才能写入 Job bytes；pause/shutdown 必须先停止 iterator、fsync/close，再 durable paused。
4. 完成后用同一 staging inode 身份执行 W93B verify/promotion；路径替换、同长改写、hash/size 漂移均 fail-closed/quarantine。
5. `integrity.pieceVerified` 只有 transport 明确证明完整 torrent piece 校验时才为 true；否则保持 false，SHA-256/格式校验仍必做。
6. 断电/restart 将 downloading/verifying/materializing 归入既有 W93A recovery；resume 按 durable bytes 重新请求 selected file。首期允许从 0 重新传输，但必须先耐久清空旧 payload/bytes，不得拼接不一致表示。

## 6. UI 与 IPC

新增三条最小 IPC：

- `library:resourceTorrentInspect({workspacePath, inspectionId, magnet, p2pConsent:true})`
- `library:resourceTorrentCancelInspect({workspacePath, inspectionId})`
- `library:resourceTorrentAcquire({workspacePath, candidateId, candidateFingerprint, offerId, selectedFile, intentId, p2pConsent:true, rightsConfirmed:true})`

主进程返回安全投影：candidate identity、title、format、size、相对 path、Rights 状态；不返回 magnet/infoHash/tracker/peer/本地路径。Inspector 结果必须先 durable 写 Candidate catalog，再投影给 Renderer。

资源页增加折叠的“Torrent / Magnet”入口；候选文件逐项取得，不提供全选。按钮文案必须同时表达 P2P 与自有权利确认。Job 使用既有队列卡、进度、pause/resume/retry/cancel。

## 7. 退出与恢复

- 资源页 retirement/destroy abort 未提交 inspect；已进入 durable Job 的下载由 Acquisition Service 接管，不依赖 Renderer。
- App 退出：停止新 inspect/acquire → abort/等待 inspector → Browser bridge settle → Acquisition Service pause/settle HTTP+Torrent → Torrent transport clients=0 → quit。
- 任一 transport destroy/fsync/Store publication 失败都阻止“已安全退出”结论。
- `ensureWorkspaceRecovery` 对后来打开的 Workspace 同样单飞恢复；Torrent Job 不因启动时不是 current Workspace 而卡在 active state。

## 8. 必查矩阵

| Gate | 必须证明 |
| --- | --- |
| Magnet | hex/base32 正例；多 xt、tracker/private/webseed/畸形参数拒绝；不补 tracker |
| Metadata | `deselect:true`；inspect 零 select；完整安全目录；恶意 path/重复/类型失败 |
| Rights | inspect 需 P2P consent；取得需当次 consent + user-owned assertion；unknown/restricted 零传输 |
| Selection | awaiting-selection→queued exact file；目录外选档、Candidate 漂移、同 intent 改选拒绝 |
| Streaming | 仅选一文件；多 chunk；无 Base64/整种缓存；SHA/format/promotion/Inbox |
| Fault | metadata error、peer断流、fsync、Store、hash、path replacement、cancel/pause/shutdown |
| Restart | downloading→paused；resume 重建 canonical infoHash + selected file；Workspace A/B 不串 |
| Privacy | JSON/UI/日志无 magnet、tracker、peer、绝对路径、Rights 声明正文 |
| Resource | inspector/client/torrent/iterator/ledger/listener 全归零；业务失败不伪装 durability 失败 |
| Source | fake swarm 下真实 Library UI inspect→选档→Inbox→书架；runtime error 0 |
| Packaged | 同代 app.asar 重跑相同 fake swarm 及 quit/restart |
| Regression | W93A–E、Library security/atomic/repository、全量、build/dist/provenance |

## 9. Final Gate

W93F 只有在全部 Gate 绿后才可写 PASS：

1. 定向、相邻、全量、build、dist、provenance 通过；
2. Source + Packaged fake-swarm E2E 均通过；
3. 默认测试不访问公网 DHT/tracker/peer；
4. owner、进程、listener、临时目录回到基线；
5. 检查点明确首期仅 public-DHT magnet、单文件、显式 user-owned/P2P consent；
6. 任一 RED 保持 PARTIAL/BLOCKED，不推进 W93G。

本波最终事实见 [W93F 检查点](./W93F_TORRENT_BOOK_TRANSPORT_CHECKPOINT_2026-08-25.md) 与 [W93F 汇总证据](./evidence/W93F_LIBRARY_TORRENT_TRANSPORT.json)。
