# Mazz W71 Final Convergence / 封板式收敛施工规格

> 版本：v2.25
> 日期：2026-08-16
> 审计坐标：`main@7eb33387a976863bd2e0c434d19b1dfc0c760916`
> 决策：**GO WITH SCOPE REDUCTION**
> 状态：**IN PROGRESS / 当前 specimen 安装回归已通过，推荐封板 RC 收口账本已冻结**
> 权威级别：W71 唯一施工真源
> 依据：[`W71_FINAL_CONVERGENCE_ASSESSMENT.md`](./W71_FINAL_CONVERGENCE_ASSESSMENT.md)、维护者《评估修订与施工补充说明 v2》、《W66 Agent Harness 架构意图修正》、《0814接续用》与《MAZZ 新上下文技术梳理 v0.2》

## 0. 文档权威与当前停止线

本文件合并第一阶段评估和维护者二次修订，统一 W71 的范围、Wave、Gate、DoD、UI Contract 与执行纪律。

规则如下：

1. 原评估继续作为现状、证据、风险和根因判断的审计记录。
2. 原评估与本文件发生范围、优先级或 Gate 冲突时，以本文件为准。
3. 跨波次状态、Post-W71 归属与 Design Capsule 来源，以 [`Mazz 当前未落地全景-W71归并版.md`](<C:/Users/Administrator/Downloads/交付区/Mazz 当前未落地全景-W71归并版.md>) 为唯一总表；任何后续施工规格必须引用并回写该表。
4. 后续施工任务、缺陷卡、测试和验收必须引用本文件中的 Wave 与 Gate。
5. 2026-08-15 维护者已明确授权“按照合理的施工逻辑安排三小时任务”；按等价授权进入首轮 W71 检查点。
6. 本次授权不扩大 W71，不批准 W63–W86，不允许删除既有 workaround，也不代表任何完整 Wave 已通过退出 Gate。
7. 首轮提交后维护者指令“继续推进”，按同一范围继续完成 Wave 0 Census 与 Native Surface Ledger；仍不构成 SurfaceManager、UI 大改或 Post-W71 功能授权。
8. 后续“继续推进”已完成 Python/DAP、Viewer/Player、Factory request、Monaco/Code、插件安全、代表性 Overlay/Z-order、外部文件变化、多窗口文件/基础窗控所有权、代表性编辑标签事务性交接与 20 次往返、代表性 Markdown 分窗连续 5 次 renderer 崩溃恢复、单主窗整应用异常退出恢复、双窗口/双 renderer 同名 tabId 的事故数据保全与扁平恢复、Text/Code/Sheet/Slide/Mindmap/Draw 六类可序列化核心模块的 whole-app hard-kill 恢复，以及损坏/大文件/未知二进制/不支持编码/失败导入的 packaged 安全检查点；只关闭有测试和 packaged 证据的子 Gate，Notes/Library/Viewer 运行态、完整 Session 拓扑恢复、Agent、跨窗运行时 owner、真实媒体设备等未尽项保持 OPEN。
9. 维护者随后明确要求“按推荐封板先做，同时预留完整主义拓展可能”。从此首个 RC 的阻塞、条件门、入口启用门与 Post-W71 完整主义，以 [`W71_RC_CLOSURE_LEDGER_2026-08-16.md`](./W71_RC_CLOSURE_LEDGER_2026-08-16.md) 分账；历史欠账继续保留，但不得以需要证书、异机、真实硬件或尚未安装的两种外部 Agent 为由无限阻塞推荐封板。

---

## 1. W71 最终目标

W71 不是新功能波，也不是全仓架构重写。目标是得到：

> 一个可发布、可回归、具备真实 Windows、数据、生命周期和安装包证据，并可较长期低强度维护的 Mazz Windows RC。

成功形态允许是：

```text
20+ 个真正稳定的正式能力
+ 少量明确标记的 Preview / Experimental
+ 暂时隐藏但保留代码的未闭环能力
```

不允许是：

```text
大量看起来已经正式、实际只有 60–70 分的入口
```

W71 的工作域固定为：

```text
Correctness
Lifecycle
Data Reliability
Windows / Electron
Packaging
Security
Licensing
Layout Integrity
Icon Consistency
Theme Consistency
Product Polish
Performance / Soak
Release
```

---

## 2. 冻结范围

除非它们已经成为现有正式产品的 P0/P1 阻塞，否则 W71 不实施：

```text
W63 完整块级活引用
W64 AI / 人格陪看
W69 Hub / 市场
W70 Cognition
W82 Organizational Compiler / Production Organization Workflows
W83 Danmaku Runtime
W84 .maz Production Asset Standard
W85 Context Compiler / Coverage Accounting
W86 Capability Production Runtime / Physical Extension
完整 W67
Task Capsule
SeatPackage
完整 Harness policy system
一次接完所有 Agent 厂商
大型 Graph 重构
universal Graph database / Graph Bus
universal data model
下一代 Factory 架构
```

Bridge 继续保持 pairwise interoperability。当前笔记图谱继续作为笔记关系可视化，不借 W71 扩成通用图数据库。

`W66 Agent Harness Integration` 是本冻结表的明确例外：W71 可以建设最小 Harness Foundation，并以两种真实 Adapter 验证协议；Task Capsule、SeatPackage、完整权限策略和“全厂商覆盖”仍然冻结。具体边界见 4.4。

禁止把任何冻结项作为“顺手优化”夹带进入 W71。

---

## 3. 对第一阶段评估的正式修订

### 3.1 SurfaceManager：从默认 PoC 降为条件触发项

W71 必做：

```text
Surface inventory
owner / host / move / destroy 现实协议梳理
listener / timer / webContents / process resource ledger
现有 BrowserViews 生命周期收口
workaround 集中登记、作用域标注与可观测化
Surface v1 interface draft
```

W71 默认不做：

```text
全量 SurfaceManager
默认 adapter 实施
默认 Surface migration
```

只有满足以下全部条件，才允许维护者单独批准单 Surface 双轨 PoC：

1. 已出现现有架构无法关闭的 P0/P1；
2. 根因证据指向 ownership/lifecycle 协议，而不是 Chromium/D3D 本身；
3. 现有 BrowserViews backend 和 workaround 保持可回滚；
4. PoC 只覆盖一个测试标记 Surface；
5. 有同场景 A/B、资源 ledger、非白屏抓帧和回滚开关。

**SurfaceManager 不是 W71 成功条件。** Browser/Native Surface 可以在现架构下完成封板。

### 3.2 Final DoD：拆分 Hard Gate 与 Stretch Gate

Hard Gate 是 RC 必须满足的发布条件；Stretch Gate 是高质量覆盖目标，未完成时进入 Known Limitations / 后续维护表，不自动判定 W71 失败。

### 3.3 安装包体积：先取 specimen，再冻结预算

第一阶段没有获得可信 Windows release specimen，当前状态仍为：

```text
PACKAGE SPECIMEN UNKNOWN
```

原评估中的：

```text
NSIS <= 250 MiB
installed <= 600 MiB
```

降为探索目标，不是当前 Hard Gate。正确顺序是：

```text
可信 specimen
→ installer / app.asar / unpacked 清单
→ 冗余归因
→ 安全排除
→ packaged runtime 全链回归
→ 冻结正式体积预算
```

发布物白名单化仍是正式目标；不得通过删除开发环境、测试资产、历史 patch 或必要 wasm 来制造体积数字。

### 3.4 Product Polish：原 68 分作废

Product Polish 当前正式状态改为：

> **RED / UNASSESSED / 暂不评分**

完成以下普查并形成证据基线后才重新评分：

```text
Visual Census
Icon Census
Theme Census
Layout Debt Census
```

第一阶段的 `68` 只保留在历史评估中，不得用作排期、验收或对外表述。

### 3.5 “80 分战略”不是 Electron 平台验收上限

历史“80 分战略”只描述高速扩张期的资源配置：垂直专业软件的全部深度可以取舍，不代表 Mazz 主动放弃 Electron/Windows 平台本身可可靠实现的能力。

```text
Vertical feature depth        可以按产品价值取舍
Desktop platform correctness  不以“够用 80 分”为停止理由
```

W71 对 multi-surface、native integration、window/process lifecycle、filesystem、drag/drop、DPI、fullscreen、GPU、packaging、installation、upgrade、sleep/resume、process isolation 与 system shell integration 的目标是逼近当前平台和项目边界；不能用旧口号掩盖已知 P0/P1、生命周期错误或缺失证据。与此同时，这不授权全量 SurfaceManager、Electron 升级或无限兼容矩阵，具体 Hard/Stretch Gate 仍以本规格为准。

---

## 4. 功能入口的最终处置

### 4.1 PARTIAL 模块

| 模块 | 最终分类 | W71 产品动作 |
|---|---|---|
| 移动壳 | 隐藏 | 保留代码和开发文档；没有可交付 native 工程前不设正式入口。 |
| Updater | 隐藏 | 当前只有 manifest check 且 TLS 不合格；不以正式更新能力呈现。 |
| W65 四站爬取 | Preview | 只呈现已实现的 DMHY 族能力，名称不得继续声称“四站完成”。 |
| W66 Agent Harness Integration（原 Kimi Code 整合） | Foundation internal；Vendor Adapter/UI Hidden 或 Experimental | 通用 Harness v1 基础已经落地；当前真实 Adapter 为 0。双真实执行器仍是入口启用 Gate，不再因外部 CLI 不可用阻塞首个推荐 RC。 |
| W62e 投喂 | 隐藏 | 搜索、采集、插件等前件保留，没有完整管线前不设正式入口。 |

### 4.2 低于正式 80 水位的 LANDED 模块

| 模块 | W71 目标 |
|---|---|
| OCR / Vision | 补齐首次下载、取消、离线、超时、真实语料、缓存和失败降级，达到正式能力。 |
| Archive | 补齐损坏包、路径、symlink、压缩炸弹、磁盘耗尽、长路径、取消与失败清理，达到正式能力。 |
| Recorder | 默认 Preview；只有设备、权限、系统音、最小化、ffmpeg 全矩阵通过才可扶正。 |
| Plugins | Preview + 安全边界；显式信任、hash 变化再授权和默认不自动执行未完成前不得扶正。 |

### 4.3 入口不变量

每个用户可见入口必须且只能处于以下一种状态：

```text
Formal
Preview / Experimental
Hidden
```

代码存在、测试存在、帮助文档存在，都不能自动推导为 Formal。

---

### 4.4 W66 架构意图修正：Agent Harness，不是 Kimi 专项

`W66 Kimi Code 整合` 只描述了最早落点，不能继续充当产品边界。正式名称改为：

```text
W66 Agent Harness Integration
中文：W66 Agent 执行器整合层
原名：Kimi Code 整合
```

目标架构为：

```text
Mazz / Factory / 通用 Agent UI
              ↓
Agent Registry + HarnessAdapter v1
              ↓
Kimi Code | Codex | 后续 Vendor Adapter
```

Kimi Code 是第一种真实执行器验证对象，不是 Harness 系统本身；即使首轮只验收 Kimi Code 与 Codex，公共架构也必须表达 `N` 个 Adapter，不得实现成 `if kimi / else if codex`。

#### 4.4.1 四层不得混写

| 层 | 含义 | 当前事实 |
|---|---|---|
| Provider | 模型/API、端点、Key、模型名 | 已有正式实现 |
| Harness / Agent Adapter | 能读改文件、执行命令并持续运行任务的外部 Agent/CLI/Runtime | 正式抽象未落地 |
| Seat | Factory 中由谁承担某岗位及其角色政策 | 已有角色/席位概念；不等于模型或 CLI |
| Gate | 权限、审校、终审与指令边界 | W68 已有部分正式机制 |

公共 API 禁止出现 `Provider == Agent`、`Seat == Model`、`Terminal == Harness` 或 `Kimi == Harness system`。Terminal / PTY 只是 transport 与 process host。

#### 4.4.2 HarnessAdapter v1 最小契约

```text
HarnessAdapter
├─ id / displayName
├─ detect()
├─ probe()
├─ capabilities()
├─ createSession()
├─ send()
├─ interrupt()
├─ dispose()
└─ events
```

统一 Session 状态至少包括：

```text
idle → starting → running → waiting → completed / failed / cancelled → disposed
```

统一事件至少包括：

```text
started / stdout / stderr / message / progress / tool /
warning / error / completed
```

厂商特殊事件保留在 `raw` 或 vendor metadata；Factory 主链不得依赖某一家原始输出格式。

Capability 必须显式表达差异，候选域包括：

```text
workspace / fileEdit / terminal / toolUse / imageInput /
resume / checkpoint / approval / computerUse / structuredOutput
```

具体字段在 Wave 0 冻结。UI 与 Factory 按 capability 决定可用操作，不按厂商名硬编码。

#### 4.4.3 W71 范围与分层状态

| 分层 | 状态 | W71 动作 |
|---|---|---|
| Terminal / Toolchain / PTY | LANDED prerequisite | 复用并纳入资源账本，不冒充 Harness |
| Kimi Provider 与路由前件 | PARTIAL prerequisite | 保留；与 Agent 身份解耦 |
| Agent Harness Foundation | PARTIAL LANDED / internal | Registry、Session lifecycle、Capability、统一事件/错误/interrupt/dispose、资源账本与主进程 IPC 已落；首个 RC 不开放通用 Agent 正式入口 |
| Kimi Code Adapter | 待验证 | 作为第一真实执行器；通过自身 detect/probe/auth/capability 与生命周期 Gate 后单独定级 |
| Codex Adapter | 待评估/验证 | 作为第二真实执行器，证明公共协议跨厂商 |
| 其他 Agent Adapter | DEFER | 后续按 Adapter 增加，不是首个 Windows RC 的数量 KPI |

W71 不为此顺带建设 Task Capsule、SeatPackage、完整 Harness policy system 或 W70 Cognition。Harness v1 先消费现有 workspace、task instruction、selected files/context、Factory artifact 与 terminal/process。

#### 4.4.4 生命周期、安全与产品表达

Agent session 必须进入统一 resource ledger。关闭 Session、Tab、Workspace 或应用时，应能证明 child process、PTY、listener、stream、temp file 与 workspace handle 被清理，不得遗留 orphan process。

Agent 能编辑文件或执行命令，不能伪装成普通聊天 Provider。通用入口统一称“Agent / 执行器”，每个 Adapter 显示安装、版本、认证、capabilities、健康状态与运行状态。

#### 4.4.5 W66 Adapter Activation Gate

```text
核心架构不存在 Kimi-specific 分支
至少两个真实 Adapter 共用同一 Harness contract
detect / probe 返回确定性结果
Session 创建、运行、等待、完成、失败、取消、销毁可验证
stdout / stderr / error / completion 进入统一状态模型
Agent 特有能力只通过 capability 暴露
Workspace 边界正确，切换 Agent 不要求 Factory 重写逻辑
应用退出无 orphan child process / PTY / listener / stream / temp file
公共 API 不混写 Provider / Harness / Seat / Gate
高权限 Agent 与普通模型调用在 UI 和权限提示上明确区分
```

未满足 Gate 的具体 Adapter 只能标记 Experimental 或 Hidden；不因此把 Harness Foundation 错写成“Kimi 兼容层”。在 2026-08-16 推荐封板范围缩减后，这一整组条件控制 **W66 Vendor Adapter / 通用 Agent UI 何时启用**，不再要求维护者为首个 RC 临时安装、登录或授权两个外部 Agent。Foundation 仍须通过现有契约和资源归零测试。

---

## 5. W71 正式工程域

## 5.1 Correctness / Lifecycle / Resource Ledger

Wave 0 建立统一资源账本，至少观测：

```text
BrowserWindow
WebContentsView / webContents
PanelWindow
listener / unsubscribe
timer / interval
ResizeObserver / MutationObserver
worker
PTY process
Python / debug process
Torrent / WebTorrent client / server
file watcher
MediaStream / track / AudioContext
Object URL
Factory task / stream
```

正式生命周期不变量：

1. 资源创建必须能定位 owner、creation reason 和 destroy path。
2. owner 销毁后，业务资源数必须回到基线。
3. `dispose`、`destroy`、`kill` 必须幂等。
4. stale callback 不得修改已经重建的新实例。
5. 应用退出不得留下 PTY、torrent、watcher、worker 或媒体采集。
6. 20 次打开/关闭循环不得出现业务对象持续累积。

优先核查的现有候选：

```text
Browser 实例级 window.mazz.on 退订
TerminalPanel 的 term:data / term:exit 退订与实例销毁
Notes poll/save/backlink timer 的显式 dispose
TorrentDaemon 应用退出 destroy
Viewer timer / track / AudioContext / worker 回收
Panel host follow listener 回收
```

这些是待验证候选，不得在没有运行态证据时直接宣判为泄漏。

当前进度：Viewer owner、模块实例、DOM 与活动锚点已经通过 packaged 20 次循环；非 Electron Blob URL 通过 contract 20 次及迟到回调测试；Player 全局监听、timer、媒体源、AudioContext/GIF/RAF/转码临时件已有确定收尸实现。本地文件的 AudioContext 播放手势恢复、关签关闭、GIF 正常导出和录制中关签已经在正式 packaged 程序中真实激活并回到资源基线；真实摄像头/麦克风/屏幕设备与权限矩阵仍 OPEN。Factory chat/stream 已接入 caller signal、主进程 request owner、timeout、reader cancellation、renderer-destroy 与 ResourceLedger，并通过 packaged 20 次及 W61b 双路并发实证。Code editor/model、主题 observer、pending interval、TerminalPanel 与 DebugService 已建立宿主级 dispose；packaged TypeScript worker 20 次返回真实 TS2322 诊断，关签后 model 归零，worker 维持最多两个有界共享实例。Python 3.14 + debugpy 1.8.21 已在 packaged 程序完成真实断点/栈/变量/继续和 20 轮 adapter 释放；其他语言、远程/容器调试与异机矩阵仍 OPEN。主窗/分窗同文件外改、标题、全屏、最大化与关窗资源现已按真实 owner 完成 packaged 同场实证；代表性 Markdown 编辑标签已用 ACK/owner/timeout 两阶段协议完成 20 次主窗↔分窗往返，并保持内容、脏态、固定态、选择区和恢复快照唯一 owner；同一标签又完成分窗连续 5 次 renderer 崩溃恢复。单主窗整应用强制终止后的下一轮显式恢复、旧/新 run owner 收敛和第三轮干净启动不误报也已实证；进一步的双窗口事故证明两个 renderer 都为 `tab-1` 时，两份快照仍可按 recoveryId 隔离并扁平恢复到主窗，旧两个 owner 收敛为当前一个 owner。最新代表性矩阵又在正式 packaged 程序内以整棵进程树硬终止验证 Text、Code、Sheet、Slide、Mindmap、Draw 六类内容本体、脏态和固定态完整恢复；恢复后的当前未保存稿继续提示被明确认定为正确保全语义。模块异步载入现有统一 `ready` 结果，失败 DOCX/XLSX/EPUB 会撤回标签及其快照，不再留下幽灵 owner；异步完成前用户关签也不能迟到登记 recent/watch。Factory stream、Terminal、DAP、Agent 等运行时资源的跨窗 owner，Notes/Library/Viewer 路径与运行态、完整 Session 拓扑恢复仍未闭合。详见 [`W71_FILE_OPEN_SAFETY_CHECKPOINT_2026-08-16.md`](./W71_FILE_OPEN_SAFETY_CHECKPOINT_2026-08-16.md)、[`W71_CORE_MODULE_CRASH_RECOVERY_CHECKPOINT_2026-08-16.md`](./W71_CORE_MODULE_CRASH_RECOVERY_CHECKPOINT_2026-08-16.md)、[`W71_MULTIWINDOW_APP_CRASH_SALVAGE_CHECKPOINT_2026-08-16.md`](./W71_MULTIWINDOW_APP_CRASH_SALVAGE_CHECKPOINT_2026-08-16.md)、[`W71_CHILD_CRASH_RECOVERY_CHECKPOINT_2026-08-16.md`](./W71_CHILD_CRASH_RECOVERY_CHECKPOINT_2026-08-16.md)、[`W71_APP_CRASH_RECOVERY_CHECKPOINT_2026-08-16.md`](./W71_APP_CRASH_RECOVERY_CHECKPOINT_2026-08-16.md) 及本节既有生命周期检查点。

## 5.2 Data Reliability Contract

统一数据状态机必须覆盖：

```text
open
modify
save
save as
external change
local + external conflict
rename / delete
snapshot
unclean exit
restore
format conversion
unsupported
corrupted
large file
failure / cancel
```

正式不变量：

1. 外部 `file:changed` 只有一个决策协议；不得同时自动重载和弹重载提示。
2. 脏标签不得被外部变化静默覆盖。
3. 失败转换不得覆盖原文件或留下伪成功产物。
4. 原生格式的声明支持范围必须语义往返一致。
5. Office 格式只承诺经过语料验证的支持子集；unsupported 必须在覆盖/导出前提示。
6. 自己保存触发的 watcher 回声不得重复通知或重复读盘。
7. 快照恢复必须标明来源、时间和目标文件，不把旧快照伪装成磁盘新版本。

当前进度：本地文件外部变化已由两条竞争 listener 收束为单一状态机；干净标签只重载一次，脏标签保留本地内容并提供“保留当前 / 另存当前… / 从磁盘载入”，应用自身保存以路径和文件指纹识别回声。`fs:watch` 现在等待 chokidar 真实 ready，ready 前关闭会立即结算并清除 timer；Save As 也改为写盘成功后才更新标签路径。后续 packaged 同场验证又证明同一文件在主窗脏、分窗净时可各自正确决策，显式载盘后两窗收敛；文件变化由定向 `broadcastShells` 抵达全部工作台壳，分窗标题/全屏/最大化也恢复到 IPC caller owner。代表性 Markdown 标签的跨窗交接现改为目标 ACK 后源窗才提交删除；重复同文件目标会 NACK，脏态、固定态、选择区及内容经过 20 次往返不漂移。恢复快照改为 run + renderer owner 隔离，目标在 ACK 前先落自己的快照；分窗连续 5 次 renderer crash、单主窗整应用异常退出后的显式恢复，以及主窗/分窗两个同名 `tab-1` 脏稿在 whole-app hard kill 后扁平恢复到主窗，均已完成 packaged 实证。整应用事故批次与本轮新快照隔离，成功恢复后旧 run owner 精确删除，未决恢复用 pending 标记跨正常退出保留。Text/Code/Sheet/Slide/Mindmap/Draw 六种结构差异显著的内容模型又完成同一 packaged whole-app hard-kill 恢复，正文、公式、备注、多父关系、sourceRef、帧/图层/笔画及 dirty/pinned 全部守恒。损坏 Office/EPUB、自有表格/画板空壳、未知二进制、未知编码和大损坏 DOCX 已在 packaged 程序中确定性拒绝，失败标签、recent 与 snapshot 均为零；UTF-16 LE 中文文本无损打开。Office 已支持子集的代表性失败语料子 Gate 关闭，但更广格式语料、写盘耗尽/权限失败、Notes/Library/Viewer 运行态、Factory/Terminal/DAP/Agent 重启/取消、LAN Sync 三方冲突与合并仍 OPEN。详见 [`W71_FILE_OPEN_SAFETY_CHECKPOINT_2026-08-16.md`](./W71_FILE_OPEN_SAFETY_CHECKPOINT_2026-08-16.md)、[`W71_CORE_MODULE_CRASH_RECOVERY_CHECKPOINT_2026-08-16.md`](./W71_CORE_MODULE_CRASH_RECOVERY_CHECKPOINT_2026-08-16.md)、[`W71_MULTIWINDOW_APP_CRASH_SALVAGE_CHECKPOINT_2026-08-16.md`](./W71_MULTIWINDOW_APP_CRASH_SALVAGE_CHECKPOINT_2026-08-16.md)、[`W71_APP_CRASH_RECOVERY_CHECKPOINT_2026-08-16.md`](./W71_APP_CRASH_RECOVERY_CHECKPOINT_2026-08-16.md) 及本节既有数据检查点。

## 5.3 Windows Packaged Runtime Contract

必须尽早取得而不是最后才取得 Windows specimen，并验证 packaged app 中：

```text
node-pty
WebTorrent native dependency
ffmpeg
libass
safeStorage
Monaco worker
WebContentsView
Panel BrowserWindow
clipboard
drag/drop
file association
mazz://
```

发布物审计必须区分：

```text
app.asar
app.asar.unpacked
Electron runtime
renderer runtime
native binaries
workers / wasm
source maps
PDB
tests / samples
dev dependencies
multi-platform binary
重复前端 bundle / node_modules
```

在 runtime 全链验证前，不进行激进 prune、dedupe、dependency relocation 或 renderer allowlist 收缩。

## 5.4 Security / Licensing Contract

RC 前必须处理：

```text
LICENSE
NOTICE
third-party attribution / SBOM
ffmpeg source / version / build / hash / license
Updater TLS 或隐藏入口
SearXNG 默认 endpoint / 凭据 / TLS / health / fallback
插件显式信任与 hash 变化再授权
测试 secret 注入
当前树与发布物有效 secret 扫描
```

已吊销旧 API key 是历史卫生项，不再作为生产 CRITICAL；仍有效的 secret、Updater 正式不安全链和未授权插件自动执行属于 Hard Gate blocker。

2026-08-16：未授权插件自动执行 blocker 已以默认隔离、整包 SHA-256 授权、审查后替换拒绝和内容变化撤权关闭；packaged 安装/授权/重启/改包证据见第 14 节检查点。插件仍无进程级沙箱、签名和 permissions enforcement，因此产品分类继续是 Preview。

---

## 6. UI Integrity：三项正式子工程

UI Integrity 由三项互相独立但共享 Census 的工程组成：

```text
Layout Contract
Icon System
Theme Contract
```

它们不是 Wave 末尾的“顺便美化”。普查进入 Wave 0；大规模施工在 Correctness、Lifecycle 和入口状态稳定后进行。

## 6.1 Icon System

### 6.1.1 根因定义

当前风险不是“还有几个 emoji”，而是业务状态可能混用：

```text
emoji literal
inline SVG
iconId
legacy restore metadata
create-time metadata
back-navigation metadata
```

Library 的已知现象正式登记为 P1：

> Library tab icon 在 create → open item → back-to-library 状态转换中重新加载 legacy emoji metadata，证明 icon state 存在多条写入路径。

### 6.1.2 目标契约

业务层只持有：

```text
iconId = "library"
```

以下全部通过统一 IconRegistry / approved SVG asset 解析：

```text
tab
sidebar
toolbar
command
menu
panel title
empty state
navigation
restore metadata
```

正式产品 UI 中 `emoji-as-icon = 0`。允许清单仅包括：

```text
用户内容
Emoji Picker
真实表达语义的文本内容
经过维护者登记的非控件文本
```

禁止用全仓字符串替换实现该目标。验收以运行态 registry、状态转换和允许清单为准。

### 6.1.3 Library P1 测试矩阵

```text
启动 → Library
Library → 打开书籍
书籍 → 返回 Library
关闭 Library → 重开
关闭应用 → session restore
主题切换
Pane 迁移
Window 迁移
```

所有路径必须得到同一 `iconId -> SVG`。完成后反查其他模块的 create/restore/back/reopen 四类路径。

## 6.2 Theme Contract

主题不再只定义颜色，至少统一：

```text
color tokens
text tokens
icon tokens
radius tokens
border treatment
typography
spacing
control density
elevation / shadow
motion
```

以下可控 Surface 必须消费同一 Theme Contract：

```text
主 BrowserWindow
Panel BrowserWindow
Settings / Help
Library / Recorder / Archive / Factory / Plugins
DOM modal
可控 context menu
其它独立子窗
```

系统原生文件对话框、系统菜单和第三方不可控内容不要求像素一致，但调用入口、术语和反馈语义必须一致。

### 6.2.1 Constructivist

Constructivist 主题必须通过 semantic token 控制：

```text
radius-window
radius-panel
radius-card
radius-control
border-width
border-style
shadow
```

未经 Theme Contract 明确允许，可控 Surface 不得继续消费历史圆角。验收看运行时 computed style 与 token，不机械清除全部 `border-radius` 源码。

### 6.2.2 Dark / Light 可辨识度

无特殊语义的 SVG 使用 `currentColor` 或 semantic icon token。禁止无理由硬编码 `#222`、`#333`、black 等深色 fill/stroke。

Wave 0 必须冻结自动对比度阈值。默认验收基线：

```text
普通正文：contrast >= 4.5:1
大字、关键 UI 图标、焦点边界：contrast >= 3:1
disabled 不得只用不可辨识的颜色表达状态
hover / active / selected 必须至少有一种非颜色差异或满足批准的颜色差异
```

硬编码颜色只能在 Census 分类为语义色、内容色或不可 token 化的资产后保留，禁止机械替换所有色值。

## 6.3 Layout Contract

### 6.3.1 全局不变量

1. 任何 Module 不得把自身 Pane 撑出 Shell 分配矩形。
2. 业务模块不得依赖左/右 Sidebar 的具体 px 宽度。
3. 复杂组件依据自身 container 响应，不依据 BrowserWindow viewport 猜测空间。
4. 空间不足必须明确选择 shrink、wrap、collapse、overflow menu 或设计内 horizontal scroll。
5. 所有 flex/grid 内容根审计 `min-width:0`、`min-inline-size:0`、`min-height:0` 等真实 shrink constraint。
6. 支持尺寸和 DPI 下，正式控件不得不可达。
7. 不得用新的固定位置或 magic-number `px/calc()` 补丁修复旧固定位置债。

合理固定值仍允许：

```text
1px border
图标固有尺寸
resize handle
minimum hit target
经过解释的 min/max constraint
```

### 6.3.2 Layout Debt Census

Wave 0 扫描：

```text
width:100vw
固定 width / min-width
固定 left / right
calc(100% - ...)
calc(100vw - ...)
position:absolute
flex-shrink:0
white-space:nowrap
overflow-x:visible
resize 时 JS 重算宽度
模块读取 Sidebar 具体 px
```

每项分类为：

```text
A 合理固定值
B 合理 min/max constraint
C 历史 magic-number workaround
D structural layout debt
E resize/sidebar/split 动态计算债
```

规定产物：

```text
docs/engineering/UI_LAYOUT_CENSUS.md
.mazz/audit/layout-debt.json
```

这两个产物只在 Wave 0 正式获批后生成；当前施工规格不伪造 Census 结果。

### 6.3.3 Responsive Level Contract

复杂 Toolbar / Header / Control Strip 必须定义：

```text
L / M / S / XS
```

以及控件优先级：

```text
P0 始终可达
P1 优先保留
P2 空间允许显示
P3 可进入 More / overflow menu
```

Responsive 的含义是按功能优先级有秩序退化，不是继续缩小控件。

### 6.3.4 Player Reference Implementation

Player 是第一套 Layout 样板，原因是它同时包含 Shell 左右 Sidebar、模块 Sidebar、视频区、时间轴、复杂底栏、窗口 resize、Pane split 和 fullscreen。

概念退化层级：

```text
L  播放 / 时间 / 长时间轴 / 音量 / 字幕 / 倍速 / P2P / 设置 / 全屏
M  播放 / 时间轴 / 音量 / 字幕 / 倍速 / More / 全屏
S  播放 / 时间轴 / More / 全屏
XS 播放 / 简化时间轴 / More
```

具体分组由 Census 和用户路径确定，不机械照抄示例。

优先使用 CSS Container Queries；仅在 CSS 无法表达业务状态时使用 ResizeObserver。JS 不接管可以由 CSS 完成的布局。

Player 样板通过后，按以下顺序推广：

```text
Browser
Factory
Sheet
Slide
Library
Mindmap
Search
PanelWindow action bars
其它复杂 control strips
```

禁止全仓同时重写 Toolbar。

### 6.3.5 Layout E2E

容器宽度使用 CSS pixel，至少覆盖：

```text
1200 / 900 / 720 / 560 / 420 / 320
```

状态维度：

```text
Sidebar 全关 / 仅左 / 仅右 / 左右全开 / 左右 + module sidebar
Pane 100% / 2/3 / 1/2 / 1/3
DPI 100 / 150 / 200%
```

Hard Gate 覆盖所有关键正式模块的代表性组合与每种声明支持 DPI；完整宽度 × Sidebar × Pane × DPI 交叉积属于 Stretch Gate。

默认断言：

```text
scrollWidth <= clientWidth + 1
```

设计为横向滚动的区域必须显式登记豁免。另需断言：

```text
无控件重叠
无负尺寸
无正式控件离开可点击区域
More 中能力可达
resize 后状态稳定
```

Wave 0 建立通用 Layout E2E helper，后续模块不得各写一套不可比较的尺寸探针。

## 6.4 Global Overlay Plane / Multi-Surface Z-order

Mazz 的统一对象是生产环境，不是强迫 Spreadsheet、Browser、Player、Editor 采用同一种 UI 范式。异质 Surface 共享 Workspace、Asset Identity、Context、Lifecycle、Permission 和 Production Flow，但保留各自专业交互。

必须承认：`DOM z-index != Electron Native/WebContents Surface z-order`。Context Menu、Tooltip、Drag Preview、Modal、Command Palette、Selection Overlay 等跨 Surface 浮层进入 Overlay Census，记录 owner、host、coordinate space、clipping、focus、dismiss、native/DOM 实现和遮挡风险。

W71 先做代表性真实路径的 z-order/截图证据，并按根因选择 portal、surface clipping、临时 bounds 协调或独立 overlay window；禁止用 `z-index: 999999` 冒充跨原生 Surface 修复。此项不自动授权 Universal Overlay Manager 或全量 Surface 迁移。

---

## 7. 修订后的 Wave

## Wave 0 — Baseline / Census / Release Foundation

### 目标

冻结范围、取得可发布事实、建立资源与 UI 基线。

### 产物

```text
release E2E manifest
Windows app-unpacked + NSIS specimen
installer / asar / unpacked inventory
resource ledger 与 probes
Surface inventory / protocol reality / workaround register
Surface v1 interface draft（只写接口）
Visual Census
Icon Census
Theme Census
Layout Debt Census
LICENSE / NOTICE / third-party / ffmpeg 供应链记录
PARTIAL 入口状态表
HarnessAdapter v1 / Session state / Capability schema 草案
Agent 发现、认证与权限现实清单
```

### 退出 Gate

- 可从干净环境重复构建并启动 specimen；
- resource ledger 能观测关键资源；
- 四项 UI Census 有范围、分类与 owner；
- 安全和许可 blocker 已有明确闭环路径；
- Product Polish 仍可保持 RED，但不再是未知范围。

## Wave 1 — Correctness / Lifecycle / Data

### 内容

```text
外部文件修改单一状态机
保存 / 另存 / 恢复 / 冲突 / 失败原子性
listener / timer / process dispose
Torrent destroy
Terminal / Notes / Viewer / Panel 资源回收
Agent Session / child process / PTY / stream / temp file 资源回收接入
Library icon metadata 多真源治理
其它 create / restore / back / reopen 图标路径反查
Shell / Pane / Sidebar 基本 Layout Contract
```

### 退出 Gate

- 核心格式无已知静默数据丢失；
- 20 次生命周期循环无业务对象持续累积；
- Library P1 状态债关闭；
- Shell 分配矩形不被模块结构性撑破。

## Wave 2 — Windows Packaged Runtime

### 内容

```text
NSIS / app-unpacked
native ABI
node-pty / WebTorrent / ffmpeg / libass / safeStorage / Monaco
install / first launch / upgrade / uninstall
用户数据策略
file association / mazz://
DPI 代表组合
sleep / resume
drag / clipboard / fullscreen
```

### 退出 Gate

- packaged app 关键 runtime 100% 可用；
- install/upgrade/uninstall 基本矩阵通过；
- 发布物清单可解释；
- 根据 specimen 冻结正式体积预算。

## Wave 3 — Core Product Path Convergence

集中收敛：

```text
Shell
Markdown
Sheet
Slide
Mindmap
Browser
Viewer
Factory
Library
Notes / Search
```

以真实用户路径、数据和错误恢复为主。SurfaceManager 默认不实施；只有满足 3.1 的条件才单独审批 PoC。

## Wave 4 — Peripheral / PARTIAL Resolution

执行第 4 节既定处置：

```text
OCR → Formal
Archive → Formal
Recorder → Preview
Plugins → Preview + security boundary
Mobile → Hidden
Updater → Hidden
W62e → Hidden
W65 → DMHY Preview
W66 Harness Foundation → 建立通用 v1 契约与 Registry
W66 Kimi Code / Codex Adapter → 分别验收，未过 Gate 则 Experimental
```

同步修正 README、帮助和入口文案，消除能力过度承诺与相互矛盾。

W66 在 Wave 0 冻结契约，在 Wave 1 接入 resource ledger，在本波完成 Foundation 与至少两种真实 Adapter 验证。若两种真实执行器无法在现有环境完成可复验闭环，Foundation 可以保留为未扶正基础设施，但不得以 Kimi 专项代码替代通用协议。

## Wave 5A — Layout Convergence

```text
Player reference implementation
→ Browser / Factory / Sheet / Slide
→ Library / Mindmap / Search / Panels
→ 全仓 structural layout debt sweep
```

目标是清除结构性 magic-number 债，不是清除所有 px。

## Wave 5B — Visual Convergence

```text
IconRegistry 与正式 emoji-as-icon 清零
SVG semantic color
Dark / Light contrast
Theme Contract
Constructivist radius / border
跨 BrowserWindow / Panel / DOM 视觉语义
spacing / typography / density
focus / hover / active / disabled
loading / empty / error / success
tooltip / drag / scrollbar
```

完成后才重新评定 Product Polish。

## Wave 6 — Performance / Memory / Soak

验证：

```text
cold / hot startup
1k workspace；10k 作为 Stretch 全矩阵
大 Markdown / XLSX / PDF / Video
20 Browser tabs / Panel / PTY / P2P lifecycle
ffmpeg / OCR
idle / active / close-after
RSS / heap / handles / process / webContents / business resources
```

只修真实线性增长、真实卡顿和真实峰值，不做无用户收益的 micro optimization。

## Wave RC — Final Release Candidate

只执行已冻结的 Hard Gate。Stretch Gate 按设备、时间和环境尽量完成；未完成项进入 Known Limitations。

---

## 8. RC Hard Gate

8.1–8.7 全部满足，才允许将 W71 标记为 RC 完成。8.8 按 2026-08-16 范围缩减改为 Agent 正式入口的 Activation Gate：首个 RC 保持对应入口 Hidden/Experimental 时，不要求维护者临时安装、登录两个外部执行器；一旦开放入口，8.8 必须全部满足。

## 8.1 缺陷、安全与许可

- 已知 P0/P1 = 0。
- 无已知静默数据丢失。
- 无已知任意代码执行 blocker。
- 没有对用户开放的不安全正式更新链。
- 当前树、日志、测试输出和发布物无有效 secret 泄露。
- LICENSE、NOTICE、third-party attribution 和 ffmpeg 供应链记录闭环。

## 8.2 入口与范围

- 所有用户入口明确归类为 Formal、Preview/Experimental 或 Hidden。
- PARTIAL 按第 4 节全部落地，无模糊状态。
- 冻结项没有新增正式入口。
- Preview 标识统一且不能被误认成 Formal。

## 8.3 数据

- 核心格式的声明支持范围可靠，自动断言 100% 通过。
- unsupported 在覆盖/导出前明确提示。
- 打开、保存、另存、外部变化、冲突、快照、异常退出、恢复、损坏文件和失败转换通过代表性语料。
- 失败不得伪成功、覆盖原文件或留下被当作成功产物的残件。

## 8.4 生命周期

- Browser、Panel、PTY、P2P、watcher、Viewer、Factory request 各完成 20 次循环。
- 最终业务对象数、webContents、PTY、torrent、watcher 和媒体采集轨回到基线。
- 三次独立重复运行不存在持续单调增长；RSS 波动若不能归零，必须有稳定平台基线和可解释上界。
- 应用退出没有遗留 Electron/Node/PTY/torrent 进程。

## 8.5 Packaged Windows

- clean install、首次启动、覆盖升级、卸载和用户数据策略通过。
- 基本文件关联与 `mazz://` 通过。
- packaged app 中 node-pty、WebTorrent、ffmpeg、libass、safeStorage、Monaco worker 真实可用。
- asar/unpacked 清单已审计，发布物没有 sourcemap、PDB、测试、无关开发工具、非目标平台 native binary 和已证明重复的资产。

## 8.6 UI Integrity

- 正式 UI 中 emoji-as-icon = 0，允许清单除外。
- 所有正式图标来自批准的 Icon System。
- Library 及其它动态恢复路径不得重新注入 legacy emoji。
- Dark/Light 正文、次级文字、SVG icon、focus、disabled、hover、active 达到冻结的可辨识阈值。
- Constructivist 的所有可控主窗、子窗、Panel、DOM Surface 遵循 ThemeContract radius/border 语义。
- 所有正式复杂 Toolbar 有 L/M/S/XS 与 P0–P3 响应策略。
- 任何正式模块不得无定义横向溢出 Pane。
- 正式控件在声明支持的代表尺寸和 DPI 组合下可达。
- resize、split、Sidebar toggle 修复没有引入新的 magic px 补丁。

## 8.7 自动化

- 当前统一入口 140 个测试文件 100% 通过（含 W69/W82–W86 Design Capsule 防漂移契约）。
- release E2E manifest 必跑场景在 packaged app 100% 通过。
- 主进程 uncaught、渲染 pageerror、非预期 render-process-gone 和未批准 console error 为 0。
- 每份结果记录 commit、Windows、Electron、GPU、DPI 和耗时。
- 每个 RC 关键结论沿 `Source → Test → Packaged Runtime → Real Interaction Path → Screenshot/Visual Evidence → Acceptance` 形成证据链；单纯源码存在或 Node test pass 不得宣称用户路径完成。
- Verification Throughput 必须追上 Generation Throughput：自动启动、操作、截图、比较、Console/Crash 收集、Evidence 归档和 Regression 复跑进入同一 release manifest；新增正式路径不得只增加生成吞吐而不登记验证 owner 与成本。

## 8.8 Agent Harness 入口启用 Gate

本节是 W66 正式入口的 Activation Gate。首个推荐 RC 中 Agent Foundation 只作为内部基础设施存在，通用 Agent UI 与 Vendor Adapter 保持 Hidden/Experimental，因此“至少两个真实 Adapter”不再是 W71 RC 的无条件阻塞；一旦要开放对应入口，以下条件仍全部适用：

- `HarnessAdapter v1`、Agent Registry、Session state 与 Capability schema 已冻结并有契约测试。
- 至少两个真实 Adapter 共用公共协议；核心层不存在 Kimi/Codex 特判。
- detect/probe、运行、等待、取消、失败、完成与 dispose 有确定性验证。
- Session/Tab/Workspace/Application 关闭后没有 orphan child process、PTY、listener、stream 或临时文件。
- Provider、Harness、Seat、Gate 在公共 API、持久化结构和 UI 中没有混写。
- 未通过自身 Gate 的 Adapter 明确标记 Experimental，不影响其它正式入口的诚实性。

---

## 9. Stretch Gate / Known Limitations

以下尽量完成，但不无限阻塞 RC：

```text
10k workspace 完整性能矩阵
1200–320 宽度 × 全 Sidebar × 全 Pane × 100/150/200% DPI 交叉积
完整双显示器矩阵
RDP 多轮矩阵
更广 GPU / 驱动覆盖
每种 Office 格式的大规模真实语料
4–8 小时及更长 soak
安装包极限瘦身
SurfaceManager PoC
原窗口/窗格树/标签顺序/活动焦点的完整 Session 拓扑恢复
全模块 × 全跨窗/分屏/崩溃时点穷举恢复矩阵
Notes / Library / Viewer 与运行时对象的统一可恢复协议
```

每个未完成项必须写入：

```text
Known Limitation
影响范围
规避方式
剩余风险
建议复测环境
后续 owner
```

SurfaceManager PoC 未触发或未实施，不记为 Known Limitation，也不构成 W71 失败。

上述完整 Session、全组合矩阵与统一可恢复协议属于“完整主义扩展”：当前只在发现正式 RC 的 P0/P1 阻塞时回升为 W71 Hard Gate，否则保留到 Post-W71 远期施工，不得从总表遗忘，也不得用其未完成无限阻塞推荐封板。

---

## 10. 新增 Root-Cause Debt

| Debt | Root Cause | W71 Strategy |
|---|---|---|
| Icon state debt | emoji/SVG/iconId 以及 create/restore/back/reopen 多真源 | IconRegistry + 单 iconId 真源 + 状态转换 E2E |
| Theme contract debt | 主题只覆盖颜色或部分 Surface | color/radius/type/spacing/icon/motion 等统一 Theme Contract |
| Layout debt | Shell/Sidebar/Module 缺明确剩余空间和退化协议 | Layout Contract + container-responsive + Responsive Levels |
| Overlay/Z-order debt | DOM 浮层跨 Native/WebContents Surface 后被原生层遮挡 | Overlay Census + 真实交互截图 + 最小 host-aware 协调；不默认建万能 Overlay Manager |
| Verification throughput debt | Agent 生成速度高于 packaged/E2E/视觉验收速度 | release manifest 自动产证、失败聚合与可重复 Regression；没有 Evidence 不迁移完成态 |

这三项与原评估中的生命周期、数据策略、Surface、Windows/Electron、ABI、发布、安全、许可和测试不确定性共同构成 W71 债务地图。

---

## 11. 执行纪律

特别禁止：

```text
全仓机械替换 px
全仓机械替换 hardcoded color
看到 emoji 就字符串替换
一次重构所有 Toolbar
一次迁移所有 Surface
为了统一重新设计业务协议
为了 UI 重写稳定数据模型
为了响应式删除复杂功能
为了体积删除开发环境或历史资产
```

统一执行顺序：

```text
census
→ root cause
→ minimal contract
→ reference implementation
→ A/B + E2E
→ domain rollout
→ RC gate
```

历史代码的判断不能使用：

```text
历史 px / reload / workaround / SVG / CSS = 应删除
```

必须分类为：

```text
真正根因缺失
历史事故补偿
当前必要行为
已经失效 workaround
视觉遗留
状态真源分叉
布局 contract 缺失
```

Browser workaround 继续遵守：没有同场景 A/B 证据，不删。

---

## 12. 最终评分框架

W71 RC 不再只给一个模糊“完成度”。最终报告至少分别评价：

```text
Engineering Completeness
Runtime Stability
Data Reliability
Windows Integration
Packaging
Security
Licensing
Layout Integrity
Icon Consistency
Theme Consistency
Dark / Light Accessibility
Cross-window Visual Consistency
Product Polish
```

Product Polish 在四项 Census 完成前保持 RED / UNASSESSED，不赋百分数。

---

## 13. 历史继承与 Post-W71 索引（不扩大 W71）

0814 接续审阅确认：前版 W71 收敛范围正确，但跨波次归并不能为了简洁删掉已经形成的设计 DNA。本节只建立继承指针，详细状态、代码证据、依赖和来源统一进入 [`Mazz 当前未落地全景-W71归并版.md`](<C:/Users/Administrator/Downloads/交付区/Mazz 当前未落地全景-W71归并版.md>)。

### A. Product Doctrine / Cancelled / Non-goals

```text
Open source / MIT / lifetime free
Chat = cancelled
Studio = emergent product form, not a module backlog
Bridge = pairwise
Mindmap ≠ database
Graph ≠ universal store
Scenario boundary > technology boundary
Provider boundary ≠ world boundary
```

这些是防止未来上下文复活已取消路线的产品宪法，不参与 W71 Wave。

### B. Factory Post-W71 Backlog Ledger

回炉、统一导入、幻锚、审理工艺、审计纪律、培训/持证、调度、声明式绘图、计算委托、弹性编制、成本、岗位 KPI、本地模型测评、任务委托、导演表、产品人格与 Promotion 已逐项查仓，分别标为 LANDED / PARTIAL / METHOD-ASSET / POST-W71 / OBSOLETE。

W71 只验证已经落地的 W68 主链；不得借本索引实施下一代 Factory。完整结果见总表 6.1，后续主要归入 W73/W74。

### C. Design Capsule Index

W64、W70，以及 Asset/Capability/Civilization、Relation Retrieval/Multi-parent、Workspace Event Ledger / 个人工作运行史等设计只保存摘要、权威来源和未来波次映射。W69 已由 [`W69_MAZZHUB_LOCAL_FIRST_CONTENT_NETWORK.md`](../plans/W69_MAZZHUB_LOCAL_FIRST_CONTENT_NETWORK.md) v1.4 升格为 Factory/World/Production Organization Workflows/Charts/Transparent AI Production Market/P2P 六柱、Publication 贯穿的 Local-first Content Network，并拆为 W69a–W69m。[`W82_ORGANIZATIONAL_COMPILER.md`](../plans/W82_ORGANIZATIONAL_COMPILER.md) v0.3 持有组织考古、Evidence-backed State Transition 与跨域生产编译；W73 仍持有 Factory/Production Run 事实，W79 只提供外部 Capability。新增 [`W83_DANMAKU_RUNTIME.md`](../plans/W83_DANMAKU_RUNTIME.md)、[`W84_MAZ_PRODUCTION_ASSET_STANDARD.md`](../plans/W84_MAZ_PRODUCTION_ASSET_STANDARD.md)、[`W85_CONTEXT_COMPILER_AND_COVERAGE.md`](../plans/W85_CONTEXT_COMPILER_AND_COVERAGE.md) 与 [`W86_CAPABILITY_PRODUCTION_RUNTIME.md`](../plans/W86_CAPABILITY_PRODUCTION_RUNTIME.md)，分别持有媒体时钟弹幕、`.maz` Definition 容器、可寻址上下文/覆盖核算与远期物理生产安全扩展。以上均是 Post-W71 Design Capsule，W71 不把它们当仓库实现。

### D. Discussion-stage Candidates

W69 的公开 Comment/Danmaku Event Feed、人类多人 P2P 共看 Room 与 W64 AI 陪看三者明确分离：前者是 Publication 公共事件，Room 是人类实时同步，W64 是 AI 陪伴。Browser 逻辑系列整批 Harvest、厂花/产品人格层等继续标记 Discussion-stage。未冻结候选不得进入 RC 承诺。

### E. Post-W71 OSS Research Reserve

GitHub“拿来主义”补充材料已以全文镜像和工作流路由两层入库：

- [`Mazz-Post-W71-GitHub-拿来主义研究储备.md`](../research/Mazz-Post-W71-GitHub-拿来主义研究储备.md)：外部项目、可复用原语、许可证分流和 PoC 候选的研究底稿；
- [`Mazz_Post-W71_同步与桌面性能工程_增量研究储备.md`](../research/Mazz_Post-W71_同步与桌面性能工程_增量研究储备.md)：统一 Runtime、Replica 语义、T0–T3 Harness、桌面预算与候选 8h Soak 的增量底稿；
- [`POST_W71_OSS_RESEARCH_WORKFLOW.md`](../research/POST_W71_OSS_RESEARCH_WORKFLOW.md)：把 R0–R14 唯一映射到 W72/W74/W75–W81、完整 W67、LAN Sync 演进研究和测试基础设施，并冻结准入、退出与禁区。

本登记不验证选型、不批准 clone/安装/PoC，也不改变 W71 范围。材料中的 `P0/P1` 是 W71 结束后的研究优先级，不是 W71 缺陷优先级。后续只有在目标 commit 的 LICENSE/NOTICE/SBOM/模型卡复核、Mazz-owned interface、可重建派生层和代表性 benchmark 同时成立后，候选才可申请进入独立波次。

### 13.1 W71 与 W72–W86 的硬边界

W72–W86 只是总表中的 Post-W71 分组：资产/能力、Factory 组织完形、统一导入与 Promotion、关系检索、多父级、Shadow Relation、多模态 Anchor、外部工具、文明模型、Workspace Event Ledger / 个人工作运行史、Organizational Compiler、Danmaku Runtime、`.maz` Production Asset、Context/Coverage，以及远期 Capability Production Runtime。它们没有获得开工授权。

W71 Wave 0 建 OSS 发布底账，不等于 W72 Capability Registry 已实施；W71 实施 W66 Harness Foundation，也不等于 W73 下一代 Factory、W79 Blender、W81 工作区事件流或 W82–W86 任一 Compiler/Runtime/Standard 已进入范围。W71 中为了诊断而产生的日志、`.maz` specimen、测试证据和人工总表，也不得借名升级为 W81/W84/W85 产品运行时。

同理，Post-W71 OSS Research Reserve 的全文入库不等于任何外部依赖已经获准。W71 期间禁止据此引入 daemon、native dependency、OCR/LLM 权重、图数据库、向量库或新的后台采集器。

同步/桌面性能研究、W69 与 W82–W86 Capsule 的入库同样不授权 Runtime 重构、同步协议替换、数据库迁移、Hub 服务、账号系统、公共 Seed、World runtime、Organizational Compiler/Factory Runtime、Danmaku Runtime、统一 `.maz` loader/migration/encryption/entitlement/Marketplace、Context daemon/Coverage UI/Decision service、工业协议/SDK/设备连接、Production Record 公共服务、AI 排行榜、AUTO Router、AI Challenge、软件发布/研究/动画/游戏入口、跨行业 Worker Market、外部工具引入、Hyper-V 镜像或 8 小时 Hard Gate。W71 继续执行本规格已经批准的资源记账、真实泄漏修复、20 次循环、Global Overlay 代表性证据与有限 soak；不得借研究或架构材料扩大产品行为、建设万能 Overlay Manager，或重做 Browser/Player/Mindmap 生命周期。

---

## 14. 正式开工授权格式

只有维护者给出明确包含“批准 W71 按本施工规格开工”或等价表述的指令，才进入 Wave 0。

2026-08-15 已收到等价授权：

```text
按照合理的施工逻辑来即可，安排三小时任务，但是不能遗忘表上的历史欠账
```

执行解释：允许 W71 内三个可验收微波施工、测试、构建、回写和提交；所有历史欠账继续以完整未尽波次总表为真源，不因时间盒而降级、删除或冒充结案。

首轮提交 `f2d708a` 后收到后续等价授权：

```text
继续推进
```

本次继续施工只覆盖：四项 UI Census、Surface/protocol/workaround 现实登记、Agent 发现清单，以及 BrowserWindow/PanelWindow/WebContentsView 的 ResourceLedger 接入与 packaged smoke。Census 结果见：

- [`UI_VISUAL_CENSUS.md`](./UI_VISUAL_CENSUS.md)
- [`UI_ICON_CENSUS.md`](./UI_ICON_CENSUS.md)
- [`UI_THEME_CENSUS.md`](./UI_THEME_CENSUS.md)
- [`UI_LAYOUT_CENSUS.md`](./UI_LAYOUT_CENSUS.md)
- [`W71_SURFACE_PROTOCOL_CENSUS.md`](./W71_SURFACE_PROTOCOL_CENSUS.md)
- [`W71_AGENT_RUNTIME_CENSUS.md`](./W71_AGENT_RUNTIME_CENSUS.md)

这些产物把未知范围变成了可重复事实。后续检查点又完成 Torrent/FileWatcher 扩账、PTY/Panel/WebContentsView/FileWatcher/WebTorrent 20 次循环、27 个外平台 native binary 的 staging 与正式排除，以及 SearXNG/Updater/Translate TLS 和凭据收口。证据见 [`W71_WAVE0_LIFECYCLE_SECURITY_CHECKPOINT_2026-08-15.md`](./W71_WAVE0_LIFECYCLE_SECURITY_CHECKPOINT_2026-08-15.md)。

下一检查点把 PythonKernel 与 DebugService 接入共享 ResourceLedger，关闭 DAP 旧进程退出覆盖新会话、pending timer 残留和初始化失败留进程三类风险；Python 在正式 packaged 程序中完成 20 次真执行/销毁，DAP 完成 20 次替换/停止契约循环。证据见 [`W71_WAVE1_PROCESS_LIFECYCLE_CHECKPOINT_2026-08-15.md`](./W71_WAVE1_PROCESS_LIFECYCLE_CHECKPOINT_2026-08-15.md)。

随后完成 Viewer/Player owner、Factory request owner 与 Monaco/Code 三个检查点：Viewer、Factory request、Code/Monaco 均通过 packaged 20 次；Factory 的非流式/流式请求、timeout、SSE reader、renderer-destroy 与每任务 AbortController 已闭环，W68 补遗路径也完成真机回写；TypeScript worker 返回真实语义诊断，Code 关签后 model/DOM/活动锚点归零，迟到初始化不能复活宿主。证据见 [`W71_WAVE1_VIEWER_LIFECYCLE_CHECKPOINT_2026-08-15.md`](./W71_WAVE1_VIEWER_LIFECYCLE_CHECKPOINT_2026-08-15.md)、[`W71_WAVE1_FACTORY_REQUEST_LIFECYCLE_CHECKPOINT_2026-08-15.md`](./W71_WAVE1_FACTORY_REQUEST_LIFECYCLE_CHECKPOINT_2026-08-15.md) 与 [`W71_WAVE1_MONACO_LIFECYCLE_CHECKPOINT_2026-08-15.md`](./W71_WAVE1_MONACO_LIFECYCLE_CHECKPOINT_2026-08-15.md)。

2026-08-16 检查点关闭未授权插件自动执行 Hard Gate：新装默认隔离，授权绑定整包 SHA-256，内容变化自动撤权，并完成干净 userData 下的安装、授权、重启与改包 packaged E2E。Plugins 因尚无进程级沙箱、签名与 permissions enforcement，继续保持 Preview。同期完成首启协议遮挡根因修复，以及协议、上下文菜单、Quick Switcher、拖拽四条活动 WebContentsView 同场 z-order 证据；未触发 SurfaceManager/Universal Overlay Manager。证据见 [`W71_SECURITY_OVERLAY_CHECKPOINT_2026-08-16.md`](./W71_SECURITY_OVERLAY_CHECKPOINT_2026-08-16.md) 与 [`W71_OVERLAY_ZORDER_CENSUS.md`](./W71_OVERLAY_ZORDER_CENSUS.md)。

2026-08-16 又关闭一项许可阻塞并缩小一项媒体/许可不确定性：通过仅限 `exceljs` 的 `unzipper@0.12.3` override，将无许可声明的 `buffers@0.1.1` 及其 `binary` 链从锁定运行依赖中移除，10 份 XLSX 往返与导出契约通过。vendored ffmpeg 已在真实 `win-unpacked` 中完成加载、WAV→MP3 转码、显式释放与重载；运行时自报 FFmpeg 5.1.4、`--enable-gpl`，WASM 与官方 `@ffmpeg/core@0.12.10` 精确同 hash，JS 仅换行/外层空白不同。ffmpeg 的“来源/许可证分类未知”已经消除，但最终安装包仍缺完整 GPL 文本、notice 和持久 corresponding-source 交付机制，故其发布许可 Gate 仍为 OPEN。同期修复转码进度 listener、失败路径虚拟文件和 worker/WASM 显式释放债。

同日发布物复审发现 `app.asar` 仍夹带 388 份依赖 source map（原始 70,344,542 bytes），根因是既有规则只排除 renderer map。增加统一的 `!node_modules/**/*.map` 后重建，`app.asar` source map / PDB / test directory 均归零，asar 从 360,465,697 降至 290,083,965 bytes，最终 `win-unpacked` 从 667,726,899 降至 597,387,265 bytes；NSIS installer 从 150,813,568 降至 141,028,503 bytes，SHA-256 为 `D178BFC98310233781BDB43E885A4963FCD3EF83A6958C5CCE8831A59620D4D1`。packaged smoke、20 次生命周期与 ffmpeg 真转码继续通过。该子 Gate 仅关闭 source-map 泄漏和当前安装包重新计量，不代替签名、安装/升级/卸载和异机 ABI。证据见 [`W71_PACKAGING_BOUNDARY_CHECKPOINT_2026-08-16.md`](./W71_PACKAGING_BOUNDARY_CHECKPOINT_2026-08-16.md) 与 [`W71_RELEASE_BASELINE.json`](./evidence/W71_RELEASE_BASELINE.json)。

同一 specimen 随后通过自动化 NSIS 真安装循环：在确认当前用户没有既有 Mazz Editor 安装注册或快捷方式后，静默安装到系统临时根目录内的隔离目标；从安装目录中的正式 EXE 使用干净 userData 启动，并完成包含主窗、PTY、Panel、WebContentsView、FileWatcher、WebTorrent、Python、Viewer、Factory 与 Monaco 的 20 次生命周期冒烟；静默卸载后主 EXE、HKCU 卸载注册、常见快捷方式与测试目录产品文件均归零。该结果关闭“本机 clean install / 首次启动 / silent uninstall”子门禁，但不代替签名、覆盖升级/回滚、默认用户数据策略、文件关联/`mazz://`、异机 ABI 与 Windows/DPI/RDP 矩阵。证据见 [`W71_INSTALLER_CYCLE_CHECKPOINT_2026-08-16.md`](./W71_INSTALLER_CYCLE_CHECKPOINT_2026-08-16.md) 与 [`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json)。

紧接着的系统集成复验从上述卸载残留中抓到三项根因：运行时自行注册 `mazz://` 导致卸载器不知情、文件关联使用通用展示名充当 ProgID、builder 默认打开命令未给含空格 EXE 加引号。当前改由 NSIS 成对持有 `mazz` protocol，四种扩展统一使用 `com.mazz.editor.*` 唯一 ProgID 并覆盖为带引号命令；主进程补冷启动/二实例协议排队，renderer 冻结 `mazz://home` 最小消费。真安装后 `.md/.markdown/.txt/.mazz` 与协议注册 5/5 精确匹配，文件参数和 `mazz://home` 均经第二实例抵达真实界面；卸载后 Mazz protocol、ProgID、私有 backup、专有扩展空 key 均归零，原默认值恢复。基础文件关联与 `mazz://home` 子门禁在当前用户模式 PASS；Shell 可见 UI、默认应用争用、多用户安装、其它深链路、覆盖升级/回滚、签名和异机矩阵仍 OPEN。证据见 [`W71_WINDOWS_INTEGRATION_CHECKPOINT_2026-08-16.md`](./W71_WINDOWS_INTEGRATION_CHECKPOINT_2026-08-16.md) 与 schema v3 [`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json)。

同一安装门禁随后加入同 specimen、同目录第二次静默安装：第二次安装后 EXE hash、卸载注册、五条系统集成命令保持正确，四类关联 backup 仍精确等于首次安装前捕获的原 owner，没有被当前 Mazz ProgID 覆盖；覆盖后的正式 EXE 再完成 20 轮 packaged smoke，最终卸载仍恢复原 owner 并清除全部 Mazz 私有状态。该结果只关闭同版本 reinstall / repair 子门禁，不能外推为真实跨版本升级、失败升级、降级或回滚。证据见 [`W71_SAME_VERSION_REINSTALL_CHECKPOINT_2026-08-16.md`](./W71_SAME_VERSION_REINSTALL_CHECKPOINT_2026-08-16.md) 与 schema v3 [`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json)。

安装态系统集成随后不再由测试直接启动已知 EXE，而改由 Windows `url.dll/FileProtocolHandler` 根据 `mazz://home` 和 `.md` 注册分发；两条路径均抵达现有主实例并真实打开 Browser / Markdown，系统规范化协议尾斜杠不再被当作失败。为防 Shell 子进程退出与卸载抢跑，测试在 uninstaller 前新增 installed EXE 可改名/还原占用探针；最终成功轮退出后一次即释放，卸载归零。该结果关闭当前主机、主实例已运行时的 Windows Shell 分发子门禁；Explorer 可见 UI、UserChoice/默认应用争用与主实例未运行时的冷启动 Shell 仍 OPEN。证据见 [`W71_WINDOWS_SHELL_DISPATCH_CHECKPOINT_2026-08-16.md`](./W71_WINDOWS_SHELL_DISPATCH_CHECKPOINT_2026-08-16.md)。

完整 Wave 0 / Wave 1 / Wave 2 Gate 仍未通过：本地文件的 AudioContext/GIF packaged 激活已经完成，但真实摄像头/麦克风/屏幕设备、权限拒绝/取消、Recorder 最小化/长录制等矩阵仍未完成；Factory 的产品自有慢响应/断网/半包 SSE 与 renderer crash 故障层已在后续检查点完成确定性真注入，但第三方 Provider 差异和长任务 soak 仍缺；当前主机 Python/debugpy DAP 真适配器已通过，但其他语言、远程/容器调试和异机矩阵仍缺；三个 `node-pty/build/Release` 产物仍需异机 ABI 证明，ffmpeg 分发合规仍未闭环，签名、覆盖升级/回滚、默认应用争用、系统 Shell 可见 UI 和异机安装矩阵仍缺，真实 Agent Adapter 仍为 0。代表性 Markdown 标签的事务性交接、分窗 renderer 恢复和单主窗整应用异常退出恢复已通过；其他模块迁移、运行时 owner 与完整多窗口 Session Restore 仍未闭环。

首轮结果与证据见 [`W71_THREE_HOUR_CHECKPOINT_2026-08-15.md`](./W71_THREE_HOUR_CHECKPOINT_2026-08-15.md)。

授权前的只读停止线已经解除。授权后仍禁止：

```text
升级依赖或 Electron
删除 workaround / legacy
夹带 W63–W86 功能施工
把微波完成冒充完整 Wave 退出
把 Foundation 冒充真实 Adapter 已扶正
```

每个检查点完成后必须回写完整未尽波次总表、记录测试/构建证据并提交，下一检查点继续按本规格 Gate 推进。

2026-08-16 多窗口整应用异常退出数据保全检查点进一步证明：同一事故 run 中主窗与分窗可同时持有各自的 `tab-1`，不透明 recoveryId 仍把两份 owner 快照隔离；部分完成只删除已消费旧件并把剩余精确留在 pending。正式 packaged 程序在主窗/分窗分别持有不同 Markdown 脏稿时硬终止完整 Windows 进程树，次轮显示 2 份并把全文、路径、脏态、固定态和不同选择区全部扁平恢复到主窗；旧两个 owner 收敛为当前一个 owner，ResourceLedger `3→2`，第三轮不误报。`fallback=flattened-into-main-window` 与 `topologyRestored=false` 被写入机器证据，故不冒充窗口/窗格/焦点/顺序的 Session Restore。全量保持 `147/147`；最终 schema v5 安装/覆盖/五入口/20 轮/卸载通过，installer `141,036,294` bytes，SHA-256 `E76FA573354667EDAB04BAD1CA05D7F76052D44DADCE328E1F9D0A9A74E5EC0B`。证据见 [`W71_MULTIWINDOW_APP_CRASH_SALVAGE_CHECKPOINT_2026-08-16.md`](./W71_MULTIWINDOW_APP_CRASH_SALVAGE_CHECKPOINT_2026-08-16.md) 与 [`W71_MULTIWINDOW_APP_CRASH_RECOVERY.json`](./evidence/W71_MULTIWINDOW_APP_CRASH_RECOVERY.json)。

2026-08-16 可序列化核心模块恢复检查点按推荐封板冻结代表性 Hard Gate：在正式 `win-unpacked` 的同一主窗口建立 Text、Code、Sheet、Slide、Mindmap、Draw 六类 dirty + pinned 标签，写入带正文、公式、演讲者备注、多父关系/sourceRef 及画板帧/图层/笔画的辨识数据后，用 Windows `taskkill /T /F` 硬终止整棵进程树。次轮 6 份材料全部按领域投影恢复，旧 owner 退役、六份新快照收敛到当前单 owner、pending 清零。测试同时纠正“恢复后正常退出应无提示”的错误假设：这些标签仍是合法当前未保存稿，继续提示属于正确保全；只有显式放弃测试快照后，第三轮才要求旧事故不诈尸。全量增至 `148/148`。Notes/Library/Viewer 路径与运行态、运行时对象、原窗口/窗格/焦点/顺序的完整 Session 拓扑、全模块全组合及广泛系统矩阵保留为后续 Gate/远期完整主义扩展，不冒充当前 Hard Gate。证据见 [`W71_CORE_MODULE_CRASH_RECOVERY_CHECKPOINT_2026-08-16.md`](./W71_CORE_MODULE_CRASH_RECOVERY_CHECKPOINT_2026-08-16.md) 与 [`W71_CORE_MODULE_CRASH_RECOVERY.json`](./evidence/W71_CORE_MODULE_CRASH_RECOVERY.json)。

2026-08-16 整应用异常退出恢复检查点把旧 `RUNNING.flag + snapshot:list` 的“能提示”收敛为有批次所有权的恢复事务：`RUNNING.flag` 记录精确 runId，启动时只冻结该事故 run 的文件；兼容旧时间戳 flag 时也只选 savedAt 最新的同 run owner 组，不吞全部历史。主工作台按不透明 recoveryId 领取，新 run 先写自己的快照，主进程再精确删除实际恢复成功的旧件。`RECOVERY_PENDING.flag` 保存精确 recoveryId 清单，保证用户未作决定就正常退出时下轮仍继续提示，全部恢复/明确忽略/无有效候选后才清除。正式 packaged 程序经历主进程树硬终止、同 userData 第二轮提示并恢复完整 Markdown 脏稿、旧/新 owner `1→1` 收敛、正常退出与第三轮不误报。全量增至 `147/147`。安装矩阵同时纠正一项旧假设：`mazz://home` 继续走 Windows Shell，而公共 `.md` 只验证已审计注册命令和运行中二实例分发，不再把“处理器已注册”冒充“系统默认已选择”；最终 schema v5 安装/覆盖/五入口/20 轮/卸载通过。installer `141,036,293` bytes，SHA-256 `476935D578D2F0B1E8416EAA74C560F5C3E59CE675DCC5548A4DA9B60F2F2830`。其他模块、运行时对象、多窗口拓扑、部分恢复 UX、debounce 窗口、DPI/RDP 与 LAN Sync 冲突仍 OPEN。证据见 [`W71_APP_CRASH_RECOVERY_CHECKPOINT_2026-08-16.md`](./W71_APP_CRASH_RECOVERY_CHECKPOINT_2026-08-16.md) 与 [`W71_APP_CRASH_RECOVERY.json`](./evidence/W71_APP_CRASH_RECOVERY.json)。

2026-08-16 分窗 renderer 崩溃恢复检查点补上事务性交接之后最直接的数据可靠性断口：主进程只为 `role=child` 的完整工作台 crash 建立一次性 token，重载后的分窗按 WebContents owner 领取自己的快照；renderer 启动时由 URL 同步恢复 window role，快照补齐标题、脏态、固定态与选择区，并在恢复后只裁剪当前 owner 的旧 tabId。正式 packaged 程序连续 5 次 `forcefullyCrashRenderer()` 后均恢复同一份完整 Markdown 脏稿，标题没有重复后缀，快照稳定为 1 份，最终仍可事务性交接回主窗，ResourceLedger `2→3→2`。全量测试增至 `146/146`；installer `141,034,491` bytes，SHA-256 `4C601AA91388EBA0A31C4B8FF6438B986827784B51D90607562BB28D273FC906`，schema v5 真安装/覆盖/五入口/20 轮/卸载继续通过。该结果只关闭代表性 Markdown child renderer 恢复；其他模块、运行时对象、整应用异常退出拓扑、debounce 窗口、DPI/RDP 和 LAN Sync 冲突仍 OPEN。证据见 [`W71_CHILD_CRASH_RECOVERY_CHECKPOINT_2026-08-16.md`](./W71_CHILD_CRASH_RECOVERY_CHECKPOINT_2026-08-16.md) 与 [`W71_CHILD_CRASH_RECOVERY.json`](./evidence/W71_CHILD_CRASH_RECOVERY.json)。

2026-08-16 FFmpeg 分发子检查点进一步收口：vendored `esm/` 六文件已归一匹配官方 `@ffmpeg/ffmpeg@0.12.10`，wrapper MIT 身份闭环；core 继续由 npm 字节身份与真实 `--enable-gpl` 运行证据支撑。完整 GPLv2、wrapper MIT、组件 NOTICE、provenance 与 source reproducibility 状态五份材料已进入真实 `app.asar`，release audit schema v2 对五份材料逐项抽取、计量并记录 SHA-256。新 installer 为 `141,036,193` bytes，SHA-256 `6F816396A4D09F5C9304017D21DA34F879CEFD08E11D168191411F19295011C2`；packaged smoke、20-cycle 生命周期和真转码/释放/重载均通过。但上游 `v0.12.10` 构建脚本仍含 `x264#4-cores`、`lame#master` 等可变 ref，原始发布 commit set 尚未恢复，故总 Gate 明确保持 `OPEN_CORRESPONDING_SOURCE`。证据见 [`W71_FFMPEG_DISTRIBUTION_CHECKPOINT_2026-08-16.md`](./W71_FFMPEG_DISTRIBUTION_CHECKPOINT_2026-08-16.md)、[`W71_LICENSE_AUDIT.json`](./evidence/W71_LICENSE_AUDIT.json) 与 [`W71_RELEASE_BASELINE.json`](./evidence/W71_RELEASE_BASELINE.json)。

同日 Windows Shell 冷启动检查点关闭当前主机的 `mazz://home` 与 `.md` 未运行态分发：二者均由 `url.dll/FileProtocolHandler` 拉起隔离安装 EXE，分别以 `隐私浏览器 — Mazz Editor`、`cold-start-file.md — Mazz Editor` 主窗标题证明 renderer 已消费目标。门禁同时实锤“退出”旧路径只关窗、不退托盘进程，现由 `window-all-closed` 在 `wm.forceClose` 时进入 `app.quit()`；两条最终冷启动均正常关窗、一次轮询全进程退出、一次探针 EXE 解锁，强杀为 0。安装证据升 schema v4，后续暖分发、20 轮和 silent uninstall 继续通过；当前 installer `141,035,138` bytes，SHA-256 `C7FEB742EDDEE416FDBD9C5055D684F2BE0E1DF2430F0600CDFF24FC9554F727`。Explorer/打开方式 UX、UserChoice、其他三类扩展冷启动、多用户、签名、跨版本升级/回滚与异机矩阵仍 OPEN。证据见 [`W71_WINDOWS_COLD_START_EXIT_CHECKPOINT_2026-08-16.md`](./W71_WINDOWS_COLD_START_EXIT_CHECKPOINT_2026-08-16.md) 与 schema v4 [`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json)。

随后 Windows 关联矩阵把“处理器可用”与“系统默认”正式拆开：`.md/.markdown/.txt` 先核对安装 ProgID 命令，再由显式处理器完成未运行态冷启动；Mazz 自有 `.mazz` 与 `mazz://home` 继续由 Windows Shell 冷启动。`.markdown` 在没有 UserChoice 时的系统 Shell 会进入 `OpenWith.exe`，因此无人值守门禁不再通过写 UserChoice 或遗留弹窗强求假绿。测试对 `.md/.markdown/.txt/.mazz` 的 UserChoice `ProgId/Hash` 在安装、同版本覆盖、冷启动、20 轮冒烟和卸载后逐阶段比对；当前主机已有 `.txt=txtfile` 选择全程不变。安装器同时把关联刷新移到最终写入/删除之后，并在卸载时只清理四项 Mazz 自有 `Explorer/FileExts/OpenWithProgids` 值；schema v5 最终五入口标题可见、正常退出/EXE 解锁、强杀为 0，关联与安装目录残留归零。当前 installer `141,035,258` bytes，SHA-256 `AC13C34A153D6B0190FBEF3C9519D3B84A9826B335391E271470394ADF5E15A9`。该检查点关闭当前主机的 UserChoice 不改写、四扩展显式处理器冷启动和自有入口 Shell 冷启动；Explorer 默认应用选择 UX、用户主动选择后的公共扩展 Shell 分发、多用户、签名、跨版本升级/回滚与异机矩阵仍 OPEN。证据见 [`W71_WINDOWS_ASSOCIATION_MATRIX_CHECKPOINT_2026-08-16.md`](./W71_WINDOWS_ASSOCIATION_MATRIX_CHECKPOINT_2026-08-16.md) 与 schema v5 [`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json)。

Factory 故障矩阵随后用正式 `win-unpacked`、真实 Electron `net.fetch` 与本机随机端口 HTTP/SSE 服务完成确定性注入：慢响应在测试专用 600ms 上限内超时并关闭连接，连接拒绝返回错误，合法 delta 后 EOF 被判为半包且绝不发送 `done`，正常 SSE 保持完整；流保持中强杀 renderer 后，request registry `1→0`、socket 关闭、主窗自动恢复、ResourceLedger `2→2`。主进程新增的 SSE 完整性判定只承认 `[DONE]` 或 `finish_reason`，损坏/截断 JSON 不再静默吞掉；Factory owner 同时监听 `render-process-gone` 与 `destroyed`。全量测试为 `143/143`，九族 packaged 20 轮回基线，最终 installer `141,033,491` bytes、SHA-256 `9334DA2B2F5705903739ECC0084CC37FD925B931D2FE2D8E4EC5A25693427CCF`，schema v5 真安装/同版本覆盖/入口/卸载复验继续通过。这关闭产品自有故障处理与 renderer crash 收尸层，不冒充第三方 Provider 的 TLS、代理、限流、非标准 SSE 或长任务 soak。证据见 [`W71_FACTORY_FAULT_MATRIX_CHECKPOINT_2026-08-16.md`](./W71_FACTORY_FAULT_MATRIX_CHECKPOINT_2026-08-16.md)、[`W71_FACTORY_FAULT_MATRIX.json`](./evidence/W71_FACTORY_FAULT_MATRIX.json)、[`W71_RELEASE_BASELINE.json`](./evidence/W71_RELEASE_BASELINE.json) 与 schema v5 [`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json)。

媒体运行时激活检查点随后用正式 packaged Chromium 原生对象和产品现有 ffmpeg WASM 路径关闭本地文件分支：保存 150% 增益的 WAV 在播放手势内把 AudioContext 恢复到 `running`，关签后进入 `closed` 且只关闭一次；短 WebM 的 GIF 正常完成产出 `GIF89a`，录制中关签亦把 recorder 置为 `inactive`、全部 track 置为 `ended`，两路最终 ResourceLedger 均为 `2→2`。激活过程修复了 GIF 停止误用 `rec.rec` 和 WebAudio 图创建后播放按钮未恢复上下文两个产品根因。全量 `143/143`，最终 installer `141,033,837` bytes、SHA-256 `3F1907786A8A59C1E54017643532A1F322AA8441115E09866A345C9BFA783482`；schema v5 真安装/同版本覆盖/五入口/20 轮/卸载继续通过。本轮使用本地合成媒体、不访问硬件设备，因此只关闭 packaged AudioContext/GIF 子门禁；摄像头、麦克风、屏幕权限/拒绝/取消、Recorder 最小化/长录制与硬件/RDP 矩阵仍 OPEN，也不实施 W64。证据见 [`W71_MEDIA_RUNTIME_ACTIVATION_CHECKPOINT_2026-08-16.md`](./W71_MEDIA_RUNTIME_ACTIVATION_CHECKPOINT_2026-08-16.md)、[`W71_MEDIA_RUNTIME.json`](./evidence/W71_MEDIA_RUNTIME.json)、[`W71_RELEASE_BASELINE.json`](./evidence/W71_RELEASE_BASELINE.json) 与 schema v5 [`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json)。

真实 DAP 检查点随后以隔离固定的 Python 3.14.6 + debugpy 1.8.21 驱动正式 packaged 程序，实锤并修复两项伪适配器无法暴露的状态机缺陷：主进程不再等待 `launch` response 后才放行 `configurationDone`，而是在 `initialized` 事件后把控制权还给 renderer；debugpy 发出 `terminated` 后立即停止仍在等待的 adapter、释放资源并结束界面调试态。真调试已验证第 2 行断点、2 帧调用栈、Locals `a=2/b=3`、继续执行结果 `5` 与 stdout；完整 1 次加 20 次循环共释放 21 个 `debug-process`，ResourceLedger `2→2`。全量 `143/143`；最终 installer `141,041,336` bytes、SHA-256 `BB3AA049DBA22CC1FD13E6D50C1EA0536FDE7FB92BF0FB0827F70F836FCD193D`，schema v5 安装回归继续通过。产品不内置或暗装 debugpy；其他语言 Adapter、attach、远程/容器调试和异机矩阵仍 OPEN，W66 Agent Adapter 仍为 0。证据见 [`W71_DAP_RUNTIME_CHECKPOINT_2026-08-16.md`](./W71_DAP_RUNTIME_CHECKPOINT_2026-08-16.md)、[`W71_DAP_RUNTIME.json`](./evidence/W71_DAP_RUNTIME.json)、[`W71_RELEASE_BASELINE.json`](./evidence/W71_RELEASE_BASELINE.json) 与 schema v5 [`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json)。

外部文件变化检查点继而关闭本地单机主路径的三项数据不变量：Shell 只保留一条 `file:changed` 决策入口，脏标签绝不静默覆盖，应用自身保存不重复通知或读盘；同时修复 chokidar 就绪竞态、Chromium timer `Illegal invocation`、Save As 失败后伪换路径和分屏 owner 错写。正式 packaged E2E 验证干净文件恰好重载一次、脏稿保留并给出三项显式动作、用户选择磁盘版本后正确清脏、自保存无伪冲突，ResourceLedger `2→2`。全量增至 `144/144`；最终 installer `141,039,701` bytes、SHA-256 `BCCBCCDD3C269138AA5FEC4765046A3839172EAEB1181283E7EF89C1665D4004`，schema v5 安装/覆盖/五入口/20 轮/卸载继续通过。Office 语料、多窗同文件并发、LAN Sync 冲突和三方合并仍 OPEN。证据见 [`W71_EXTERNAL_FILE_CHANGE_CHECKPOINT_2026-08-16.md`](./W71_EXTERNAL_FILE_CHANGE_CHECKPOINT_2026-08-16.md)、[`W71_EXTERNAL_FILE_CHANGE.json`](./evidence/W71_EXTERNAL_FILE_CHANGE.json)、[`W71_RELEASE_BASELINE.json`](./evidence/W71_RELEASE_BASELINE.json) 与 [`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json)。

多窗口所有权检查点随后关闭“同一文件在主窗/分窗的外改分流”和基础窗控子门禁：历史 `broadcast()` 只发主窗，FileWatcher/删除/快记却误作全工作台广播；现保留旧语义并新增定向 `broadcastShells()`。分窗标题、全屏/最大化查询与切换也不再硬编码主窗，统一落到 IPC sender 对应 BrowserWindow。正式 packaged 同场证明主窗脏稿保留并给三项决策、分窗干净稿自动更新，显式载盘后双窗收敛；标题、全屏、最大化只作用子窗，关闭后 ResourceLedger `2→3→2`。全量 `144/144`；最终 installer `141,038,151` bytes、SHA-256 `F26C888453C3E0F4AAD404528AAF1718623ACC70F25420EA7D176FAB720135F6`，schema v5 安装矩阵继续通过。跨窗 Factory/Terminal/DAP/Agent owner、迁入/迁回 20 次、crash restore、DPI/RDP 与 LAN Sync 三方冲突仍 OPEN。证据见 [`W71_MULTIWINDOW_OWNERSHIP_CHECKPOINT_2026-08-16.md`](./W71_MULTIWINDOW_OWNERSHIP_CHECKPOINT_2026-08-16.md)、[`W71_MULTIWINDOW_FILE_CHANGE.json`](./evidence/W71_MULTIWINDOW_FILE_CHANGE.json)、[`W71_RELEASE_BASELINE.json`](./evidence/W71_RELEASE_BASELINE.json) 与 [`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json)。

跨窗口事务性交接检查点继而关闭代表性 Markdown 编辑标签的“发送即删除”和快照 owner 冲突：每次迁移生成一次性 `transferId`，主进程只接受目标 WebContents ACK；目标销毁、renderer crash、12 秒超时或重复同文件拒绝均使源标签保留。交接保留内容、脏态、固定态和选择区，目标先恢复并落 owner 快照后才确认；快照键加入 runId 与 sender WebContents id，跨 renderer/跨 run 的同名 `tabId` 不再互相覆盖或误删。正式 packaged E2E 完成 20 次主窗↔分窗往返、42 次成功交接，逐轮状态不漂移且 ResourceLedger `2→3→2`；重复目标的源/目标内容均保持，全量增至 `145/145`。最终 installer `141,020,301` bytes、SHA-256 `166161C2D798309657D76B9D730FC75D92DAC7DFD991F970AC5BFEE256AF6171`；schema v5 安装/覆盖/五入口/20 轮/卸载继续通过。该证据只覆盖代表性 Markdown 标签，不外推到 Viewer/Browser/Sheet/Slide/Mindmap；child crash restore、跨窗 Factory/Terminal/DAP/Agent owner、DPI/RDP 与 LAN Sync 三方冲突仍 OPEN。证据见 [`W71_WINDOW_HANDOFF_CHECKPOINT_2026-08-16.md`](./W71_WINDOW_HANDOFF_CHECKPOINT_2026-08-16.md)、[`W71_WINDOW_HANDOFF_RUNTIME.json`](./evidence/W71_WINDOW_HANDOFF_RUNTIME.json)、[`W71_RELEASE_BASELINE.json`](./evidence/W71_RELEASE_BASELINE.json) 与 [`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json)。

文件打开安全检查点随后关闭“解析失败却留下干净空签”的数据风险：Module Registry 将同步/异步 `setContent` 统一为可等待的 `{ok,error}`，DOCX/XLSX 不再吞拒绝，EPUB 入库空结果也会撤回临时标签；只有 load owner 仍存活且解析成功后，Shell 才登记 recent/watch。主进程新增 64 KiB 取样探针，未知二进制与不支持编码不再回退成可覆盖原件的乱码文本；UTF-16 LE 则按正确编码无损读取。正式 packaged 门禁中，损坏 DOCX/XLSX/EPUB、自有表格/画板空壳、未知二进制、未知编码和大损坏 DOCX 共 9 类全部返回失败，标签/recent/snapshot 零残留；合法 UTF-16 LE 中文通过。注入转换失败和真实写盘失败时，原目标字节、dirty 状态与原子临时件清理均正确。全量增至 `150/150`。穷举编码/格式/磁盘/权限矩阵和插件化格式识别保留到 Post-W71 完整主义扩展。证据见 [`W71_FILE_OPEN_SAFETY_CHECKPOINT_2026-08-16.md`](./W71_FILE_OPEN_SAFETY_CHECKPOINT_2026-08-16.md) 与 [`W71_FILE_OPEN_SAFETY.json`](./evidence/W71_FILE_OPEN_SAFETY.json)。

当前源码随即完成发布回归：新 installer 为 `141,035,270` bytes，SHA-256 `262D17B5D77CCA65C27110B3CF51CCE4C1736686CC72DF69A4D66F9250D1B030`；win-unpacked `597,463,879` bytes，app.asar `290,160,579` bytes，packaged source map `0`，unpacked native `10` files / `2,625,024` bytes，FFmpeg 分发材料 `5/5`。schema v5 再次通过 clean install、同版本 reinstall、五入口、UserChoice 不改写、安装态 20 轮 ResourceLedger `2→2`、正常退出与 silent uninstall；Agent Adapter/Session 仍诚实记录为 `0/0`。构建明确因没有证书跳过代码签名。后续不再把所有 OPEN 混作同等级阻塞，而依 [`W71_RC_CLOSURE_LEDGER_2026-08-16.md`](./W71_RC_CLOSURE_LEDGER_2026-08-16.md) 分成 RC BLOCKER、CONDITIONAL GATE、ACTIVATION GATE 与 POST-W71 COMPLETENESS；常态预计四个宏观收口波次后进入新内容选择。
