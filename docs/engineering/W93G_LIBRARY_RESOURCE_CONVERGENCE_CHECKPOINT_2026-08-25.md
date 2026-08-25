# W93G Library Resource Convergence 检查点（2026-08-25）

> 结论：**PASS / W93 COMPLETE**
> 上位规格：[W93 Library Resource Freedom](../plans/W93_LIBRARY_RESOURCE_FREEDOM.md)
> 波次规格：[W93G Library Resource Convergence](./W93G_LIBRARY_RESOURCE_CONVERGENCE_SPEC.md)
> 权威证据：[W93G_LIBRARY_RESOURCE_CONVERGENCE.json](./evidence/W93G_LIBRARY_RESOURCE_CONVERGENCE.json)
> 运行截图：[Source](./evidence/W93G_LIBRARY_CONVERGENCE_SOURCE.png) · [Packaged](./evidence/W93G_LIBRARY_CONVERGENCE_PACKAGED.png)
> 运行边界：全程离线合成夹具；零真实书源网络、零真实书籍；Factory、Player Torrent 与来源适配器未改。
> 审查口径：按用户要求由单 owner 实施、复核和冻结；没有启用子智能体。

## 1. 本波交付

- Workspace 私有 portable catalog 只保存规范相对路径、完整 SHA-256、书目与阅读账，不保存绝对路径、凭据或远端签名引用。
- Workspace 被复制或改名后，空书架以主进程权威快照一次 CAS 恢复；原位文件先核哈希，缺档只在完整 SHA 唯一命中时重绑，多命中不猜。
- 缺档书再次导入同一完整内容时修复原 bookId 和文件位置，保留进度与书签；正常重复内容仍幂等收敛。
- Library PDF 改走 Workspace token 绑定的 `mazz-res://library/` 主进程流式端点，支持严格单 Range、HEAD、`206` 与 `416`，Renderer 不再为 PDF 整本 Base64。
- 缓存治理只计划并删除 `.cache` / `.covers` 中无引用的可重建派生物；正式书籍、Job、Inbox、Candidate、Rights、quarantine 不进入 GC。
- catalog 保存与恢复接入 Library 的创建、激活、重绑、handoff 和 dispose 生命周期；写入合并但不靠固定 timer，资源页“修复”显式承载重建与 GC 确认。

## 2. 必查结果

| Gate | 结果 |
| --- | --- |
| W93G 定向合同 | `npm run test:w93g:library`：**12/12 PASS** |
| W93A–F 相邻合同 | W93A **35/35**；W93B **82/82**；W93C **14/14**；W93D **12/12**；W93E **10/10**；W93F **9/9**，合计 **162/162 PASS** |
| Library 相邻合同 | W88 security **13/13**、final gates **17/17**、open **6/6**、dispose **24/24**、W89b **11/11**、repository **19/19**、atomic main **5/5**、atomic renderer **2/2** |
| Source BrowserWindow | portable catalog → 复制 Workspace → 书架/进度/书签恢复 → 唯一改名重绑 → PDF Range → GC：**PASS** |
| Packaged BrowserWindow | 同代 `win-unpacked/app.asar` 重跑相同链：**PASS** |
| 默认全量 | `node tests/run.js`：**271/271 个测试文件 PASS** |
| Build / Packaged 目录 | `npm run build`、`npm run dist:dir`：**PASS** |
| Release / Provenance | `npm run audit:release`：**PASS**；`npm run audit:provenance`：**CURRENT** |
| 语法 / diff | W93G 11 个 main/renderer/test 文件 `node --check`、`git diff --check`：**PASS** |
| 隐私 | 两份运行 JSON 对 Key/token/Bearer/URL/用户绝对路径扫描 **0 命中**；两张截图人工复核仅含 W93G 合成夹具 |
| 资源终态 | W93G 临时目录 **0**、产品 Electron 进程 **0**；GC plan、timer、listener、network owner 均 **0** |

## 3. Source / Packaged 运行事实

两个坐标均从真实 Library UI 和正式 IPC 进入同一主进程收敛服务，仅数据和文件为离线夹具：

1. 原 Workspace 保存含两本书的私有 catalog；复制到新 Workspace 后书架仍为两本，稳定书 `bookId=w93g-stable-text`，进度和书签都恢复；
2. 文本资产从原路径改名为 `renamed.txt` 后，以完整 SHA-256 `a09be6988d73ceab88412237ff098e2eb82a0a4ab37dbb9d4330099bceaa6898` 唯一重绑，没有生成第二本；
3. PDF 的 `bytes=5-8` 请求返回 `206`、`Content-Range: bytes 5-8/20` 与精确四字节正文；
4. GC 计划并删除一个孤立派生文件，正式 TXT/PDF 和当前引用保留；
5. Source 与 Packaged Renderer bundle SHA-256 同为 `7bee0e3ebe874febeaa7fbfb9455c89fdf340ad1bc9d47ac2c7c5416da5e9e73`；Packaged EXE SHA-256 为 `9292c91d4ab3d5b73a5b50f0184a67168f637b4e99f11b527cf261aaa2295612`；
6. 两次运行 `networkCalls=0`、`runtimeErrors=[]`，全部观察 owner 终态为 0。

## 4. 边界、失败与回滚

- 首轮全量为 `269/271`，仅 W71 release baseline 与 W72 OSS provenance 仍绑定修改前树；用仓库既有确定性生成器更新同代账本后，两条定向复验通过，第二轮全量 `271/271`，没有跳过产品失败。
- portable catalog 不是 Acquisition Job 或 Rights 账的副本；它只让用户自持书架、资产身份和阅读状态随 Workspace 搬迁。
- 零命中标缺档，多命中标冲突；系统不会自动联网换源，也不会用标题相似度代替完整哈希。
- EPUB/CBZ 仍在完整取得并通过既有容器安全门后打开；PDF Range 不意味着允许绕过路径、owner、格式或磁盘安全边界。
- GC 不按容量、年龄或条数自动驱逐，且只处理派生目录；这不是用抬高门限冒充贯通。
- 回滚单位是 W93G convergence service/IPC、portable catalog renderer、Library 生命周期接线、PDF Library 协议分支、GC 与对应测试；W93A–F 的 Candidate、Rights、取得、Inbox、来源和 Torrent 链均可独立保留。
- `docs/archaeology_v2/` 是用户原有未跟踪资料，未修改、未纳入本波提交或证据。

## 5. Final Gate

**Final Gate：PASS / W93 COMPLETE。** W93G 的 Workspace 私有目录账、完整哈希迁移与缺档修复、严格 PDF Range、派生缓存治理、Source/Packaged 同代运行、全量/构建/发布账、隐私和资源退出边界均有可复验证据；当前未发现可复现 P0/P1。

W93 不再自动推进新功能波次。后续若增加新书源、真实公网 P2P、`.torrent`、自动取得或 DRM/受控借阅能力，必须单独立项并重新经过 Rights、隐私、网络和 Source/Packaged 门。
