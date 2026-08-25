# W93F Torrent Book Transport 检查点（2026-08-25）

> 结论：**PASS / W93G NEXT**
> 上位规格：[W93 Library Resource Freedom](../plans/W93_LIBRARY_RESOURCE_FREEDOM.md)
> 波次规格：[W93F Torrent Book Transport](./W93F_TORRENT_BOOK_TRANSPORT_SPEC.md)
> 权威证据：[W93F_LIBRARY_TORRENT_TRANSPORT.json](./evidence/W93F_LIBRARY_TORRENT_TRANSPORT.json)
> 运行截图：[Source](./evidence/W93F_LIBRARY_TORRENT_SOURCE.png) · [Packaged](./evidence/W93F_LIBRARY_TORRENT_PACKAGED.png)
> 运行边界：fake swarm、零公网、零真实 DHT/tracker/peer；未下载真实书籍，未修改 Factory 或播放器 Torrent 队列。
> 审查口径：按用户要求由单 owner 实施、复核和冻结；没有启用子智能体。

## 1. 本波交付

- 新增独立 `LibraryTorrentBookTransport`，不复用播放器的内存 Torrent 队列；WebTorrent client 禁用 tracker、LSD、Web seed、NAT 映射与上传，metadata 以 `deselect:true` 打开。
- Magnet 只接受一个 canonical BTIH 与可选显示名；tracker、webseed、私有来源、预选文件、多 `xt` 和未知参数全部 fail-closed，不持久原 magnet。
- metadata 目录严格规范化，只投影六种书库可读格式；绝对路径、穿越、ADS、设备名、反斜杠、重复和非规范名称拒绝。
- 用户先显式同意 P2P 暴露再检查；每次取得还必须重新确认 P2P 与“用户自有/已获许可”。Candidate 固化目录与 fingerprint，选档只能命中冻结目录中的一个文件。
- 下载按 async iterator 多块写入 Job-owned staging；进度只有在 payload `fsync` 后入账，pause/shutdown/restart 保留耐久状态，完成继续走 W93B SHA-256、格式校验、排他发布、Inbox 与书架 CAS。
- 资源页增加 Torrent / Magnet 折叠入口、逐文件按钮和双确认；未提交的 inspect 以 opaque `inspectionId` 取消，隐藏、handoff、retirement、destroy 不遗留 metadata owner。
- Renderer 只收到 Candidate/Offer/Job 安全投影；不返回 magnet、infoHash、tracker、peer、绝对路径或权利声明正文。退出门等待 inspector、Acquisition、Torrent client/iterator/ledger 全部收敛。

## 2. 必查结果

| Gate | 结果 |
| --- | --- |
| W93F 定向合同 | `npm run test:w93f:library`：**9/9 PASS** |
| W93A 相邻合同 | **35/35 PASS** |
| W93B 相邻合同 | **82/82 PASS** |
| W93C 相邻合同 | **14/14 PASS** |
| W93D 相邻合同 | **12/12 PASS** |
| W93E 相邻合同 | **10/10 PASS** |
| Source BrowserWindow | fake metadata → 逐书确认 → 多块下载 → 校验 → Inbox → 书架 → 重启：**PASS** |
| Packaged BrowserWindow | 同代 `win-unpacked/app.asar` 重跑同一 fake swarm 与重启链：**PASS** |
| 默认全量 | `node tests/run.js`：**270/270 个测试文件 PASS** |
| Build / Packaged 目录 | `npm run build`、`npm run dist:dir`：**PASS** |
| Release / Provenance | `npm run audit:release`：**PASS**；`npm run audit:provenance`：**CURRENT** |
| 语法 / diff | W93F main/renderer/E2E `node --check`、`git diff --check`：**PASS** |
| 隐私 | 两份运行 JSON 对 magnet/BTIH/tracker/peer/绝对路径/凭据扫描：**0 命中**；两张截图人工复核通过 |
| 资源终态 | W93F 临时目录 `0`；W93F/Electron 产品进程 `0`；Torrent/operation/background/controller owner 全为 `0` |

## 3. Source / Packaged 运行事实

两个坐标都从实际 Library “资源”页操作，fake transport 只替代公网 swarm，不替代产品 service、IPC、Rights、Job、校验、Inbox、Repository 或 UI：

1. UI 必须先勾选 P2P 暴露确认，检查后只显示一个 TXT 文件；metadata 阶段没有选择文件；
2. 取得前还必须勾选用户自有/已获许可，随后只选 `books/w93f-fixture.txt`；
3. 56 字节内容分块写入，`pieceVerified=true`，最终 Job 为 `imported`；
4. 关闭并重启后书架仍有同一本书，任务仍为 imported，没有重复传输或重复入架；
5. Source 与 Packaged 的 Renderer bundle SHA-256 同为 `e4dae56fa63648c9d0848b3bd5ac81b2395b0fc6e4ca54a25fbf39504f7ca7ef`；Packaged EXE SHA-256 为 `fb3cf6fcc17754a565fd2fcc6d9d84284a31adaa774fb37f3312ab86c2e61962`；
6. 两次运行 `publicNetworkCalls=0`、`runtimeErrors=[]`，owner 终态均为 0。

## 4. 边界、失败与回滚

- 首轮全量为 `268/270`：W71 release audit 与 W72 OSS provenance 仍绑定修改前清单。用仓库既有确定性生成器更新同代账本后，两项定向通过，第二轮全量 `270/270`；没有跳过产品失败。
- 本波没有运行真实 DHT、tracker 或 peer；真实 P2P 仍必须由用户在产品内显式触发。运行证据只能证明零公网 fake-swarm 的产品链与隔离边界，不能声称任意公网 torrent 可用。
- 首期只接受 public-DHT magnet、单书逐项取得；`.torrent` 文件、私有 tracker、Web seed、批量全选、自动 seeding、DRM/受控借阅均不在本波。
- `pieceVerified` 不替代完整 SHA-256、格式和容器校验；路径、ZIP bomb、磁盘不足与协议完整性安全门继续保留，不属于字数/token 业务门限。
- 回滚单位是 W93F transport、Acquisition magnet 分支、资源服务/IPC/UI 接线和对应测试；W93A–E 的 HTTP、Rights、Candidate、Inbox 与书架链不依赖 W93F。
- `docs/archaeology_v2/` 是用户原有未跟踪资料，未修改、未纳入本波提交或证据。

## 5. Final Gate 与下一波

**Final Gate：PASS。** W93F 的严格 magnet、metadata deselect、单书选档、双确认、流式耐久下载、暂停/重启、校验入架、Source/Packaged UI、隐私和资源退出边界均有可复验事实，当前未发现可复现 P0/P1。

下一精确波次是 **W93G Portability & Convergence**：Workspace catalog 重建与迁移、缺档重新定位/换源、PDF Range、缓存治理和 W93 总封板；不会把 W93F 首期边界暗扩成任意 tracker 或自动批量下载。
