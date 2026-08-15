# Mazz W71 Final Convergence / 封板式收敛施工规格

> 版本：v2.4
> 日期：2026-08-15
> 审计坐标：`main@7eb33387a976863bd2e0c434d19b1dfc0c760916`
> 决策：**GO WITH SCOPE REDUCTION**
> 状态：**IN PROGRESS / Wave 0 Census 与 Native Surface Ledger 检查点已落地**
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
6. 本次授权不扩大 W71，不批准 W63–W81，不允许删除既有 workaround，也不代表任何完整 Wave 已通过退出 Gate。
7. 首轮提交后维护者指令“继续推进”，按同一范围继续完成 Wave 0 Census 与 Native Surface Ledger；仍不构成 SurfaceManager、UI 大改或 Post-W71 功能授权。

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

---

## 4. 功能入口的最终处置

### 4.1 PARTIAL 模块

| 模块 | 最终分类 | W71 产品动作 |
|---|---|---|
| 移动壳 | 隐藏 | 保留代码和开发文档；没有可交付 native 工程前不设正式入口。 |
| Updater | 隐藏 | 当前只有 manifest check 且 TLS 不合格；不以正式更新能力呈现。 |
| W65 四站爬取 | Preview | 只呈现已实现的 DMHY 族能力，名称不得继续声称“四站完成”。 |
| W66 Agent Harness Integration（原 Kimi Code 整合） | Foundation 进入 W71；Vendor Adapter 分别定级 | 已落地 Provider、Terminal/Toolchain 只算前件；建立通用 Harness v1，并用至少两种真实执行器验证，不承诺全厂商覆盖。 |
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
| Agent Harness Foundation | PARTIAL LANDED / W71 in progress | Registry、Session lifecycle、Capability、统一事件/错误/interrupt/dispose、资源账本与主进程 IPC 已落；通用 UI 与真实 Adapter 待补 |
| Kimi Code Adapter | 待验证 | 作为第一真实执行器；通过自身 detect/probe/auth/capability 与生命周期 Gate 后单独定级 |
| Codex Adapter | 待评估/验证 | 作为第二真实执行器，证明公共协议跨厂商 |
| 其他 Agent Adapter | DEFER | 后续按 Adapter 增加，不是首个 Windows RC 的数量 KPI |

W71 不为此顺带建设 Task Capsule、SeatPackage、完整 Harness policy system 或 W70 Cognition。Harness v1 先消费现有 workspace、task instruction、selected files/context、Factory artifact 与 terminal/process。

#### 4.4.4 生命周期、安全与产品表达

Agent session 必须进入统一 resource ledger。关闭 Session、Tab、Workspace 或应用时，应能证明 child process、PTY、listener、stream、temp file 与 workspace handle 被清理，不得遗留 orphan process。

Agent 能编辑文件或执行命令，不能伪装成普通聊天 Provider。通用入口统一称“Agent / 执行器”，每个 Adapter 显示安装、版本、认证、capabilities、健康状态与运行状态。

#### 4.4.5 W66 Final Gate

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

未满足 Gate 的具体 Adapter 只能标记 Experimental；不因此把 Harness Foundation 错写成“Kimi 兼容层”。

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

以下全部满足，才允许将 W71 标记为 RC 完成。

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

- Browser、Panel、PTY、P2P、watcher、Viewer 各完成 20 次循环。
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

- 当前 125 个 Node 测试文件及 W71 新增测试 100% 通过。
- release E2E manifest 必跑场景在 packaged app 100% 通过。
- 主进程 uncaught、渲染 pageerror、非预期 render-process-gone 和未批准 console error 为 0。
- 每份结果记录 commit、Windows、Electron、GPU、DPI 和耗时。

## 8.8 Agent Harness

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

---

## 10. 新增 Root-Cause Debt

| Debt | Root Cause | W71 Strategy |
|---|---|---|
| Icon state debt | emoji/SVG/iconId 以及 create/restore/back/reopen 多真源 | IconRegistry + 单 iconId 真源 + 状态转换 E2E |
| Theme contract debt | 主题只覆盖颜色或部分 Surface | color/radius/type/spacing/icon/motion 等统一 Theme Contract |
| Layout debt | Shell/Sidebar/Module 缺明确剩余空间和退化协议 | Layout Contract + container-responsive + Responsive Levels |

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

W64、W69、W70，以及 Asset/Capability/Civilization、Relation Retrieval/Multi-parent、Workspace Event Ledger / 个人工作运行史等设计只保存摘要、权威来源和未来波次映射。W71 不复制其全文，也不把 Design Capsule 当仓库实现。

### D. Discussion-stage Candidates

人类多人 P2P 共看 / Room / chat / danmaku 与 W64 AI 陪看明确分离；Browser 逻辑系列整批 Harvest、厂花/产品人格层等继续标记 Discussion-stage。未冻结候选不得进入 RC 承诺。

### 13.1 W71 与 W72–W81 的硬边界

W72–W81 只是总表中的 Post-W71 分组：资产/能力、Factory 组织完形、统一导入与 Promotion、关系检索、多父级、Shadow Relation、多模态 Anchor、外部工具、文明模型，以及 Workspace Event Ledger / 个人工作运行史。它们没有获得开工授权。

W71 Wave 0 建 OSS 发布底账，不等于 W72 Capability Registry 已实施；W71 实施 W66 Harness Foundation，也不等于 W73 下一代 Factory、W79 Blender 或 W81 工作区事件流已进入范围。W71 中为了诊断而产生的日志和测试证据，也不得借名升级为 W81 运行时。

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

这些产物把未知范围变成了可重复事实，但完整 Wave 0 Gate 仍未通过：Torrent/watcher/worker/media 等资源尚未全部接账，37 个 native binary 尚未裁剪验证，ffmpeg 与 `buffers@0.1.1` 许可仍未闭环，签名/安装卸载矩阵仍缺，真实 Agent Adapter 仍为 0。

首轮结果与证据见 [`W71_THREE_HOUR_CHECKPOINT_2026-08-15.md`](./W71_THREE_HOUR_CHECKPOINT_2026-08-15.md)。

授权前的只读停止线已经解除。授权后仍禁止：

```text
升级依赖或 Electron
删除 workaround / legacy
夹带 W63–W81 功能施工
把微波完成冒充完整 Wave 退出
把 Foundation 冒充真实 Adapter 已扶正
```

每个检查点完成后必须回写完整未尽波次总表、记录测试/构建证据并提交，下一检查点继续按本规格 Gate 推进。
