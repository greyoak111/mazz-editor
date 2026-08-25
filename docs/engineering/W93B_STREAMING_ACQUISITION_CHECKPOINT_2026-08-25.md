# W93B Streaming Acquisition 检查点（2026-08-25）

> 结论：**PASS / W93C NEXT**
> 上位规格：[W93 Library Resource Freedom](../plans/W93_LIBRARY_RESOURCE_FREEDOM.md)
> 波次规格：[W93B Streaming Acquisition](./W93B_STREAMING_ACQUISITION_SPEC.md)
> 权威证据：[W93B_STREAMING_ACQUISITION.json](./evidence/W93B_STREAMING_ACQUISITION.json)
> 运行边界：默认离线；没有访问真实书源、没有读取 Provider Key、没有修改 Factory。

## 1. 本波交付

- 主进程 `LibraryAcquisitionService` 持久绑定创建时 Workspace，HTTP 字节以 backpressure 流入 staging；Range/If-Range、重定向表示漂移、SSRF、暂停、取消和重启恢复均 fail-closed。
- `LibraryImportService.materializePath()` 以流式完整 SHA-256、源身份锁、长度/格式/容器校验和排他 publication 把已验证文件升格到正式书库；正式路径不走 Renderer/Base64。
- Browser Download 必须先有持久 Candidate/Rights/Job；真实 `DownloadItem` 的完成事实进入同一校验、升格和 Inbox 链，Chromium 临时文件到最终文件的合法身份交接有显式边界。
- 持久 Inbox 是事实源，Renderer 事件只作唤醒；未打开 Library、重复 wake、响应丢失、两窗口、Workspace 切换与 provisional handoff 均通过 receipt + shelf CAS 收敛。
- App 首窗前完成当前 Workspace 恢复；后来首次打开其他 Workspace 时按 identity 单飞恢复。退出按 Browser writer → acquisition service → owner 归零的两阶段耐久门执行。

## 2. 必查结果

| Gate | 结果 |
| --- | --- |
| W93B 定向合同 | `npm run test:w93b:library`：**82/82 PASS** |
| Source Electron | 启动恢复、真实离线 `DownloadItem`、Inbox→书架、双阶段退出：**PASS** |
| Packaged Electron | 同代 `win-unpacked` 坐标：**PASS** |
| 默认全量 | `npm test`：**266/266 个测试文件 PASS** |
| Build | `npm run build`：**PASS** |
| Packaged 目录 | `npm run dist:dir`：**PASS** |
| Provenance | `npm run audit:provenance`：**CURRENT** |
| 语法 / diff | W93B 主文件与 E2E `node --check`、`git diff --check`：**PASS** |
| 资源终态 | W93B Electron/Node 产品进程 `0`；`mazz-w93b-*` 临时目录 `0` |

Source 与 Packaged 都使用隔离 Session 的内存 HTTPS protocol fixture；真实网络调用为 `0`。真实 Electron `DownloadItem` 完成 1 个 1271-byte EPUB fixture，HTTP(S) 意外请求为 `0`，书架最终 1 本、Inbox acknowledged、Job imported，Browser/Service owner 最终均为 `0`。

## 3. 退出门口径

产品主进程在第二阶段 `will-quit` 同步写出仅含 owner/network/count 的观察事实。父测试进程先验证 `turn >= 2`、Browser listener 为 `0`、acquisition owner 为 `0`，再按已验证的隔离 PID 清理测试 Electron 树；这一步是测试宿主收尸，不冒充产品自行退出。产品门证明的是在允许退出前 durability 与 owner 已经收敛。

## 4. 故障与安全闭环

- 同源/跨源 redirect 不携带旧 Range/If-Range；曾发生 redirect 的部分传输恢复时从 durable 0 fresh start，不能拼接不同表示。
- pause/shutdown 在 partial、EOF、final hash、verify/materialize 各窗口都能收敛；业务失败已持久后允许退出，目录 fsync/Store publication 失败继续 HOLD。
- HTTP 与 Browser staging 在验证前后锁定文件身份；verify→promotion 还绑定 expected hash/size/identity，竞态替换不得生成正式文件。
- Reserved/本地地址、每跳 DNS/redirect、路径穿越、junction/reparse、ADS/设备名、链接与容器结构均 fail-closed。
- Inbox commit 绑定 main-owned Workspace identity/token 与持久 artifact；Windows 分隔符往返按同一物理路径校验，不接受 Renderer 任意路径。

## 5. 边界与下一波

W93B 没有接入 Gutenberg、OPDS 或其他真实来源，没有资源 UI、Torrent、渐进阅读或任意自动抓取。Reader 现有解析是否整本驻留不在本波冒充解决。

**Final Gate：PASS。允许开始 W93C Rights & Source Adapter Foundation；W93C 仍必须默认离线、只接 fixture adapter，不得提前进入真实来源包。**
