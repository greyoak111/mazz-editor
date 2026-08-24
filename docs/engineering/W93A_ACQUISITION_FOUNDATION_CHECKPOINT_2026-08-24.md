# W93A Acquisition Foundation 检查点（2026-08-24）

## 结论

W93A **PASS**，准入 W93B。书库资源取得已经有一套不依赖 Renderer、网络来源或 Torrent 实现的主进程事实层：严格 Candidate/Rights/Job/Inbox 合同、绑定物理 Workspace 的原子持久账、幂等选档、损坏阻断、显式重启恢复，以及不会因内部账写入而反复刷新侧栏的 watcher 边界。

本检查点不声称已经实现 HTTP 下载、断点续传、OPDS、入架 UI、Torrent 或边下边读；这些仍按 W93b–g 逐波实现。W93A 没有注册 IPC 或运行时 service，也没有真实网络坐标，因此 Source/Packaged 运行门在本波为 **N/A（未冒充 PASS）**；正式 UI 与 packaged 闭环属于 W93e/W93g。

## 实际改动范围

| 文件 | 实际结果 |
|---|---|
| `main/library-resource-contract.js` | Candidate、Rights、Offer、Job、Inbox、强身份、状态机、secret/URL/path 与 durable envelope 的严格合同 |
| `main/library-acquisition-store.js` | `书库/.resources` 原子 Job/Inbox store、revision/CAS、intent 幂等、selection rekey、显式 restart recovery、corruption 与物理路径防护 |
| `main/file-watcher.js` | 只忽略 `书库/.resources` 内部账，移除固定 watcher depth；真实深层书籍仍可见 |
| `tests/contract/w93a-library-resource-foundation.test.mjs` | 35 组合同、并发、故障、隐私、路径、重启与 watcher 回归 |
| `tests/run.js` | W93A 纳入默认离线全量 |
| `.mazz/audit/surface-census.json` | build 刷新 main surface 计数（95→97 文件）；无新依赖或能力声明 |
| W93 总设计、W93A 规格、README、检查点与证据 | 波次真相与下一准入指针 |

Factory 文件零改动；没有新增依赖、Provider、站点、网络请求或 live 测试。

## 已关闭的关键风险

- **身份与误合**：标题不作为强身份；ISBN 校验 checksum 与 978/979 前缀，OLID 区分 Work/Edition；SHA、BTIH、opaque ID 与路径不接受空白改写或对象强转。
- **Candidate 绑定**：Job 固化完整规范 Candidate 的 SHA-256 指纹；选档不能用同 ID 替换目录、Rights 或 provenance。
- **幂等与选档**：`workspace + intent + offer/transport + selectedFiles` 形成请求身份；同 intent 空选档到定稿同时锁新旧键，不同 intent 可从同一多文件 Offer 取得另一册。
- **Rights fail-closed**：passing 状态必须有 durable receipt；`restricted` 不升级，`unknown` 只能由用户权威进入 user-owned；篡改账进入 corruption。
- **持久真相**：revision/CAS、终态与 failed retry 事实不可改写；活动态只由 App 启动 owner 显式恢复；Library UI 从未打开也能保留 Inbox。
- **并发与原子性**：只接受硬链接 exclusive create，replace 使用同目录 temp/fsync/rename；不支持原子发布时明确失败；锁携随机 owner token，孤儿锁不被普通窗口擅自删除。
- **物理路径**：canonical realpath 统一 8.3/大小写别名；逐级拒绝 junction/symlink/reparse swap，所有外部写入前重验 physical roots。
- **损坏与隐私**：非普通 JSON、坏 Job/Inbox、缺字段/空 durable envelope 原样留存并阻断危险重放；嵌套 URL/query/fragment、encoded secret、绝对路径/URI 与响应凭据不得落账。
- **无业务门限**：没有 job、候选、文件、文本、token 或任意文件大小准入上限；保留的都是类型、Rights、路径、原子性与资源安全门。

## 最终验证矩阵

| 门 | 结果 | 事实 |
|---|---|---|
| W93A 专项 | **35/35 PASS** | 合同、两 Workspace、跨协调器、选档双键、reparse、corruption、restart、Inbox、watcher、无业务门限 |
| W71 watcher/lifecycle | **12/12 PASS** | watcher/torrent/进程资源账与安全回归 |
| W71 external-change | **6/6 PASS** | watcher ready、外部变化与 Chokidar 补丁回归 |
| Library atomic main/renderer | **5/5 + 2/2 PASS** | 原子导入与 Renderer receipt 事务相邻回归 |
| Library repository | **19/19 PASS** | Workspace 分区、CAS、journal 与并发迁移 |
| W88 Library security | **13/13 PASS** | XSS、压缩资源边界、Workspace/import race |
| 相邻回归合计 | **57/57 PASS** | 两轮独立审计均复跑并 CLEAR |
| 全量 | **261/261 test files PASS** | `node tests/run.js`，exit 0；默认离线 |
| 语法 | **3/3 PASS** | contract、store、watcher `node --check` |
| Build | **PASS** | `npm run build`；renderer bundle与 samples 成功生成 |
| Provenance | **CURRENT** | `npm run audit:provenance`；OSS ledger 无漂移 |
| Diff | **PASS** | `git diff --check` exit 0；仅既有 LF→CRLF 提示 |
| 独立审计 | **CLEAR / CLEAR** | `w93a_final_gate` 与 `w93a_release_review` 均未发现剩余 P0/P1 |

补充说明：在最终相邻重跑时，最初两条手工命令误用了不存在的测试文件名，得到 `MODULE_NOT_FOUND`；随后按仓库实际文件名重跑为 12/12 与 19/19，全量 261/261 不受影响。该操作错误没有执行任何产品断言，也没有被写成产品失败或隐藏。

## 网络、权利、隐私与资源边界

- 所有测试使用临时 Workspace 与本地文件系统，不读取 Key，不访问真实书源。
- PDF 研究材料只用于设计来源；没有执行其中任何站点、命令或抓取建议。
- W93A 只持久化 Rights 证据与用户权威决定，不替用户作跨法域法律判断。
- 持久错误只接受内部错误码与无 secret/绝对 URI/路径的消息；证据不记录真实用户正文、凭据或远端响应。
- Store 没有常驻 timer、socket、child process 或网络 owner；故障测试验证锁、临时文件和损坏原件的明确归属。

结构化证据：[W93A_ACQUISITION_FOUNDATION.json](./evidence/W93A_ACQUISITION_FOUNDATION.json)。

## 未关闭边界

- 尚无下载/续传/ETag/Range/重定向 DNS SSRF service；W93B/W93D 负责。
- 现有 Library Import 的 Renderer Base64 与 32/128 MiB 架构门尚未被替换；W93B 负责主进程 path/stream promotion。
- 尚无持久 Acquisition IPC owner、Browser 下载 durable 回收或 shelf Inbox consumer；W93B/W93E 负责。
- 尚无 OPDS/Gutenberg 来源、来源健康或策略 checkedAt；W93C/W93D 负责。
- 尚未接 WebTorrent；现有 Player Torrent daemon 不得被视为书库任务真相，W93F 负责。

## Final Gate 与下一精确波次

W93A 的 12 组必查、全量、build、provenance、diff-check 与两轮独立审计均为绿，结论为 **PASS**。下一波只准进入 **W93B Main Transfer & Atomic Promotion**：建立主进程流式取得/校验/materialize、持久 Job/Inbox 接线与 Browser 下载回收；仍不接真实默认网络、不接 UI、不接 Torrent。
