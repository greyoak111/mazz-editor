# W88 Library / Reader Convergence

> 状态：**EXECUTED SCOPE RESEALED**
> 日期：2026-08-21
> 目标：把现有书库从“能打开多种格式”收敛为可长期托付真实藏书、在大书与漫画上仍保持有界资源和连续手感的本地阅读工作台。
> 最终检查点：[W88 Library / Reader Convergence Checkpoint](../engineering/W88_LIBRARY_READER_CONVERGENCE_CHECKPOINT_2026-08-21.md)

## 1. 产品目标与边界

维护者提出的体验参照是 Neat Reader，并提到“nanview”。本波将后者按 **NeeView** 理解；这是基于“压缩包/文件夹即书、双页、预读、缩放与手势”的高匹配推断，不冒充原名已得到确认。

W88 不以复制某一产品界面为目标，而是融合三条能力线：

```text
Neat Reader     → 书架、重排阅读、检索、偏好与低干扰阅读体验
NeeView         → 漫画双页求解、有界预读、手势/命令、缩放与连续翻页
Mazz local-first→ Workspace 分权、证据定位、笔记桥、LAN 进度与资源生命周期
```

本波不做 Universal Asset DB、Graph 重构、云账号、DRM 破解或服务器运维；不以新增格式数量替代已有格式的正确性。

## 2. 开源研究与许可裁决

| 项目 | 许可/研究坐标 | 本波吸收 | 裁决 |
|---|---|---|---|
| [NeeView](https://github.com/neelabo/NeeView) | MIT；release 46.3 / `686a43362dc4b3c9f2ea014240dbba2d0e9fbcaa` | Facing/spread、预读缓存、输入命令、页就绪后切换、旧帧保留 | 可借行为与算法思想；本波实现为原创 JS |
| [Readium CSS](https://github.com/readium/css) | BSD-3-Clause；v2.0.5 / `ffd817b73601818c4775c14c1f21fc18e8c75e69` | EPUB reflow、主题/用户设置、国际化与无障碍基线 | 后续只允许固定版本 Adapter；不误用于 FXL/漫画 |
| [Readium Web](https://github.com/readium/web) / [TS Toolkit](https://github.com/readium/ts-toolkit) | BSD-3-Clause；相关 package 必须成组锁定 | Publication/Navigator/Preferences/Decorator 分层 | 作为长期 Adapter 目标，不在本波整体换核 |
| [Thorium Reader](https://github.com/edrlab/thorium-reader) | BSD-3-Clause；v3.4.0 / `474491641d7a8051edfcbb7127b148092c2e2252` | Electron 隔离、书库/阅读器边界、无障碍验收 | 参考工程边界，不复制 UI |
| [foliate-js](https://github.com/johnfactotum/foliate-js) | MIT；无稳定 release；`78914aef4466eb960965702401634c2cb348e9b1` | Book interface、Paginator、CFI、Search、Overlayer | 只允许 pinned commit + Adapter + CSP 双轨 PoC；本波不直接入产品依赖 |
| [epub.js](https://github.com/futurepress/epub.js) | 官方 package 声明 BSD-2-Clause；GitHub License API 为 `NOASSERTION`；v0.3.88 / `a1e77b745ba3d0ba122d70d276a08afe44270d17` | section/rendition、连续/分页、CFI 经验 | 两种许可证元数据都保留；不得把 `NOASSERTION` 写成“无许可证”，禁止 caret/branch 漂移，不以整库替换现有主链 |
| [Komga](https://github.com/gotson/komga) | MIT；v1.26.3 / `4cabeb8abd05ddfff473a8f850a3c33c8f9e9aa1` | Scan → Analyze → Metadata/Thumbnail 分阶段；重复检测 | 作为后续大藏书入库管线蓝本 |
| [Readest](https://github.com/readest/readest) | AGPL-3.0-or-later | 只观察行为、交互与测试方法 | 禁止复制代码、CSS、资产或近似翻译进入当前 MIT 产品 |
| [Koodo](https://github.com/koodo-reader/koodo-reader) / [KOReader](https://github.com/koreader/koreader) / [Kavita](https://github.com/Kareadita/Kavita) | AGPL/GPL 系；逐项目仍须固定精确版本和许可证据 | 只观察行为、交互与测试方法 | 禁止复制代码、CSS、资产或近似翻译进入当前 MIT 产品 |

准确口径是：**W88 本轮未引入上述第三方运行时依赖，也未 vendor/import 上述项目源码。** Komga 按 tag `1.26.3` 记录；epub.js 同时记录官方 package 的 BSD-2-Clause 声明与 License API `NOASSERTION`。这句话只约束 W88 增量，不替代对更早历史实现的独立 provenance 审计。若后续 vendoring，必须先锁 commit、许可证、来源、hash、NOTICE 与回滚基线。

Readium 组若进入后续 PoC，候选基线必须成组记录：`navigator@2.8.2` / `893a5cc362605ad19f1be1d905159c1b7282c68d`、`decorator@1.0.2` / `1faa458ffafb9d3746478edad8829261e179a412`、`shared@2.4.0`、`navigator-html-injectables@2.6.3` / `1a859b4a7276a13dcbf2d9c4795d411d97e4b23b`；不得只升级其中一包。

## 3. 根因债务图

### 3.1 数据与 owner

- 旧书架、分类、进度与书签使用全局 key，Workspace 之间可串藏书。
- `openBook()` 曾在异步候选尚未就绪时改写共享 owner，旧请求可迟到覆盖新书。
- 进度调用时抓到的位置与异步写入时读取的书 ID/path 不属于同一快照。
- 多个 Library 页签各自监听下载事件，一次下载可能重复导入。
- 导入曾把 session `blob:` 封面持久化，重启即失效。

### 3.2 驻留与连续性

- EPUB 滚动/分页曾整书 materialize，章节图片 URL 到离书才释放。
- CBZ 滚动曾一次解压并挂载全部页面。
- 预处理缓存曾并行吃完整本书，关签后仍可继续。
- 返回书架只释放部分格式，iframe/object URL/缓存 owner 无统一出口。

### 3.3 体验与可达性

- 书架缺少搜索、排序、最近阅读、进度、收藏、缺失源状态和大藏书虚拟化。
- 阅读外观偏好混入 locator，切书/重开不能可靠恢复。
- host 与 sandbox iframe 的键盘/手势没有统一命令边界。
- 漫画双页只是机械 `(n,n+1)`，未处理封面单页、奇数尾页、RTL、宽跨页与配对偏移。

## 4. 目标架构

```text
LibraryRepository (Workspace-scoped shelf/categories/progress/bookmarks)
        │
        ├── ShelfViewModel (query/sort/filter/facet/virtual window)
        ├── ImportCoordinator (single owner/idempotency/stable cover)
        └── ReaderSession (candidate → atomic commit → close)
                    │
                    ├── LibraryLocatorStore (position/evidence/LAN projection)
                    ├── ReaderPreferencesStore (appearance only)
                    ├── ReaderInputController (host + iframe semantic commands)
                    └── BookAdapter
                         ├── EPUB/Cache → TextViewport current ± 1
                         ├── CBZ/Manga → ComicViewport current -2/+3
                         └── SpreadPlanner (cover/parity/wide/RTL)
```

不变量：

1. Asset 是文件事实；Session URL 绝不进入持久记录。
2. Candidate 完整就绪后才原子替换 current owner；过期/失败 candidate 必须 close。
3. Locator 与 Appearance 分仓；位置投影到 `MazzProgress`，外观不污染证据定位。
4. EPUB/CBZ 的 **decoded/materialized viewport resident set** 必须与总章/页数无关；这不等于压缩源已支持随机访问。当前实现仍会把不超过 `128 MiB` 的受支持 ZIP/CBZ/EPUB 压缩源整包读入 renderer，超限拒绝；真正的 random-access archive adapter 属后续工作。
5. 返回书架、换书、关闭页签、失败开书和应用退出只走一个幂等释放口。
6. 第三方出版物元数据只通过文本节点/受控 URL 进入壳 DOM；书内脚本默认不可执行。
7. Workspace A/B 的同 ID/同名书在物理存储与视图上均不得串写。

## 5. 实施波次

| 子波 | 内容 | 最终状态 | 退出门 |
|---|---|---|---|
| W88a | Repository、locator snapshot、candidate open、稳定封面、单例自动入库 | **PASS** | Workspace 分权、A/B/A 资产指纹、候选事务/last-healthy 回滚、稳定封面与幂等导入合同通过 |
| W88b | EPUB/Text 与 CBZ/Comic 有界 viewport、统一释放 | **PASS（decoded/materialized viewport）** | Source + Packaged：100 章 EPUB text resident/DOM chapter max 3、loaded max 5、live URL max 6、composite gate max 7；300 页 CBZ resident/cache max 6；back 后归零；压缩源仍在 `≤128 MiB` 支持包络内整源驻留 |
| W88c | SpreadPlanner、输入命令、阅读偏好与连续 locator | **PASS** | spread 合同通过；Enter 后产品自动 `IFRAME→BODY`，PageDown 只投递一次；工具栏不被迟到抢焦点；scroll locator 模式往返/重开误差 ≤0.03 |
| W88d | ShelfViewModel 与大藏书虚拟书架 | **PASS（执行范围）** | 1,000 书 Source + Packaged E2E actual DOM max 40 ≤ 96；深层 `book-640` 8→4→8 保持 stable key/offset/focus；10k 只通过 model/contract |
| W88e | 安全、竞态、关闭持久化与降级合同 | **PASS（执行范围）** | 恶意元数据、迟到 owner、关闭 flush、坏页/边界合同通过；missing 仅明确 ENOENT，权限/桥/解析失败不误标；屏幕阅读器、物理输入与广谱坏书仍在后续矩阵 |
| W88f | Source + Packaged + full suite + lifecycle + release/provenance/secrets | **PASS** | 双态 residency 各 `6/6`、experience 各 `8/8`；补登记既存 W87 Browser composition 合同后全量 `247/247`；packaged 跨窗 20 轮/42 次交接；build、release PASS、provenance CURRENT、secrets PASS |

## 6. 已执行 Definition of Done

### Correctness

- A/B/A 交错开书的资产/渲染 fingerprint 稳定，退役 owner 的 iframe/blob/cache 为 0。
- Candidate 只有在完整渲染成功后才替换 current；失败恢复 last healthy owner，迟到 candidate 不得复活。
- 两个 Workspace 使用同 book id/同文件名时，Repository、locator、偏好 key 与书架投影分权。
- 页签关闭与应用关闭等待异步 detach/flush；超时只作为主进程退出保险，不伪装成功写入。
- 跨窗口标签移动是三阶段耐久交接（3PC）：源 owner 冻结并形成严格快照，目标先以 provisional/inert 状态 `prepare`，源通过耐久关闭后才 `commit`，最终唯一快照 owner 封印后 `finalize`；丢失 finalize ACK 时只允许按同一 `transferId` 幂等重询。重复文件 NACK、目标销毁或任一阶段失败都必须保留源，不能出现“双边都删”或双 owner。
- 整窗关闭复用保存/不保存/取消语义，并以两阶段协议（2PC）执行：先 `beforeClose`、`modules.prepareAll()`、严格快照与阅读进度 flush；全部成功后才 `commitPrepared()` 一次性拆 owner。取消/持久化失败执行 `abortPrepared()` 并保持窗口可用；活 renderer 的超时只提示继续等待，只有 renderer 已销毁才允许 `renderer-gone` 收尸旁路。
- 缺失源只由明确 `ENOENT`（或无矛盾 error code 的显式 negative stat）触发；`EACCES`、`EPERM`、bridge failure 与损坏解析均不能写 `missing:true`，成功打开会清除旧 missing。

### Residency / responsiveness

- 100 章含图 EPUB 在 Source / Packaged 的分页与滚动模式均保持 decoded/materialized viewport 有界：text resident/DOM chapter max 3、actual loaded max 5、live URL max 6，composite resident gate max 7、门限 7；返回书架归零。
- 300 页 CBZ 在 Source / Packaged 跳转矩阵中 decoded/materialized resident/cache max 6，等于门限 6；返回书架归零。
- 上述 resident 数只描述已解码/已物化的阅读窗口。当前压缩源在 `≤128 MiB` 支持上限内仍整包驻留；超过上限拒绝，未把 random-access archive I/O 冒充已完成。
- 1,000 书 Source / Packaged Electron E2E 的首屏与远端滚动 actual DOM 均为 40，低于门限 96。
- 深层虚拟窗口在 `book-640` 处执行 `8 → 4 → 8` 列 resize，以 stable key + viewport offset 保持阅读上下文和聚焦卡，不拿旧 row index 制造跳跃。
- 10k 只由 ShelfViewModel/virtual-window 合同证明复杂度有界；当前没有把 10k 写成真实 Electron E2E 结论。

### Product behavior

- 书架支持搜索、最近/标题/作者/进度/导入时间排序、分类/格式/收藏/缺失筛选。
- 每本书显示全书进度/状态；62% 全书进度不会退化为 17% 章序比。
- Enter 开书后由产品自动完成 `IFRAME → BODY` 焦点交接，测试不强制 focus；顶层 `PageDown` 在 frame BODY 捕获一次并将 chapter `1 → 2`。用户随后聚焦目录按钮，双 RAF + 360ms 后仍不被迟到 retry 抢走；Back 会把焦点还给原虚拟书卡。
- 连续模式的 locator 使用 `sectionId/spineItemId + section-relative ratio + progression`；最终 Source/Packaged 的 seeded、模式往返和返回书架后重开三态完全一致：`section=2`、`sectionId=chapter-03`、`ratio=0.44866`、`progression=0.61216`、`scrollTop=1368.8`。
- 双页覆盖封面单页、奇数尾页、配对偏移、宽跨页与 RTL；不得跨 wide boundary 错配。
- 字号、行高、字体、页宽、主题、模式、方向、漫画缩放与 spread 偏好重开可恢复。

### Security / release

- 恶意 title/author/category/TOC 不得创建执行节点或触发 preload API。
- 封面只能是受控 `mazz-res://media`、受控 raster data 或当前 session blob；持久记录不得是 blob。
- Source 与 Windows packaged 使用同一 100 章/300 页 residency 门（各 `6/6`）和 1,000 书 experience 门（各 `8/8`），四份证据 runtime error 均为 0。
- Packaged 跨窗 E2E 完成 20 轮、42 次成功 transfer；134 个阶段探针与 43 个 command 全 PASS，稳定资源账为 `2→3→2`。循环 command 为 `185–431ms`、平均 `251.6ms`，首次创建子窗为 `3240ms`；重复文件 NACK 保留双边原状态，最终只有一个 live owner 与一个 recovery snapshot。
- 此前一次“卡死”不是产品 3PC 卡住：runner 把瞬态 `agent-cli-process` 计入稳定资源，并让故意保留的 dirty 测试标签在 teardown 打开模态框。现 runner 使用稳定资源账、分阶段超时与有界清理，产品三阶段协议未因测试收尸问题改写成弱一致。
- 独立总入口审计发现既存 `w87-browser-composition` 合同此前未登记进 `tests/run.js`；该合同单跑 `6/6`，补登记后最终全量为 `247/247`，不再以漏项 runner 冒充全量。build、release audit PASS、provenance CURRENT、secrets audit PASS；renderer bundle SHA-256=`f8029974e094fb4db980b7e3fabe41afc56754dae9e2399dd18a08c2d1b2c833`；packaged `app.asar` SHA-256=`76a626425f305590216653f9f6f341fae652de85da494e5feab18bf62d0c76c3`，其内嵌 renderer bundle SHA-256 同为 `f8029974e094fb4db980b7e3fabe41afc56754dae9e2399dd18a08c2d1b2c833`。W88 新增上述第三方运行时依赖为 0；Computer Use 被禁用且本轮未使用。
- 最终 packaged EXE 为 `188,784,128` bytes / SHA-256 `9abce0f64882d7983364cc0ad266d3106a6a5d41289c5e770a83f9efb3a770bd`；NSIS 为 `134,147,142` bytes / SHA-256 `878bbd97b9a3bad12da8f817fdd933614ae223210826f469960e9a37bf94d5ab`；blockmap 为 `138,840` bytes / SHA-256 `d9a97c5a22e62a4776ec99d2487858091b8e1463e649349a8aacc3dfad79ba10`，仍未签名。

## 7. 封板边界与后续候选

- 完整 EPUB3 Fixed Layout、Media Overlay、嵌套 NAV/NCX、publisher CSS 保真与规范 CFI。
- CBR/7z、ComicInfo.xml、自动裁边、旋转、色彩/锐化、放大镜与多显示器全屏。
- Highlight/Annotation/Search 统一 CanonicalLocator、OPDS、本地词典/TTS。
- Readium CSS / Readium Web / foliate-js 只能作为独立 Adapter PoC 进入后续波次，不因本计划自动获准。
- 屏幕阅读器、真实物理键鼠/触控、广谱 EPUB/CBZ 坏书、大规模真实藏书迁移与多机性能 soak。
- 10k 书真实 Electron 运行矩阵；当前只完成 10k model/contract 与 1k Electron 双态门。
- 大于 `128 MiB` 的 EPUB/CBZ/ZIP 与真正按需 range/random-access 解包；当前 decoded/materialized viewport 有界不能外推成压缩源字节也有界驻留。

这些项目不阻止 W88 已执行范围收敛，但不得在最终检查点中冒充已落地。W88 的封板结论也不等于完整 Neat Reader / NeeView 功能、格式兼容或交互等价。
