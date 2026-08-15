# Mazz W71 Final Convergence / 封板式收敛评估

> 评估日期：2026-08-14
> 审计坐标：`main@7eb33387a976863bd2e0c434d19b1dfc0c760916`
> 阶段：第一阶段，只读评估
> 结论：**GO WITH SCOPE REDUCTION**
> 本文中的百分制是“当前发布就绪度”，不是功能数量、代码量或历史波次完成度。

> [!IMPORTANT]
> 本文保留为第一阶段审计证据。维护者二次审阅已经修订 SurfaceManager、DoD、发布体积与 UI Integrity 口径；W71 的唯一施工真源现为 [`W71_FINAL_CONVERGENCE_EXECUTION_SPEC.md`](./W71_FINAL_CONVERGENCE_EXECUTION_SPEC.md)。两者冲突时以施工规格为准。施工规格当前仍处于“等待维护者最终批准”状态，不构成产品代码开工许可。

> [!NOTE]
> W66 的原始 `45 / PREVIEW` 只评价当时可见的“Kimi Provider + Terminal/Toolchain 前件”，不能代表长期架构。维护者已经将其正式修正为 `W66 Agent Harness Integration`：Provider、Harness、Seat、Gate 四层分离，Harness Foundation 与各 Vendor Adapter 分层验收。具体范围和 Final Gate 以施工规格 4.4、Wave 4 与 8.8 为准。

> [!NOTE]
> 跨波次未尽项、Factory 后半场、W64/W69/W70/W82 Design Capsule 与 W72–W82 Post-W71 分组统一维护在 [`Mazz 当前未落地全景-W71归并版.md`](<C:/Users/Administrator/Downloads/交付区/Mazz 当前未落地全景-W71归并版.md>)。本评估仍只作为 W71 第一阶段审计证据，不承担未来路线真源。

## 0. 评估边界、证据与限制

本轮没有修改产品代码、依赖、发布配置、Surface 生命周期或既有 workaround，也没有实施 W63、W67、W70 或任何新功能。唯一计划内产物是本评估文档。

### 0.1 已核实证据

- 仓库坐标为 `main@7eb3338`；评估开始时，工作树只有既有的 `.codex-remote-attachments/` 未跟踪目录。
- 资产审计确认仓库逻辑体积 1.159 GiB，其中 `node_modules` 1022.23 MiB、`renderer/dist` 93.37 MiB；源码/工程文件仅 3.21 MiB。
- 现有能力地图共 47 项：LANDED 34、PARTIAL 5、PLANNED 7、LEGACY 1。该地图只作为功能存在性证据，不直接作为本报告的产品成熟度分数。
- 同一提交坐标的 `node tests/run.js` 已通过 **125/125 个测试文件**；其中包含 contract、unit 以及 DOCX/XLSX/PPTX 测试，但三类 Office 测试的语义并不相同：DOCX 主要验证生成样本的导入保留，XLSX 验证导入—模型—导出—重读，PPTX 主要验证大纲导出结构。
- 本轮在当前 Windows 主机补跑最小真 Electron 冒烟：14 个模块、357 条命令、Markdown 往返、IPC 白名单、safeStorage 密码写入/读取/删除全部通过，渲染异常为 0。
- 本轮补跑真实主进程 `tests/e2e/run87.mjs`：**5/5 通过**，覆盖 WebContentsView 对话采集、虚拟滚动、Markdown 落盘、文风素材回喂、导图生成、Factory 正式术语以及主/渲染进程异常警察。仅出现 Node `DEP0190` 警告，不是产品断言失败。
- `tests/e2e` 内约有 525 个 `scenario(...)` 调用点，但分散在大量历史 runner 中；`npm run test:e2e` 只指向 `run.mjs`，并不存在一份“所有历史场景在当前 HEAD 全部通过”的统一、可复现清单。因此这些脚本是高价值测试资产，不是当前全绿证明。
- 静态核查确认 BrowserViews 已有 host-aware ownership、销毁、崩溃恢复、原生右键菜单、per-session partition 与 Windows 合成恢复；同时确认统一 `SurfaceManager` 尚不存在。
- 静态核查确认 37 个原生 `.node` 文件，其中 `node-pty` 11 个、`fs-native-extensions` 10 个、`utp-native` 5 个，且 `electron-builder` 配置为 `npmRebuild:false`。
- `npm ls --omit=dev --parseable --all` 对应的生产依赖闭包在当前安装树中约 **443.85 MiB（逻辑体积）**；其中包含大量已经被前端 bundle 吸收、但仍可能作为生产依赖再次进入发布物的包，以及多平台预编译资产。
- `renderer/dist` 中 sourcemap 约 55.31 MiB；移除发布物中的 map 后，当前 dist 主体约 38.06 MiB。
- 当前没有根级 `LICENSE` 或 `NOTICE`；被 Git 跟踪的 `renderer/vendor/ffmpeg/` 约 30.74 MiB，仓库内未找到完整来源、固定版本、构建参数、hash、license/notice 闭环。
- 一次不改配置、输出到临时目录的 `electron-builder --win --x64 --dir` 有界诊断在 60 秒内未完成；该结果只能记为 **PACKAGE SPECIMEN UNKNOWN**，不能记为构建失败，更不能替代正式 NSIS 安装、升级与卸载验收。

### 0.2 尚未获得的证据

- 没有当前 HEAD 的完整 Windows 安装包、asar/unpacked 清单和安装后体积。
- 没有代码签名、升级、降级、回滚、卸载残留与文件关联实证。
- 没有 20 次 Browser/Panel/PTY/P2P 打开关闭的资源计数和内存曲线。
- 没有睡眠/恢复、多显示器、多 DPI、摄像头/麦克风/系统音、剪贴板、拖拽、全屏的系统化矩阵。
- 没有 1k/10k 工作区、大 XLSX、大 PDF、高清视频、ffmpeg、OCR 并发的基准记录。
- 没有统一的真实用户文件语料库与“支持字段/不支持字段”声明。
- 没有覆盖所有正式入口、全部状态和 Dark/Light 的现行视觉基线。故 Product Polish 分数的置信度低于工程完整度分数。

---

## A. Executive Decision

### A.1 决策

**GO WITH SCOPE REDUCTION**。

Mazz 已经具备进入一次封板式收敛的现实基础：核心功能不是概念稿，主链能在真 Electron 中运行，测试资产广，main/preload/renderer 边界已经形成，Browser、Factory、编辑器和媒体模块都有真实实现。此时继续把主要资源投向新功能，边际收益低于消化生命周期、数据、Windows、发布、安全、许可与交互一致性债务。

但不能把 W71 定义成“把所有已知规划一次做完”或“借统一 Surface 顺手重写平台层”。当前证据不支持这种范围。W71 应只承诺：

1. 把核心路径推到可发布、可回归、可长期低强度维护的 90+ 水位；
2. 把外围正式能力推过清晰、稳定的 80 分门槛；
3. 将不满足条件的入口明确降为 Preview 或隐藏；
4. 建立可重复的 Windows 安装包、数据往返、生命周期和 soak 证据；
5. 不扩张 Graph、Cognition、AI 陪看、市场和完整 W67。

### A.2 为什么不是 GO

当前至少存在五个发布前硬缺口：

- 没有可审计的当前 Windows 安装包，原生 ABI 仍是未知量；
- 没有生命周期/内存 soak，静态代码中已经出现可疑的实例级监听与退出清理缺口；
- 没有真实文件语料级 roundtrip 和统一外部修改冲突协议；
- 插件信任边界、Updater TLS、SearXNG 默认凭据/TLS 策略没有达到正式产品发布水位；
- LICENSE/NOTICE 与 ffmpeg WASM 来源/许可没有闭环。

### A.3 为什么不是 NO-GO

- 125/125 测试文件、当前 Windows 真 Electron 冒烟与 W62f 5/5 都证明主链不是不可控原型。
- Browser 的问题不是“完全没有生命周期”，而是局部实现已经成熟、缺少统一协议与长期探针；这适合增量收敛。
- 数据、UI、发布与性能债务大多可以通过明确 Gate 和有限范围完成，不要求先做 W63/W67/W70。
- 仓库体积主要是开发依赖和构建产物，不是 1.2 GiB 难以理解的产品代码。

### A.4 批准施工前置条件

维护者若批准 W71，应同时批准以下范围纪律：

- 第一目标是一个 Windows release candidate，不是架构作品展；
- PARTIAL 必须按本文 A/B/C 处置，不允许全部扶正；
- SurfaceManager 只批准接口冻结、观测和单 Surface 双轨 PoC；全量迁移另行立项；
- 任何 workaround 的删除必须由同场景 A/B 证据驱动；
- 许可、安全、安装包和数据可靠性是 release blocker，不得排在纯视觉抛光之后；
- W71 结束时允许保留已登记的 Preview，但不允许保留伪装成正式能力的半成品入口。

---

## B. 当前产品成熟度重新评估

| 维度 | 当前分 | 置信度 | 判断 |
|---|---:|---|---|
| Engineering Completeness | 82 | 高 | 核心模块和跨层主链真实存在；测试面广。扣分主要来自 PARTIAL、局部重复协议和发布链未闭环。 |
| Product Polish | 68 | 中低 | 主题变量、统一滚动条、原生面板和术语治理已有基础；但 216 个 UI 文件、596 处硬编码色值命中以及大量独立面板意味着一致性仍需真机逐态审计。 |
| Runtime Stability | 70 | 中 | 当前真 Electron 冒烟和 W62f E2E 通过；没有长时间 soak，且存在监听、Timer、P2P 退出清理候选。 |
| Data Reliability | 72 | 中 | 原子快照、崩溃恢复、保存/另存、外部变更保护和部分 roundtrip 已有；真实文件、损坏文件、冲突策略和 Office 支持边界仍不足。 |
| Windows / Electron Integration | 67 | 中 | 已有 WebContentsView、BrowserWindow、node-pty、desktopCapturer、safeStorage 等真集成；多 DPI、休眠、设备权限、ABI 和安装包未形成矩阵。 |
| Performance | 45 | 低 | 有虚拟滚动和局部降级机制，但没有统一基准、资源计数、内存坡度或 10k 文件证据。 |
| Packaging | 30 | 高 | 构建配置存在，实际 release specimen 未获得；sourcemap、生产依赖闭包、多平台 native binary 与过宽 renderer 包含规则风险明确。 |
| Security | 48 | 高 | contextIsolation、IPC 白名单、safeStorage、抓取 SSRF 防线是优点；插件任意代码信任、Updater/SearXNG TLS、硬编码默认凭据是发布阻塞。 |
| Licensing | 25 | 高 | `package.json` 声明 MIT，但根 LICENSE/NOTICE 缺失；vendored ffmpeg WASM 无完整来源与许可闭环。 |
| Maintainability | 64 | 中高 | 模块契约和测试资产强；历史 runner 碎片化、核心大文件、注释承载架构知识、局部监听未显式回收、双路径逻辑降低可维护性。 |

### B.1 综合解释

Mazz 不是“功能只有 68 分”的产品。它更准确的状态是：**功能存在性和局部工程完成度已经进入 80 分以上，但发布证据、跨生命周期一致性、真实数据可信度和全局产品质感拉低了整体封板就绪度。**

因此 W71 的收益主要来自减少未知量和状态分叉，而不是增加功能数量。

---

## C. 模块矩阵

“SEAL”表示没有发现必须进行模块级重构的证据，仍需通过全局 DoD；“FIX BEFORE SEAL”表示存在明确的模块级 Gate；“PREVIEW”表示保留能力但降低产品承诺；“DEFER”表示本轮不扶正。

| 模块 | 当前工程成熟度 | 产品质感 | 风险 | 本轮建议 | Final Gate |
|---|---:|---:|---|---|---|
| Shell / 多窗格 / 页签 / 文件树 | 86 | 74 | 高：跨窗、移签、外部变更、监听生命周期 | 统一外部变更决策；补 20 次移签/关签/子窗循环 | FIX BEFORE SEAL |
| Markdown / 富文本 / DOCX | 88 | 78 | 高：真实 DOCX 支持边界与往返损失未声明 | 用真实语料定义支持矩阵；不支持内容必须预警 | FIX BEFORE SEAL |
| Text | 90 | 77 | 低：编码、大文件和外部冲突 | 补编码/大文件/外部修改验收即可 | SEAL |
| Code / Terminal / DAP | 82 | 72 | 高：PTY ABI、实例监听与退出回收 | 补 TerminalPanel dispose、PTY 计数、打包 ABI | FIX BEFORE SEAL |
| Sheet / XLSX | 84 | 70 | 高：大表、样式、公式和真实文件边界 | 扩充真实 XLSX 语料与大表性能基线 | FIX BEFORE SEAL |
| Slide / PPTX | 82 | 70 | 中高：当前强项偏导出，导入/往返边界不足 | 明确大纲模型能力，验证真实 PPTX 与备注/布局 | FIX BEFORE SEAL |
| Math | 84 | 72 | 中低：外部工具链和失败态 | 冻结能力，不扩展；补依赖缺失提示 | SEAL |
| Notes / Search / 当前笔记图谱 | 83 | 69 | 中：轮询式 autosave、索引/图谱生命周期 | 显式 dispose；验证 10k 文件索引和恢复 | FIX BEFORE SEAL |
| Mindmap | 88 | 75 | 中：复杂交互和大图性能 | 冻结数据模型；做真实文件重开和大图 Gate | SEAL |
| Draw | 82 | 69 | 中：大画布、对象 URL、保存恢复 | 补大图、损坏文件、另存与资源释放 | FIX BEFORE SEAL |
| Library / Reader | 84 | 73 | 中：格式多、进度恢复和大书 | 真实 EPUB/MOBI/PDF 语料与进度恢复矩阵 | FIX BEFORE SEAL |
| Viewer / PDF / 音视频 / 字幕 / P2P | 80 | 70 | 高：设备、编解码、WebTorrent 生命周期、ffmpeg | 补退出 destroy、设备/格式/长播 soak；许可闭环 | FIX BEFORE SEAL |
| Browser / Native Surface | 84 | 72 | 极高：Windows compositor、迁移、workaround | 保持当前机制；做单 Surface 双轨 PoC 和资源探针 | FIX BEFORE SEAL |
| Factory / W68 主链 | 86 | 70 | 高：系统复杂、外部模型、任务恢复 | 冻结功能面；补失败注入、预算、恢复和真实长任务 | FIX BEFORE SEAL |
| AI Provider / 密钥仓 / 角色路由 | 82 | 68 | 高：外部服务漂移、模型兼容和凭据治理 | 明确 Provider 契约、超时/取消/脱敏与降级 | FIX BEFORE SEAL |
| OCR / Vision | 74 | 64 | 中高：首次模型下载、取消、离线、真实准确率 | 有限成本补齐到正式能力；失败可回退本地/AI | FIX BEFORE SEAL |
| Recorder / Voice | 72 | 62 | 高：权限、系统音、声卡、最小化、ffmpeg | 本轮维持 Preview，除非设备矩阵全部通过 | PREVIEW |
| Plugins | 70 | 60 | 极高：工作区插件可在渲染层执行并访问完整 IPC 白名单 | 先建立显式信任/哈希/权限边界；本轮标 Preview | PREVIEW |
| Archive | 76 | 64 | 高：损坏包、路径穿越、压缩炸弹、长路径、7za | 补安全语料、取消/清理和大包进度 | FIX BEFORE SEAL |
| LAN Sync / Share / Progress Relay | 80 | 66 | 高：冲突、断网、跨设备和文档宣称漂移 | 做双机/中断/重连/冲突副本验收；统一帮助文本 | FIX BEFORE SEAL |
| Themes / i18n / Activity / Panels | 84 | 72 | 中：独立面板样式分叉、RTL 和 DPI | 建状态矩阵与截图基线，逐项收口 | FIX BEFORE SEAL |
| Mobile 壳 | 45 | 55 | 高：没有可发布 Android/iOS 工程，文档宣称互相矛盾 | 隐藏正式入口，保留代码和开发文档 | DEFER |
| Updater | 35 | 58 | 极高：只有 manifest check，TLS 校验关闭，无下载/安装/回滚 | 隐藏正式入口；若另行完成全链再升级 | DEFER |
| W65 四站爬取 | 30 | 55 | 高：仅 DMHY/同步站，外站结构持续漂移 | 改名为“DMHY 网络源（预览）”，不得称四站完成 | PREVIEW |
| W66 Kimi Code 整合 | 45 | 58 | 中高：现有是 Kimi Provider + 通用终端/工具链前件 | 仅以实验兼容层呈现，不承诺专用整合 | PREVIEW |
| W62e 投喂管线 | 20 | — | 高：只有搜索/插件/采集前件，没有统一正式主链 | 隐藏正式入口，代码作为前件保留 | DEFER |
| W63/W64/W69/W70/完整 W67 等规划 | 0–15 | — | 极高：会改变本轮性质 | 全部冻结 | DEFER |

### C.1 五个 PARTIAL 的强制归类

| PARTIAL | 结论 | 产品动作 |
|---|---|---|
| 移动壳 | **C. 暂时隐藏正式入口，保留代码** | 当前没有可交付 native 工程；帮助文档还存在“手机可当主机”与 mobile README“手机不能当主机”的矛盾。 |
| Updater | **C. 暂时隐藏正式入口，保留代码** | 当前只检查清单，不能安全下载/安装/回滚，且 `rejectUnauthorized:false`。 |
| W65 四站爬取 | **B. 明确降级为 Preview / Experimental** | 只展示已经实现的 DMHY 族适配器，名称中不再使用“四站”。 |
| W66 Kimi Code 整合 | **B. 明确降级为 Preview / Experimental** | 保留 Provider 与通用终端协同，禁止宣称已形成 Kimi Code 专用工作流。 |
| W62e 投喂 | **C. 暂时隐藏正式入口，保留代码** | 可复用前件继续存在，但没有完整 Task/Feed 管线前不设正式入口。 |

### C.2 四个低于 80 的 LANDED 模块

- **OCR：值得补齐。** 已有 AI Vision 与 Tesseract 双路、进度和失败信息；剩余工作主要是首次下载、取消、离线、超时、真实语料、模型缓存和权限体验，成本可控。
- **Recorder：暂列 Preview。** 代码已有三级采集回退、零字节看门狗、轨道清理、字幕和 ffmpeg 转码，但它高度依赖 Windows 版本、GPU、声卡、权限和目标窗口。没有设备矩阵前不应以正式能力封板。
- **Plugins：必须 Preview。** 契约校验能阻止接口错误，不能阻止恶意代码；插件通过 blob import 在渲染层执行，可使用 `window.mazz` 的广泛 IPC 能力。先做显式信任与权限边界，再谈正式生态。
- **Archive：值得补齐。** 魔数、GBK、进度、取消、并发和 zip-slip 初步防线已在，主要缺损坏包、绝对路径/长路径、symlink、压缩炸弹、磁盘耗尽和 7za 失败后的原子清理。

---

## D. Root-Cause Debt Map

| 债务类别 | 证据 | 根因判断 | W71 处理原则 |
|---|---|---|---|
| UI 抛光债 | 独立面板多、硬编码色值命中多、不同模块字号/密度不同 | 局部功能按波次成熟，缺统一状态验收 | 建组件/状态矩阵后批量收口；不改业务协议 |
| 生命周期债 | Browser/Terminal 实例注册可退订事件但未保存退订；Notes 依赖 DOM 消失后自停；Torrent 无应用退出 destroy | 生命周期契约只覆盖模块主体，未覆盖所有异步资源 | 先加资源计数与 dispose contract，再修具体项 |
| 数据策略债 | 外部 `file:changed` 有自动重载与弹窗重载两条路径 | 历史补丁各自解决事故，缺统一冲突状态机 | 统一为单一决策协议，禁止双重提示/双重读盘 |
| 平台架构债 | BrowserViews、PanelWindows、Shell 各自处理 ownership/host/move | 局部实现成熟，但没有最小 Surface 协议 | 冻结协议 + 单 Surface adapter PoC，不全量迁移 |
| Windows/Electron 债 | WebContentsView 丢 surface、±1px 振荡、drag cloak、pane reload | 一部分是 Chromium/D3D 行为，一部分是应用重排竞态 | 保留 workaround；逐项 A/B 证明后才删除 |
| 原生 ABI 债 | 37 个 `.node`、`npmRebuild:false`、无安装包实证 | 开发树可运行不代表 packaged Electron ABI 可运行 | 早期建立 clean-machine package Gate |
| 发布边界债 | dist sourcemap 55.31 MiB、生产依赖闭包 443.85 MiB、renderer 包含过宽 | 构建产物和运行依赖没有白名单化 | 优先优化发布物，不清理几十 KiB 历史文件 |
| 安全债 | Updater/SearXNG TLS 放宽、SearX 默认凭据、插件任意代码 | 便捷配置和早期生态能力先于发布威胁模型 | 发布前消灭自动信任；不把 Preview 当安全豁免 |
| 许可债 | 无 LICENSE/NOTICE，ffmpeg WASM 无来源账 | vendored runtime 未建立供应链记录 | Wave 0 闭环；未闭环不得出 RC |
| 测试不确定性 | 525 个历史 E2E 场景分散、无统一当前清单、无 soak | 测试数量增长快于测试编排与基线治理 | 形成 release manifest，区分历史、必跑和诊断探针 |

### D.1 Browser / Native Surface 结论

#### 哪些机制当前应视为必要保护

- `reloadTab` convergence：主页的 `about:blank + document.write` 与普通 URL 语义不同，这是当前数据模型的真实分支。
- per-session protocol registration：隔离 partition 使用 `mazz-res` 的必要条件。
- `backgroundThrottling:false`：录制、媒体和被遮挡页面仍需工作，不能以省内存为由直接删除。
- native context menu：避免 DOM overlay 与原生 WebContentsView 合成层冲突，属于已经找到根因后的架构修正。
- host-aware destroy：宿主窗死亡必须级联销毁 Surface，属于生命周期正确性。
- `pane:tabMoved` resync、drag cloak、`invalidate` 与 ±1px 双帧振荡：当前属于有真实事故背景的 workaround，尚无删除证据。

#### 哪些可能真正根治

- 重复 ownership、宿主识别和销毁协议可以通过统一 Surface 最小协议根治。
- 事件监听、Timer、资源计数和 stale callback 可以通过 generation/epoch 与显式 dispose 根治。
- 外壳移签后刷新与边界同步的重复触发，可以在 ownership move 完成事件后收敛成单一事务。

#### 哪些不能承诺由 SurfaceManager 根治

- Windows D3D/Chromium 在 WebContentsView 隐显后的丢 surface；
- 不同 GPU、远程桌面、DPI 与多显示器组合下的 compositor 差异；
- 需要 `invalidate` 或轻微 bounds 变化才能重绘的 Electron 版本行为。

SurfaceManager 能减少应用自身的状态分叉，但不能把底层 compositor 缺陷“抽象掉”。

### D.2 SurfaceManager 是否值得现在落地

**值得做接口冻结、观测与单 Surface PoC；不值得做全量迁移。**

建议最小协议：

```text
create({ surfaceId, kind, ownerWindowId, partition, initialState })
attach(surfaceId, ownerWindowId, epoch)
setBounds(surfaceId, rect, visible, reason, epoch)
activate(surfaceId, epoch)
deactivate(surfaceId, epoch)
move(surfaceId, fromWindowId, toWindowId, epoch)
snapshot(surfaceId)
destroy(surfaceId, reason, epoch)
inspect(surfaceId) / list()

events:
ready / state / crashed / recovered / moved / destroyed
```

必须满足的协议不变量：

- 一个 Surface 同一时刻只有一个 owner；
- `create`、`attach`、`destroy` 幂等；
- stale epoch 的异步回调不得修改新状态；
- owner 销毁时 Surface 必须同步进入 destroyed；
- `destroyed` 后 listener、Timer、webContents、host 引用全部为 0；
- 现有 compositor workaround 位于 backend adapter 内，不散到通用协议。

第一批 PoC 不应迁所有 Browser，也不应选一个过于简单、无法暴露问题的普通面板。建议：

1. 保留 `BrowserViews` 为稳定 backend；
2. 只让一个测试标记的 Browser WebContentsView 通过 `SurfaceManager -> BrowserViewsAdapter` 创建；
3. 其余 Browser 继续走旧路径；
4. 双路同时输出 owner、bounds、visible、webContents PID、listener、reviveGen、destroy reason；
5. 通过 20 次开关、跨窗迁移、宿主销毁、崩溃恢复和非白屏抓帧后，再决定是否扩到第二个 Surface。

回滚方式必须只是关闭 feature flag、回到原 `BrowserViews` 入口；不得要求回滚一批已经删除的 workaround。

---

## E. W71 推荐施工顺序

### Wave 0 — 范围冻结、发布基线、安全与许可

依赖：无。后续所有 Wave 均依赖本波。

- 固化 HEAD、Node/ Electron/Windows 版本、测试清单和缺陷等级定义。
- 建立一份 release E2E manifest：必跑场景、历史探针、设备场景分开管理。
- 首先打出可重复的 `app-unpacked` 与 NSIS specimen，记录 installer/installed/asar/unpacked 清单。
- 建立进程、webContents、Surface、PTY、watcher、torrent、Timer/listener 观测口。
- 增加根 LICENSE、NOTICE、第三方归属清单；补 ffmpeg 来源/版本/build/hash/license。
- Updater 正式入口先隐藏；SearXNG 默认凭据和 TLS 策略进入 release blocker。
- 冻结 PARTIAL 的 A/B/C 结论和正式/Preview 视觉标识。

退出 Gate：能在干净 Windows 环境重复构建并启动；许可清单有 owner；安全阻塞项都有明确处理路径。

### Wave 1 — 数据正确性与通用生命周期

依赖：Wave 0 的观测口与 release manifest。

- 统一打开/保存/另存/外部修改/冲突/快照/恢复状态机。
- 消除重复 `file:changed` 决策路径。
- 给 Module contract 增加可选但可审计的 `dispose` / resource ledger。
- 收口 Browser、Terminal、Notes、Viewer、Factory、Archive 的 listener/Timer/process 清理。
- 给 TorrentDaemon 增加应用退出与失败中止的确定性 destroy。
- 建立真实文件 roundtrip 语料和支持边界声明。

退出 Gate：核心格式无静默覆盖/静默丢失；20 次资源循环无对象数量累积。

### Wave 2 — Windows 安装包、ABI 与系统集成

依赖：Wave 0 可构建 specimen，Wave 1 无已知数据损坏。

- 在 packaged app 中验证 node-pty、WebTorrent native dependency、safeStorage、ffmpeg、libass、Monaco。
- 做 clean install、覆盖升级、卸载、文件关联、协议、快捷方式和用户数据保留。
- 验证 DPI、多显示器、拖拽、剪贴板、全屏、休眠/恢复与设备权限。
- 建立 asar/unpacked allowlist，排除 sourcemap、PDB、测试、无关源码、非 Windows binary 和可重复 bundle。

退出 Gate：声明的 Windows 支持矩阵全部通过，packaged app 与开发模式行为一致。

### Wave 3 — Browser / Native Surface 收敛

依赖：Wave 1 资源观测，Wave 2 packaged Windows 基线。

- 冻结 Surface v1 最小协议。
- 给现有 BrowserViews 加 adapter，不改 backend 行为。
- 单测试 Surface 双轨 PoC；跑隐显、拖拽、移签、子窗、崩溃、睡眠和 20 次循环。
- 每次只撤一项 workaround，A/B 比对；失败立即恢复。
- PoC 未达标则保留现架构，W71 不再扩大迁移。

退出 Gate：PoC 有量化收益且无行为回归；否则以“协议冻结、未迁移”正常结束本波。

### Wave 4 — 60–80 分模块与 PARTIAL 归类落地

依赖：Wave 1/2 的通用错误、权限、安装包与资源框架。

- OCR、Archive 补齐到正式 80+。
- Recorder、Plugins 以 Preview 收口，除非各自硬 Gate 全过。
- Mobile、Updater、W62e 隐藏正式入口。
- W65 改为 DMHY Preview；W66 改为实验兼容层。
- 清理帮助、README、入口文案中的过度承诺和相互矛盾。

退出 Gate：每个入口的正式/Preview/隐藏状态与能力事实一致。

### Wave 5 — UI / UX 全局收敛

依赖：功能入口与状态不再大幅变化。

- 建立 spacing、type scale、图标、控件高度、焦点环、禁用、loading、empty、error、success、tooltip、拖拽、滚动条的设计 token 和验收表。
- 先 Shell、Browser、Factory、Viewer、Sheet，再外围面板。
- Dark/Light、100/150/200% DPI、键盘导航和 RTL 分别截图验收。
- 原生 BrowserWindow、DOM modal、WebContentsView 与系统对话框允许不同实现，但视觉层级和反馈语义必须一致。

退出 Gate：所有正式入口状态矩阵完成，视觉差异有基线、有批准，不再凭主观“看起来差不多”。

### Wave 6 — Performance / Memory / Soak

依赖：功能和视觉结构冻结。

- 记录冷/热启动、1k/10k 文件、大 Markdown/XLSX/PDF/视频、20 Browser tabs、20 native panels、PTY/P2P/ffmpeg/OCR。
- 分别记录 idle、active、close-after 的 RSS、heap、进程数、webContents、句柄和业务资源数。
- 只修真实线性增长、卡顿和峰值；不做无用户收益的 micro optimization。

退出 Gate：满足 H 节量化阈值；无未解释的线性累积器。

### Wave 7 — Release Candidate

依赖：前六波 Gate 全部通过。

- 从干净克隆构建、签名、安装、升级、卸载。
- 重跑 release manifest、真实文件语料、设备矩阵和 4–8 小时 soak。
- 审计 installer/asar/unpacked/SBOM/NOTICE/secret。
- 冻结已知问题表和 Preview 清单。

退出 Gate：满足 Final Definition of Done，生成 RC；W63/W64/W69/W70 不随 RC 进入。

---

## F. 风险最高的十项改造

### F1. 统一模块与异步资源生命周期

- **问题：** listener、Timer、worker、PTY、watcher、torrent 与 webContents 的生命周期不完全受同一 contract 管理。
- **当前机制：** `module-registry` 调用模块 `dispose`；Browser/Viewer 有局部销毁；Terminal/Notes 等存在没有显式退订或只靠 DOM 消失自停的路径。
- **为什么危险：** 这类问题单次使用不可见，20 次循环后才表现为重复事件、幽灵 UI、内存增长或退出卡住。
- **如果不改：** 产品可在短测中全绿，但无法支持长期低强度维护目标。
- **修改可能破坏：** 过早 dispose 会中断后台保存、播放、任务或跨窗迁移。
- **需要测试：** 资源 ledger、20 次开关、切换/移签、退出、崩溃、stale callback 注入。
- **是否值得在 W71 做：** **是，P0 基础项。**

### F2. 外部文件修改与冲突协议收敛

- **问题：** 当前存在自动重载和提示重载两条 `file:changed` 路径。
- **当前机制：** 干净标签可能被自动重载，同时收到“重新载入/忽略”；脏标签只提示不覆盖。
- **为什么危险：** 两条路径会发生重复读盘、重复提示和时序竞态，用户无法确定当前内容来源。
- **如果不改：** 用户不敢把真实文件交给 Mazz，尤其是和 Office/外部编辑器协作时。
- **修改可能破坏：** 外部编辑即时回传、自己保存引发的 watcher 回声、二进制转换回传。
- **需要测试：** 自己保存、外部保存、双方同时修改、删除/改名、二进制格式、连续保存、网络盘延迟。
- **是否值得在 W71 做：** **是，数据封板核心。**

### F3. SurfaceManager 单 Surface PoC

- **问题：** native Surface ownership 分散在 BrowserViews、PanelWindows、WindowManager 与 Shell。
- **当前机制：** 多个局部成熟实现通过 IPC 和事件协同。
- **为什么危险：** 全量重构会同时触碰 ownership、compositor、迁移、上下文菜单和崩溃恢复。
- **如果不改：** 可以封板，但维护成本和新增 Surface 风险继续偏高。
- **修改可能破坏：** 白屏恢复、跨窗迁移、宿主销毁、partition、安全钩子、焦点。
- **需要测试：** 双轨状态比对、20 次循环、移签、宿主死亡、crash/revive、非白屏截图、资源归零。
- **是否值得在 W71 做：** **仅值得协议冻结与单 Surface PoC；不值得全量迁移。**

### F4. 删除或替换 Browser compositor workaround

- **问题：** drag cloak、pane reload、invalidate、±1px 振荡看起来不够优雅。
- **当前机制：** 它们分别规避 DOM/native 叠层、移签后 GPU 表面不重绘、隐显丢 surface。
- **为什么危险：** 底层问题与 Electron/Chromium/D3D、GPU、远程桌面有关，静态审美不能证明 workaround 多余。
- **如果不改：** 有少量复杂度和重绘成本，但用户主路径可工作。
- **修改可能破坏：** 出现难复现白屏、穿帮、拖拽鬼影和远端无人值守崩溃。
- **需要测试：** 每项单独 A/B；GPU 开/关、RDP、本地、多 DPI、遮挡、弹层、拖拽、睡眠。
- **是否值得在 W71 做：** **只在有证据时逐项做；默认保留。**

### F5. node-pty / WebTorrent 原生 ABI 与 packaged runtime

- **问题：** 开发环境可用不代表 Electron packaged app ABI 正确。
- **当前机制：** 37 个 `.node` 文件，`npmRebuild:false`，多个包带多平台预编译物。
- **为什么危险：** 安装后才会出现 `MODULE_NOT_FOUND`、ABI mismatch、DLL 缺失或杀软拦截。
- **如果不改：** 终端/P2P 可能成为“开发版正常、用户版失效”的发布事故。
- **修改可能破坏：** 强制 rebuild 可能改变已验证预编译物；错误 prune 会删掉运行时 binary。
- **需要测试：** 干净机安装、node-pty 真建/写/杀、torrent add/remove、asar unpack 路径、x64/目标架构。
- **是否值得在 W71 做：** **是，release blocker。**

### F6. 发布物白名单化与体积收敛

- **问题：** `renderer/` 宽泛包含、55.31 MiB sourcemap、443.85 MiB 生产依赖闭包可能造成重复与无关资产入包。
- **当前机制：** electron-builder 自动收集生产依赖，renderer 源/产物一起纳入。
- **为什么危险：** 贸然改 files 规则会漏掉动态 HTML、worker、wasm、Monaco 字体或 native binary。
- **如果不改：** 安装包和安装体积过大，攻击面与更新成本增加。
- **修改可能破坏：** 面板 404、worker 加载失败、OCR/字幕/ffmpeg/终端失效。
- **需要测试：** asar manifest、运行时资源追踪、所有动态入口、offline launch、安装包 diff。
- **是否值得在 W71 做：** **是，但只改发布边界，不删开发资产。**

### F7. 真实文件 roundtrip 与支持边界

- **问题：** 现有 Office 测试对“roundtrip”的定义不一致，真实复杂文件不足。
- **当前机制：** DOCX 偏导入保留、XLSX 有完整重读、PPTX 偏导出结构；Mindmap/Draw 多为模型级序列化。
- **为什么危险：** 用户会把“能打开”理解为“可无损保存”，造成静默数据损失。
- **如果不改：** 核心编辑能力无法达到“敢交真实文件”的标准。
- **修改可能破坏：** 为追求伪无损而扩大 Office 模型，拖入无限格式兼容范围。
- **需要测试：** 真实匿名语料、支持字段清单、unsupported 预警、原文件不覆盖、失败原子性。
- **是否值得在 W71 做：** **是，但只保证声明的支持子集。**

### F8. 插件信任与权限边界

- **问题：** `.maz` 代码通过动态 import 执行，契约校验不等于安全沙箱。
- **当前机制：** 工作区 `plugins/` 中启用的插件可加载为正式模块，并可访问渲染层暴露的广泛 `window.mazz` IPC。
- **为什么危险：** 被同步、下载或替换的插件可读写文件、调用系统能力，形成供应链/RCE 风险。
- **如果不改：** 正式发布不能合理承诺“装坏插件拖不垮主程序”。
- **修改可能破坏：** 现有示例和第三方插件兼容性。
- **需要测试：** 首次信任、hash 变化再确认、权限拒绝、禁用/删除、恶意包、启动自动加载。
- **是否值得在 W71 做：** **是，至少完成安全降级；完整市场生态不做。**

### F9. Updater 与 SearXNG 发布安全

- **问题：** Updater 和 SearXNG 请求存在 `rejectUnauthorized:false`；SearXNG 默认 IP、用户名和密码硬编码。
- **当前机制：** Updater 只读 manifest；SearXNG 支持用户配置、自检和失败返回，但默认实例信任策略过宽。
- **为什么危险：** 更新清单与搜索流量可被中间人篡改；公开客户端会泄露共享实例凭据并形成服务依赖。
- **如果不改：** Updater 不能正式发布，默认搜索服务也不适合作为稳定产品承诺。
- **修改可能破坏：** 自签证书 VPS 的现有直连体验。
- **需要测试：** 正常证书、证书错误、pin/自签显式授权、endpoint 健康检查、超时、降级、无凭据首启。
- **是否值得在 W71 做：** **是；Updater 可通过隐藏入口完成，SearXNG 做配置化与健康降级。**

### F10. ffmpeg 与第三方许可/供应链闭环

- **问题：** 唯一大于 10 MiB 的 Git 跟踪运行资产缺少可复现来源账。
- **当前机制：** 本地 vendored ffmpeg JS/WASM 被转码链直接使用。
- **为什么危险：** 无法判断编译选项、GPL/LGPL 边界、安全版本和二进制完整性。
- **如果不改：** RC 无法完成许可审计，也无法可靠响应上游漏洞。
- **修改可能破坏：** 更换构建物会改变编解码支持、性能和 worker 路径。
- **需要测试：** hash、来源、构建脚本/参数、license/notice、支持 codec、录制转码回归。
- **是否值得在 W71 做：** **是，release blocker；不要求升级版本。**

---

## G. 建议“不做”的事情

1. 不实施 W63 完整块级活引用、W64 AI 陪看、W69 Hub/市场、W70 Cognition、Task Capsule、Harness Adapter、SeatPackage 或完整 W67。
2. 不把当前笔记图谱扩成 universal Graph database / Graph Bus。
3. 不把 pairwise bridge 改造成 universal data model。
4. 不一次性迁移所有 BrowserView、PanelWindow、overlay 到 SurfaceManager。
5. 不升级 Electron、npm 依赖或进行 `npm dedupe/prune`，除非某个 release blocker 有独立证据且维护者另行批准。
6. 不以“代码丑”删除 reload convergence、drag cloak、pane reload、per-session protocol、`backgroundThrottling:false`、native context menu、host-aware destroy、invalidate 或 ±1px 振荡。
7. 不为减小仓库目录删除 `node_modules`、`renderer/dist`、patch、历史报告、ffmpeg WASM 或根目录镜像；发布体积通过打包 allowlist 解决。
8. 不承诺 Office 全格式无损；只承诺经过语料验证的支持子集，并对不支持项预警。
9. 不把 Recorder、Plugins、Mobile、Updater、W65、W66、W62e 同时扶正。
10. 不把 SearXNG VPS 运维纳入 W71；客户端只负责 endpoint、凭据、健康检查、TLS 策略和失败降级。
11. 不为了跑分做无用户收益的 micro optimization；只处理真实卡顿、峰值和线性累积。
12. 不将历史 E2E 文件数量当作当前 release pass；必须以统一 manifest 的本次运行记录为准。

---

## H. Final Definition of Done

以下标准全部可验证；任一 release blocker 未满足，不得把 W71 标记为封板完成。

### H.1 缺陷与范围

- 已知 P0/P1 缺陷为 0。
- 所有已知数据损坏、任意代码执行、更新链 TLS、凭据泄露和许可阻塞项为 0。
- 每个正式入口都有 owner、状态、测试和文档；每个 PARTIAL 均按 C.1 的 A/B/C 归类完成。
- W63/W64/W69/W70/完整 W67 等冻结项没有新增正式入口。

### H.2 自动化与 Electron E2E

- 当前 125 个 Node 测试文件及 W71 新增测试在干净环境 100% 通过。
- release E2E manifest 中所有必跑场景在 packaged app 100% 通过；结果包含提交、OS、Electron、GPU、DPI 与耗时。
- 主进程 `uncaughtException`、渲染 `pageerror`、`render-process-gone` 和未批准 console error 均为 0。
- 历史 probe 不再由文件名隐式代表状态；每个被纳入 RC 的 probe 都有本次结果。

### H.3 生命周期与 Surface

- Browser tab、native panel、PTY、P2P、watcher、Viewer 各完成 20 次打开/关闭；最终业务对象数、webContents 数、PTY 数、torrent 数和 watcher 数回到基线。
- 以第 5 次循环后的稳定值为基线，第 6–20 次的 close-after RSS 线性斜率不超过 1 MiB/循环；最终静置 30 秒后的 RSS 不高于基线 15%。超阈值必须有可重复解释和维护者书面豁免。
- 20 Browser tabs、20 次跨窗格迁移、子窗宿主销毁、崩溃重建和应用退出均无幽灵 Surface、重复事件或白屏抓帧。
- SurfaceManager 若 PoC 未达到上述 Gate，必须关闭 flag 并保留旧 backend；“未全量迁移”不构成 W71 失败。

### H.4 数据可靠性

- Markdown/Text/Mazz/Mindmap/Draw 的声明为原生格式时，保存—重开后的语义模型 100% 一致；任何预期元数据差异有规范化规则。
- DOCX/XLSX/PPTX 的支持字段清单有自动断言；语料中所有已声明支持字段 100% 保留，不支持字段在覆盖/导出前给出可见警告。
- 每类核心格式至少包含：10 个真实匿名文件、1 个大文件、1 个损坏文件、1 个 unsupported 变体。
- 打开、修改、保存、另存、外部修改、双方冲突、异常退出、快照恢复、转换失败全部通过；失败不得覆盖原文件，不得留下伪成功产物。
- 外部修改只有一个决策协议：干净自动重载或提示重载二选一；脏状态必须保留双方内容并给出明确选择。
- Library、Notes、媒体进度的重开与跨设备同步在声明范围内 100% 通过。

### H.5 Windows / 安装 / ABI

- 从干净克隆可重复生成 NSIS installer、app-unpacked、asar/unpacked 清单和 hash。
- 在声明支持的 Windows 版本上完成 clean install、首次启动、覆盖升级、回滚策略验证、卸载、用户数据保留/删除选择、文件关联和 `mazz://` 协议。
- packaged app 中 node-pty 真创建/输入/resize/kill，WebTorrent 真 add/list/remove，ffmpeg 真转码，libass 真渲染，safeStorage 真往返，Monaco worker 真加载。
- 100%、150%、200% DPI，单/双显示器，睡眠/恢复，远程桌面至少一轮，拖拽、剪贴板、全屏、系统对话框全部通过。
- 麦克风、系统音、屏幕录制若不满足设备矩阵，Recorder 保持 Preview，不阻塞核心 RC。

### H.6 发布物与体积

- asar/unpacked 采用 allowlist 审计；不得包含 sourcemap、PDB、测试目录、无关开发工具、非 Windows native binary 或可证明重复的前端依赖。
- 必需动态资源（panel HTML、worker、wasm、Monaco 字体、libass、ffmpeg、示例插件若保留）均有启动时或 E2E 加载断言。
- 建议硬预算：NSIS installer 不超过 250 MiB，安装后不超过 600 MiB。若首次可信 specimen 证明该预算不合理，必须按资产清单逐项解释并由维护者调整，不能静默放宽。
- 发布体积优化不得删除开发环境、历史 patch 或本地测试资产。

当前结构的保守上界近似为：Electron runtime 约 271 MiB + 生产依赖闭包约 444 MiB + renderer dist 93 MiB + ffmpeg/runtime 资产约 31 MiB，即安装前逻辑资产约 839 MiB；builder 排除与压缩会降低实际值。去除 55 MiB sourcemap、重复的前端生产依赖、非 Windows native binary 和无关包内容后，**合理但尚待 specimen 证明的目标区间**为：安装后约 430–600 MiB、installer 约 150–250 MiB。

建议发布结构：

```text
Mazz Editor.exe + Electron runtime
resources/
  app.asar
    main/ + preload/
    renderer 运行时白名单（index/panels/dist/static；无 .map）
    package.json
  app.asar.unpacked/
    仅运行必需的 win32-x64 .node / worker / wasm
  third-party/
    ffmpeg / libass 的来源、hash、license/notice
locales/（仅声明支持所需）
```

### H.7 安全、外部服务与许可

- 根目录存在 LICENSE、NOTICE、第三方归属/SBOM；ffmpeg 有来源、固定版本、构建方式、hash 和 license。
- Git 历史中的已吊销旧 key 进入历史卫生记录，不作为生产 CRITICAL；当前树、测试输出、日志和构建物中不得出现仍有效 secret。
- 测试 secret 全部经环境变量或 mock 注入。
- Updater 要么严格 TLS + 签名/hash + 下载/安装/回滚全链通过，要么保持隐藏；不得以当前 manifest checker 作为正式 Updater。
- SearXNG 不再硬编码共享凭据；提供默认 endpoint、用户配置、健康检查和失败降级。自签证书只能经用户显式信任或证书 pin，不得全局无条件放行。
- 未经信任的 `.maz` 不得启动时自动执行；插件 hash 变化后必须重新授权。做不到则插件入口保持 Preview 且默认关闭。

### H.8 产品质感

- Shell、Markdown、Sheet、Slide、Mindmap、Browser、Viewer、Factory 逐一完成 normal/hover/focus/active/disabled/loading/empty/error/success/context menu/tooltip/drag 状态表。
- Dark/Light 与 100/150/200% DPI 有批准的截图基线；正式入口无裁切、遮挡、不可达按钮或不可见焦点。
- 原生面板、主窗和系统对话框的术语、层级、关闭/取消语义一致。
- UI 中不再出现已废弃内部黑话；Preview/Experimental 有统一、不可误认的标识。

---

## I. 外部基础设施与 SearXNG

本轮不应变成服务器运维项目，但客户端必须解除对固定公网 IP 和共享凭据的产品级耦合。

建议客户端契约：

```text
defaultEndpoint（可为空或维护者提供的域名）
userConfiguredEndpoint
credentialRef（safeStorage）
tlsPolicy（strict / explicit pin）
healthCheck（连通 + JSON 能力 + 延迟 + 最后成功时间）
failureMode（明确错误 + 本地/无联网降级）
```

当前已有 `searx:setConfig`、masked config、selfcheck 和结构化失败返回，可复用；需要移除源码内用户名/密码，并把 `rejectUnauthorized:false` 改为严格校验或显式 pin。VPS 的部署、备份、监控和升级不进入 W71。

---

## J. 最重要问题的直接回答

> 以当前仓库状态来看，Codex 是否已经有现实能力突破过去施工方在 Electron / Windows / Native Surface 边界上的限制，把 Mazz 从“大量功能已经存在的 80 分工程”收敛成一个维护者可以较长时间不持续高强度管理的稳定产品？

**有条件地可以，但能力边界是“建立并执行可观测、可回滚的收敛循环”，不是一次性保证所有 Windows/Electron 边界被根治。**

本轮已经证明 Codex 能在当前主机直接完成以下工作：

- 读取并追踪 main/preload/renderer/native 边界；
- 识别 WebContentsView ownership、host destroy、partition、compositor workaround 的真实作用；
- 在 Windows 上运行真 Electron、Playwright E2E、safeStorage、WebContentsView 和 Factory 主链；
- 对发布依赖、原生 `.node`、asar 候选、sourcemap、许可与安全边界做仓库级审计；
- 把“静态可疑点”转换成 20 次循环、资源计数、抓帧和 packaged-app Gate，而不是直接凭代码观感重构。

这与 [OpenAI 官方 Codex 文档](https://developers.openai.com/codex/) 所描述的本地环境、终端、代码审查和计算机操作能力边界一致；但官方能力说明不是项目成功证明，本报告中的真实仓库运行证据才是判断基础。

要实现长期低强度维护，仍依赖以下前提：

1. 维护者批准范围缩减，并拒绝 W63/W64/W69/W70 等顺手扩张；
2. 能提供至少一套干净 Windows 安装/升级环境，以及必要的多 DPI、设备和远程桌面场景；
3. 维护者对“正式/Preview/隐藏”、Office 支持子集、插件安全策略和发行渠道做产品决策；
4. 允许先加观测和测试，再动生命周期与 workaround；
5. 发布签名、VPS 证书/域名、第三方许可来源等外部权限由维护者提供。

现实可达边界是：

- 核心主链达到有安装包、有真机矩阵、有数据语料、有 soak 证据的稳定 Windows RC；
- 外围能力达到稳定 80+，或诚实地降为 Preview/隐藏；
- Browser/Native Surface 的应用层 ownership 和生命周期显著收敛；
- 已知 compositor workaround 被验证、集中和记录，但不承诺消灭 Chromium/D3D 本身的缺陷；
- 维护者从“持续盯每个模块施工”转为“按 release checklist 和已知问题表做低频维护”。

不可现实承诺的边界是：所有硬件/驱动零缺陷、所有 Office 文件无损、所有外部站点和模型永久兼容、所有历史 workaround 全部删除、产品从此无需维护。

因此最终判断不是“Codex 比过去施工方更会写代码，所以一定能封板”，而是：**当前工具访问、仓库测试资产和代码成熟度已经足以执行一轮纪律化收敛；只要把成功定义为可验证的稳定 RC，而不是全功能 100% 和全架构重写，W71 值得做。**

---

## K. 本阶段停止条件

本评估提交后停止。未获得维护者对“批准全部 / 缩减范围 / 拆波次 / 继续原计划”的明确决定前，不开始 W71 施工，不修改产品代码，不删除 legacy/workaround，不升级 Electron 或依赖。
