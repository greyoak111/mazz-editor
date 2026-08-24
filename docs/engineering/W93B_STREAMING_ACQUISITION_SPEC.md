# W93B Streaming Acquisition / 主进程流式取得与原子升格规格

> 状态：**PARTIAL / HOLD；2026-08-26 RESUME / W93A CLEAR**
> 日期：2026-08-25
> 上位规格：[W93 Library Resource Freedom](../plans/W93_LIBRARY_RESOURCE_FREEDOM.md)
> 前置合同：[W93A Acquisition Foundation](./W93A_ACQUISITION_FOUNDATION_SPEC.md)
> 范围：主进程流式 HTTP acquisition、创建时 Workspace 绑定、原子 materialize/promote、持久 Job/Inbox 与书架 CAS 接线；不做新 UI、不注册真实来源、不默认联网、不接 Torrent、不改 Factory。

> 暂停说明：2026-08-25 按用户要求先提交推送，次日续作。主体实现与代码审计已收敛，但 Source 最终退出门、Packaged runtime、最新树全量回归和最终 evidence/checkpoint 尚未全部通过，因此本规格不得标记 PASS，W93C 不得提前启动。精确续作入口见 [W93B 暂停检查点](./W93B_STREAMING_ACQUISITION_CHECKPOINT_2026-08-25.md)。

## 1. 本波目标

W93A 已定义了 Candidate / Rights / Job / Inbox 的持久真相；W93B 只解决“字节怎么不经 Renderer 大包搬运，可恢复地进入用户书库”。

本波完成后必须得到：

- 一个单 Electron 应用实例所有的 `LibraryAcquisitionService`，按 Job 创建时的 canonical Workspace 持有 Store、运输和恢复责任；
- HTTPS 字节从主进程 response stream 直接写入 `<workspace>/书库/.resources/staging/<jobId>/`，用 backpressure 控制内存；
- 可暂停、可取消、可在进程重启后明确继续或重来的部分文件，不把半份字节写进正式书库；
- 完整流式 SHA-256、声明 checksum、HTTP 长度/断点语义与格式识别均通过后，才以排他且原子的方式升格到 `书库`；
- 即使 Library Renderer 从未打开，也会持久一条 pending Inbox；之后任意窗口重放都只能让书架 CAS 得到一本书和一个最终 `imported` Job；
- Browser Download 不再按“完成时当前 Workspace + 一次性 event”回收；只有预先登记且已有 Rights Receipt 的用户取得意图才能进持久链；
- acquisition 与 Inbox 入架路径不调用 `fs:readFileBase64`、`library:importMaterialize({base64})`、`atob`或 Renderer `ArrayBuffer` 整本复制。

本波不宣称 Reader 已经可以渐进打开 EPUB/CBZ/MOBI/AZW3；“取得/入架无 Base64”与“阅读器解析无整本复制”是两条门，后者仍属 W93G 的 ReadableAsset 收敛。

## 2. 冻结边界

### 2.1 本波进入

- 只执行 W93A `transport=https` 且 Rights 已通过的 durable Job；
- 注入式 HTTP requester / DNS resolver / filesystem / clock，使合同测试完全离线；
- Range / If-Range 恢复、完整重来、pause / cancel、流式哈希、quarantine、原子 publication；
- 主进程 Inbox 列表/完成协议与现有 `LibraryRepository.mutateBooks()` CAS 的无 UI 消费桥；
- `persist:mazz-author` Browser Download 的持久回收桥，但必须先有明确、已验证的获取意图和 Rights Receipt；
- Source 运行时离线探针，以及主进程启动/重启恢复探针。

### 2.2 本波不进入

- Gutenberg、OPDS、Open Library、IA 或任何真实 Adapter；
- 通用网页搜索、自动抓取、登录/验证码绕过、cookie 搬运、签名 URL 落盘；
- Magnet、`.torrent`、WebTorrent、Tracker/DHT、P2P 上传或 Player Torrent 队列复用；
- 资源搜索页、下载列表、权利弹窗、修复页或其他新 UI；
- Catalog 重建、跨机迁移、换源修复、PDF Range 阅读和 ZIP entry 渐进阅读；
- Factory、AI provider、prompt、字数或 token 管理。

### 2.3 无业务门限原则

W93B 不因书的字节数、文本字数、token、章节数、候选数、队列长度、文件数或任意“大小档位”拒绝任务。具体裁决如下：

- 新 path/stream 路径不读取 `LibraryImportService.DEFAULT_MAX_BYTES`，也不将 `Content-Length` 与固定上限比较；
- 队列可以用 backpressure 和资源调度等待，但不能因“队列已满”丢弃或拒绝 durable Job；
- 流管道使用有界 buffer 是内存安全手段，不是内容长度限制；
- 磁盘保护使用当前文件系统可用空间、已声明剩余字节和写入结果动态裁决；长度未知时持续流式写入，`ENOSPC/EDQUOT`、用户取消或文件系统明确失败才停止；
- SSRF、TLS、redirect、路径 containment、链接/reparse、响应完整性、checksum、格式魔数、容器炸弹与操作系统资源失败是安全门；它们必须返回可见错误和可恢复状态，不得静默少取。

现有 Renderer 手工导入的 Base64 兼容口在本波可暂时保留，但 acquisition/Inbox/Browser 持久回收链不得调用它，也不得把它的 128 MiB 架构上限写进 W93 业务合同。

## 3. 文件范围

预计施工表如下；实现前可按单一职责合并新文件，但任何产品文件越界必须先回写本节。

| 文件 | 目的 |
|---|---|
| `main/library-acquisition-service.js` | Workspace Store registry、Job owner、状态机驱动、pause/resume/cancel/restart reconcile |
| `main/library-http-acquisition.js` | 注入式 HTTPS requester、DNS/IP/redirect/Range/backpressure/流式哈希 |
| `main/library-import-service.js` | 增加 path-based 原子 promotion；新路径不解码 Base64，不继承 `maxBytes` |
| `main/library-acquisition-store.js` | 仅补足 W93B 真实所需的原子组合/查询口与 App 单实例 owner 的显式遗留锁修复；普通 Store 仍 fail-closed |
| `main/library-resource-contract.js` | 把总设计既定的可选 provenance `pageUrl` 落实为“空值允许、有值仍严格公共 HTTPS”；不放宽 Offer transport URL、Rights、secret 或 durable receipt |
| `main/main.js` | 应用单实例 owner、IPC 登记、App restart/quit 收口、Browser Download 桥 |
| `renderer/modules/library/index.js` | 无新 UI 的 pending Inbox 消费；只用 receipt path/hash 进书架 CAS，不读全文 |
| `renderer/modules/library/repository.js` | 如有必要，增加基于完整 SHA-256 的幂等入架口和 commit receipt |
| `tests/contract/w93b-streaming-acquisition.test.mjs` | 主合同、故障、恢复、无 Base64、默认离线矩阵 |
| `tests/run.js` | 正式登记 W93B 合同 |
| 本 SPEC 与 W93B CHECKPOINT | 施工规格与真实验收证据 |

Factory、Torrent/Player、真实 Source Adapter、新资源 UI 和 Reader parser 文件零改动。

## 4. 主进程拥有权与默认离线

### 4.1 Owner 模型

- Electron single-instance 主进程是 acquisition 的唯一运行 owner；Renderer、BrowserView 和 Library 签页只能提交意图或消费 Inbox。
- Service 以 W93A Store 的 `workspaceIdentity` 为注册键；构造时获得 canonical physical `workspacePath`，Job 开始后永远不再读 `store.get('workspace')` 决定落点。
- 同一 Job 最多一个活跃 `AbortController/stream/fd`；二次 start 幂等返回当前事实或 `BUSY`，不创建第二份 staging。
- 任务不绑定 IPC sender id。关闭提交者窗口不取消运输；只有显式 pause/cancel 或 App quit 收口改变 owner。
- Service 开始、结束、pause、cancel 和异常均必须登记/释放 Resource Ledger 句柄；句柄结束与持久 Job 终态分开验证。

### 4.2 启动与重启

App 取得 Electron 单实例权威后，对启动时已经打开的 Workspace Store 调用恢复；对其后首次打开的任一 Workspace，则在任何 Job/Inbox 事实对 IPC 可见前加入该 `workspaceIdentity` 唯一的离线恢复任务：

- 启动 owner 可在持有不可伪造的单实例 capability 时检查并修复已经确认不再存活的遗留 acquisition lock；修复必须记录 scope/token hash 与结果，不记录路径或 payload。普通 Store、Renderer 与运行中窗口没有此能力，畸形锁、owner 存活或归属不确定时继续 `LOCK_REPAIR_REQUIRED`；

- `downloading/verifying/materializing/awaiting-import` 先按 W93A 合同固化为 `paused + retryFrom + APP_RESTART_RECOVERY`；
- 启动恢复只扫描持久事实和已绑定 Workspace，不自动联网，不自动继续下载；
- 两个窗口并发首次访问同一 Workspace 必须共用一个 `repair → recover → reconcile` single-flight；恢复成功后本进程记为 ready，失败则不暴露事实并允许后续显式重试；启动时当前 Workspace=B 不能代表稍后打开的 A 已恢复；
- 已存在的 staging 和 transfer metadata 经路径/哈希/长度复核后保留，不安全的链接、越界或记录不一致则进 quarantine 并 HOLD；
- resume 必须由显式调用触发，并重新提交与 `candidateFingerprint/offerId/transportIdentity` 精确一致的 Candidate；
- 已 ack Inbox 且 Job 仍在 `awaiting-import`、并已固化 `bookId` 的事实可在启动 reconcile 时进入 `imported`；缺 `bookId` 或事实冲突必须 fail-closed。

App quit 时先停止新 start，中断 response，等待当前 chunk 写入和 fd `fsync/close`，再把仍活跃 Job 持久为可恢复 `paused`。不得因清理失败遮蔽主 I/O 错误。校验/升格产生的普通业务失败若已完整提交 durable `failed/awaiting-import` 事实，可以释放 owner 并退出；但只能相信执行链在 Store publication 与 directory fsync 全部返回后签发的内部完成回执，不能因为 rename 后读回了新 JSON 就猜测其已经耐久。

### 4.3 默认离线

- 构造 Service、打开 Library、列举 Job/Inbox、App 启动恢复和构建都不得触发 DNS/socket。
- 只有持有 passing Rights Receipt 的 Job 在显式 `start/resume` 后才能调用 HTTP requester。
- 默认测试 requester 是注入 fixture，必须有“若任意真实 DNS/socket 被调用就失败”的负证据。
- live 只能显式 opt-in，使用隔离临时 Workspace，不在 W93B PASS 必要证据中。

## 5. HTTP 流式运输合同

### 5.1 启动前件

`startHttp(jobId, { candidate, expectedRevision })` 只能在以下全部成立时打开 socket：

1. Job 是本 Service 绑定 Store 的 durable 事实，Workspace 物理身份未变；
2. Candidate 通过 W93A normalizer，其完整指纹、candidate/offer/provider/transport identity 与 Job 精确相同；
3. `transport=https`，Offer 包含无 secret 的 HTTPS 公共主机 `sourceUrl`；Candidate provenance `pageUrl` 可为空，但不能替代 transport URL，本波也不解析需凭据的 `acquisitionRef`；
4. Rights 为 `public-domain/open-license/user-owned` 且 Job 已有合法不可变 Receipt；`unknown/restricted` 不得触达 transport；
5. Job 处于 `queued`，或者处于可按 `retryFrom` 恢复的 `paused/failed`；
6. revision CAS 和 Job owner 获取成功，staging 路径逐级 `lstat/realpath` 复核通过。

任一前件失败都必须在发出 DNS/socket 前返回。

### 5.2 SSRF / redirect / TLS

- 只允许 HTTPS，TLS 证书和 hostname verification 保持默认严格；不提供“忽略证书”降级。
- 每一跳 redirect 都重新执行 URL secret、userinfo、协议、DNS 和所有解析 IP 分类检查；相对 redirect 先以当前安全 URL 解析再审核。
- 拒绝 loopback、private、link-local、carrier-grade NAT、multicast、unspecified、documentation/reserved、IPv4-mapped IPv6 和 literal IP；同一 hostname 只要解析集合含不安全地址就整体拒绝。
- 连接使用本次审核后锁定的地址，Host/SNI 仍是原 hostname；不允许审核一个 IP、socket 再自行 DNS 解析另一个 IP。
- redirect URL 环立即失败；为防止无穷 redirect 而保留的安全 hop budget 是协议门，越界必须报明确错误，不能把部分响应当成书。
- 不从 Candidate/IPC 接受任意 headers、cookie、Authorization、proxy 或 client certificate；任一 redirect hop（包括同源）都不转发 `Range/If-Range` 或其他潜在凭据。

### 5.3 断点与响应完整性

staging 内可持久一个严格内部 transfer record，只记录：Job/Offer/Candidate 指纹、安全 URL 的脱敏哈希、已存字节数、strong ETag/Last-Modified 校验器、声明长度和 staging 摘要。不记录 URL 原文、header、cookie、响应正文或 secret。

- 首次响应用 `200`从偏移 0 写入；`Content-Length` 如存在只用于完整性和动态磁盘判断，不用于业务拒绝。
- 有已验证部分文件时，发送 `Range: bytes=<offset>-` 和可用的 `If-Range`。
- 只有 `206` 且 `Content-Range` 起点、总长度和校验器与持久事实一致才可 append；任何不一致都关闭 response，在同一安全 staging 内 truncate 后从 0 重来，不拼接两版内容。
- 服务器对 Range 返回 `200` 表示从 0 重来；`416` 只有在本地长度与已知远端总长度一致且后续全量校验通过时才可转 verifying。
- 没有可用 validator 时，重启/重试必须从 0 重来；不冒充安全断点。
- 只要一次传输经过 redirect，就不把终点响应的 validator 持久为入口 URL 的恢复证据；中断后必须清零重取，防止同源 alias 改指向且复用同值 ETag 时拼接两版字节。
- premature EOF、`Content-Length`/`Content-Range` 不符、transfer decoding 错误、response abort 都保留已安全写入的 staging，Job 进入带脱敏 error 的可恢复 `failed/paused`，不进 verifying。

### 5.4 流管道

- response 使用 Node stream pipeline/backpressure 写 fd，同时更新 SHA-256 和字节数；不使用 `arrayBuffer()`、`Buffer.concat(allChunks)` 或经 IPC 返回字节。
- Job `bytes.received/total` 是可恢复进度事实；进度写回可合并/节流，但 pause、错误、response 结束和退出前必须强制落一个精确最终快照。
- 任何缓存/进度节流参数只能改变 UI 更新频率或峰值内存，不能丢字节、裁内容或使 Job 失效。
- 文件完成时必须 `fsync` 内容并关闭 fd，然后才从 `downloading` 进 `verifying`。

## 6. 校验、隔离与原子升格

### 6.1 Verifying

`verifying` 重新从磁盘顺序流读完整 staging，不信任运输过程中未持久的 hash state：

1. 实际长度与 Job/HTTP 声明事实一致；
2. 计算完整 SHA-256，不用截断 hash 作 Blob 身份；
3. Offer 声明 checksum 时必须精确一致；
4. 后缀、Offer format 与安全魔数/容器结构一致；
5. EPUB/CBZ 只做有界容器检查，不在 W93B 解压全内容；ZIP path traversal、超出安全资源预算的 entry/累计解压声明和结构损坏必须 fail-closed。

checksum、长度、哈希、魔数或容器安全失败时：

- payload 只能原子移入 `<workspace>/书库/.resources/quarantine/<jobId>/`；
- Job 进入 `failed(retryFrom=verifying)`，error 只保存严格 code 和脱敏 message；
- 不创建 finalPath、Inbox 或 shelf 记录；
- 不因后续重试删除 quarantine 证据，清理/保留策略属 W93G。

### 6.2 Materialize / promote

正式资产使用完整 SHA-256 作内容身份。建议叶名是经路径安全处理的展示 stem + 完整 digest + 正式后缀；标题只用于可读名，不参与 Blob 去重。

promotion 固定顺序：

```text
verifying 全绿
  → Job(materializing, integrity.sha256, exact bytes, stagingPath)
  → 复核 staging/final 的 lexical + physical containment
  → 以已 fsync staging 文件做排他原子 publication
  → fsync 正式目录；同 Blob 安全复用，同名异内容不覆盖
  → Job(awaiting-import, finalPath, integrity)
  → 幂等创建 pending Inbox
```

约束：

- 优先使用同 Workspace/同文件系统的 hard-link exclusive publication；不支持原子排他发布时明确失败，不用可见半份文件的 copy fallback 冒充原子成功；
- 已存目标只有在 regular file、字节长度和完整 SHA-256 全同时才可 `reused=true`；否则视为占位/篡改冲突，不覆盖、不用有限序号循环碰运气；
- publication 成功后的 Store/Inbox 写失败不删除完整 final；重启 reconcile 根据 Job + staging transfer record + final hash 重建缺失的 `awaiting-import/Inbox` 事实；
- publication 前失败只能清理该 Job 在 staging 内明确拥有的临时叶；不允许递归清理未重新校验的路径；
- `finalPath` 不得位于 `.resources`，不得经 symlink/junction/reparse point 越出创建时 Workspace。

## 7. Inbox → 书架 → imported 小型 Saga

W93B 不假装文件系统、主进程 Job Store 和 settings 书架是一个跨存储 ACID 事务；它用可重放的小型 Saga 收敛。

### 7.1 消费协议

Library Renderer 完成 Workspace binding 后可列举该 `workspaceIdentity` 的 pending Inbox。每条按以下顺序处理：

1. 主进程从 Store 返回 receipt 的 `receiptId/jobId/workspaceIdentity/artifact`；Renderer 不能提供或改写任意 artifact path/hash；
2. Renderer 确认 repository binding 仍是 receipt Workspace，然后直接用 `artifact.path/sha256/size/format` 做书架 CAS；
3. 书架以完整 SHA-256 去重：已有同 Blob 则返回原 `bookId`，否则新建一条 Workspace-owned book；标题可先取安全文件名，作者/封面允许后续异步补全；
4. 入架程序不读 artifact 正文，不做 Base64 或 parser 预解析；Repository 返回可重放 commit receipt，包含 `bookId/workspaceIdentity/contentHash/path`；
5. 主进程先用 revision CAS 把 `bookId` 固化到仍处 `awaiting-import` 的 Job；
6. 主进程 ack Inbox；
7. 主进程最后把 Job 从 `awaiting-import` 转为 `imported`。

只有第 1–7 步全部收敛后，Job 才是业务完成。`library:download` 一次性 event 不再是真相源。

### 7.2 重放与断点

- 第 2 步前崩溃：Inbox 仍 pending，之后重放；
- 书架 CAS 后、Job 写回前崩溃：重放按 SHA-256 得到同一 `bookId`；
- Job `bookId` 写回后、ack 前崩溃：重放 commit receipt，幂等 ack；
- ack 后、`imported` 前崩溃：App-start reconcile 使用 acknowledged receipt + Job `bookId` 完成终态；
- ack 响应丢失：重复 ack 返回同一事实；
- 两个窗口同时消费：书架 CAS 和 Store revision 冲突只允许一个发布者，输家重读已存事实并返回幂等成功；
- Workspace A/B/A 切换：每条 receipt 只能由精确的 A repository 消费，B 无法列举、ack 或书架写入 A 的 receipt。

书架 CAS 失败时 Inbox 保持 pending，Job 保持 `awaiting-import`，不删除已验证资产。

## 8. Browser Download 持久回收桥

现有 `persist:mazz-author` 链的三个根因必须同时关闭：直接落正式书库、完成时动态读当前 Workspace、Library Renderer 未建立时 event 永久丢失。

W93B 规则：

- Browser Download 只在已由可信 app renderer 预登记 `intentId + workspaceIdentity + Candidate + Rights Receipt` 后进入 acquisition；普通未登记下载仍走系统下载，不被静默宣称为 `user-owned`。
- 用户点击下载表示获取意图，不自动构成版权结论；没有 `authority=user` 的明确 Rights Receipt 时不能进 transport/promotion。权利决定 UI 属 W93E。
- `will-download` 命中预登记意图时立即固化 Workspace Store，不在 `done` 回调中重读当前 Workspace。
- DownloadItem 的 save path 是该 Job 的 staging regular file，不是 `书库/<name>`；只有 `completed` 后才走同一 verifying/promotion/Inbox 链。
- Chromium 可在真实 `done` 边界以临时下载叶原子替换预创建的空 save path；Bridge 必须在该 `done` 同步 turn 让 Service 捕获 writer-closed 最终 identity。此后 fsync、verifying 和 publication 全程锁定该 identity，任何再次替换均失败，不能把“预创建空 inode 永不变化”误作 Electron 兼容合同。
- 只接受 W93A 六种正式格式；`.azw/.fb2` 不得继续出现在 Browser 自动入库白名单。
- 远端 URL、URL chain、Content-Disposition、header、cookie 和 DownloadItem 内部对象都不持久。不透明的下载以主进程短命 handle 与 durable acquisitionRef 关联；App 重启后如无法重建该 handle，Job 保持可见 `paused` 并等待用户重新发起，不伪造自动恢复。
- Browser 或 Library 窗口关闭不删 Job/Inbox；Library 从未打开时完成的下载仍会有 pending Inbox。
- App 退出必须先等待 Electron 真实 `DownloadItem done`，再由 Service `fsync`、校验并提交 Job；不能用调用 `cancel()` 代替 writer-close 事实。格式/checksum 等业务失败在 `failed(retryFrom)` 已完整持久后应发送安全失败提示并释放 Browser owner；Store publication/fsync 失败没有内部 durable 回执，必须保留 owner 并阻止退出。

## 9. IPC / capability 边界

实际 channel 名可按项目命名约定调整，但能力面只允许：

```text
create/prepare authorized intent
start | pause | resume | cancel one Job
get/list durable Job projection
list pending Inbox for exact bound Workspace
commit one shelf receipt / ack one Inbox
```

不暴露：

- 任意 URL fetch、任意 header/cookie/proxy、任意文件写、任意绝对 staging/final path；
- response bytes/Base64、fd、Node stream、DownloadItem、Store 实例或持久锁修复口；
- 修改 Workspace/Job/Offer/Candidate 身份、伪造 checksum、绕过 Rights Receipt 或直接设为 imported 的通道。

IPC 必须确认 sender 是受信 app WebContents，不是远端 BrowserView/DevTools/未登记窗口；所有可变操作由主进程重读 durable Job 并做 revision/Workspace/capability 检查。

## 10. 状态机落地规则

W93B 不改 W93A 状态图，只实现以下部分：

```text
queued
  → downloading
  ↔ paused
  → verifying
  → materializing
  → awaiting-import
  → imported

任一本波活跃态 → failed(retryFrom=原阶段)
可安全清理的未发布态 → cancelled
```

规则：

- 状态必须在产生该阶段外部副作用前持久，完成后再 CAS 进下一态；
- `pause` 保留已 fsync staging、bytes 和 `retryFrom=downloading`；`resume` 不得清空可安全断点；
- `cancel` 只能删除该 Job 在 staging 内经重新边界校验的字节，清理完成后再固化 terminal `cancelled`；
- final 已发布或 Inbox 已建立时，本波不提供简单 cancel 删书；返回 `IMPORT_PENDING`，待 W93E 用显式 discard/repair 事务处理；
- `failed` 的 error/retryFrom 不原地改写；重试必须使用 W93A 合法 retry transition；
- `imported/cancelled` 不再启动运输，精确重放只返回既有事实。

## 11. 故障与恢复矩阵

| 故障/竞态 | 必须结果 |
|---|---|
| Candidate/Job/rights/revision 不匹配 | DNS/socket 前拒绝，durable 事实不变 |
| DNS 返回私网/混合地址 | SSRF fail-closed，无 staging 字节 |
| redirect 转非 HTTPS、私网、userinfo 或 secret URL | 关闭 response，不跟随，错误脱敏 |
| DNS 审核后 rebinding | socket 只使用锁定安全地址，不二次自主解析 |
| TLS/证书错误 | 不降级，保留安全 staging 供显式重试 |
| `206 Content-Range` 起点不符 | 不 append，安全地从 0 重来或失败 |
| ETag/Last-Modified/总长度改变 | 旧部分不与新版拼接，重新获取 |
| 同源/跨源 redirect 后中断，alias 随后改指向 | 不携带 Range/If-Range，不持久 alias validator，从 0 重取 |
| chunked/premature EOF/长度不符 | 不进 verifying，保留可恢复事实 |
| checksum/SHA/魔数/容器失败 | payload 进 quarantine，无 final/Inbox/shelf |
| `ENOSPC/EDQUOT` 或磁盘被移除 | 立即停写，关 fd，明确可恢复错误，不静默裁剪 |
| pause/cancel 恰在 chunk 写入 | 等当前写收口，落精确 bytes，无泄漏 fd/response |
| pause/shutdown 恰在 Writable finish 或最终 hash | close/error/finish 必须收敛；完整 transfer 以精确 durable bytes 进入 paused，不永久等待、不误记校验失败 |
| rename 后 Job JSON 可读，但 jobs directory fsync 失败 | 不签 durable completion receipt；shutdown/Browser dispose 明确失败并保留未收口 owner |
| 进程在 downloading/verifying/materializing 崩溃 | 重启固化 paused+retryFrom，不自动联网 |
| 进程启动于 B、之后首次打开 A | A 在首次 list/commit 前单飞离线恢复，旧 active 变 paused；并发窗口不重复恢复 |
| staging 被换成 symlink/junction/non-regular | 边界复核失败，不读写外部路径 |
| 并发两次 start/resume | 一 owner，另一个幂等快照/BUSY，无第二份字节 |
| Workspace 在下载中 A→B | Job 仍写 A；B 不可见/消费 A Inbox |
| 目标同名同内容 | 完整 SHA 验证后安全复用 |
| 目标同名异内容/占位 | 不覆盖，不用有限循环绕过，明确冲突 |
| final 已发布、Job/Inbox 写失败 | 保留完整 final，reconcile 补事实，不删成功资产 |
| Library 从未打开 | pending Inbox 持久，零事件依赖 |
| 书架 CAS 或 settings read 失败 | Inbox 仍 pending，Job 仍 awaiting-import，重试不丢书 |
| 两窗口同时消费 | 同 SHA 只一 bookId，Inbox ack/Job imported exactly-once |
| ack 响应丢失/应用在 ack 后崩溃 | 重放或启动 reconcile 收敛为同一 imported 事实 |
| Browser Download URL 含签名/cookie | URL/header 不落 Job/Inbox/evidence；无可恢复 handle 则明确 paused |
| 孤儿锁/损坏 Job/Inbox | 继承 W93A fail-closed，不自动删锁或猜幂等归属 |
| 清理与主 I/O 同时失败 | 保留主错误，附加 cleanup error，不吞因 |

## 12. W93B 每波必查

验收顺序固定，不得跳过失败项直接写 PASS：

```text
实现冻结
  → Scope audit
  → node --check / 合同测试
  → W93A + Library import/repository + W71 watcher 相邻回归
  → Security / durability / privacy / resource audit
  → 默认离线 Source runtime probe
  → node tests/run.js 全量
  → npm run build
  → git diff --check
  → 独立只读 reviewer
  → 修正后从受影响门开始复跑
  → W93B CHECKPOINT：CLEAR 或 HOLD
```

### 12.1 定向合同矩阵

1. 小 fixture、多 chunk fixture、Content-Length 未知 fixture 均只在主进程流式落盘；
2. 一个超过旧 `DEFAULT_MAX_BYTES` 的 sparse/generated fixture 能走完 path pipeline，测试不需把它全量读入内存；
3. 静态与运行时证据同时证明 acquisition 没有 `Base64/atob/readFileBase64/Buffer.concat(all)` 路径；
4. Range 200/206/416、If-Range、validator 变更、premature EOF、无 validator 重来、同源/跨源 redirect drift 全矩阵；
5. 每跳 redirect/DNS/IP/TLS 安全矩阵，含 IPv4-mapped IPv6 和 DNS mixed-answer；
6. pause/resume/cancel/App quit/process restart，含 Writable finish、最终 hash、业务失败与 directory-fsync 失败分类，字节、fd、response、Resource Ledger owner 全收口；
7. 长度/checksum/hash/魔数/容器失败只进 quarantine，绝不出现 final/Inbox/shelf；
8. atomic promotion 的创建、复用、冲突、不支持 hard-link、fsync 和失败后 reconcile；
9. Library 未打开、多窗口、书架 CAS 失败、ack 丢失、重启、启动 B 后延迟打开 A 和 A/B/A Workspace exactly-once；
10. Browser Download 只消费预登记授权意图，六格式精确，signed URL/cookie 不落盘，真实 done 后业务失败可退出而持久化失败继续 HOLD；
11. 构造、列表、Library 打开和启动恢复的默认网络调用计数恒为 0；
12. Factory diff 为 0，Torrent/Player/Source UI 无越界。

### 12.2 资源与无门限审计

- 审查新增 `maxBytes/maxFiles/maxJobs/maxQueue/maxTokens/wordLimit/pageLimit`、固定循环上限和截断 slice；任何命中必须说明是安全/缓冲门还是业务门。
- 安全资源门必须有可见 error code、不得返回部分书，且在可恢复场景保留 retryFrom/staging。
- 验证 stream/fd/response/AbortController/Store owner/Resource Ledger 在成功、错误、pause、cancel、窗口关闭、Workspace 切换和 App quit 后没有泄漏。
- 大 fixture 测试记录峰值 RSS 和 Renderer IPC payload 大小趋势，不用某个固定性能数字作业务通行证；只要证明内存不随整书线性复制。

## 13. Final Gate

只有以下全部成立才能写 `W93B PASS / W93C NEXT`：

- W93A 的最终 Checkpoint 为 PASS/CLEAR，且 W93B 没有放宽其 schema、rights、secret、path 和 Store 不变量；
- HTTP 流式落盘、Range 恢复、完整校验、quarantine 和原子 promotion 合同全绿；
- acquisition/Inbox 对超过旧 Renderer 上限的 fixture 不产生 Base64/Renderer 整本副本；
- Library 从未打开、多窗口、App 重启、ack 丢失和 Workspace A/B/A 都以一个 Blob、一个 bookId、一个 acknowledged Inbox 和一个 imported Job 收敛；
- Browser Download 不再直接写正式书库或依赖瞬时 `library:download` 事件，也不把点击下载自动写成版权结论；
- 默认合同、全量、build 和 Source runtime probe 的真实网络调用为 0；W93B 不使用 live 结果替代 fixture 证据；
- `node --check`、W93B 定向、W93A/Library/W71 相邻、`node tests/run.js`、`npm run build`、`git diff --check` 真实通过；
- W93B Checkpoint 记录实际命令、计数、故障注入、资源收口、默认离线、无门限审计、未完成边界和文件哈希；
- 独立只读 reviewer 明确给出 `CLEAR`，没有 P0/P1 未关闭。

若任一项不成立，状态保持 `HOLD`，不得开始 W93C。

W93B PASS 不等于：已接入真实书源、已对任意网页登录下载做版权判定、已支持 Torrent、已支持边下边读、已完成 Workspace catalog 迁移，或已消除现有 Reader 所有整本解析副本。
