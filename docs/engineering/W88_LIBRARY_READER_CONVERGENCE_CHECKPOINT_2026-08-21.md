# W88 Library / Reader Convergence / 书库与阅读器收敛检查点

> 日期：2026-08-21
> 状态：**CURRENT / PASS；W88 EXECUTED SCOPE RESEALED**
> 基线坐标：`main@aa178f5`；W88 实现与证据位于当前未提交工作树，证据如实记录 `dirty: true`
> 运行口径：Windows 10 / Electron 33.4.11；SOURCE + `release/win-unpacked`
> 自动化口径：合同/单元/回归 + Electron/Playwright E2E；Computer Use 被禁用且未使用，本检查点不把 Playwright 输入冒充物理 Win32 输入

## 1. Executive Decision

W88 在本文件列出的执行范围内达到 **RESEALED**。它关闭的不是“再多支持几种电子书格式”，而是旧书库最妨碍长期使用的五类根因：Workspace 数据串写、异步开书 owner 竞态、无界 decoded/materialized viewport、书架线性 DOM，以及 host/iframe 输入和 locator/appearance 混仓；同时重新封住跨窗交接与整窗关闭的耐久 owner 边界。

最终结论由同一工作树上的双态证据和发布门共同支撑：

```text
full test files                             PASS 247/247（补登记既存 W87 Browser composition contract）
build                                       PASS
library residency SOURCE / PACKAGED         PASS 6/6 / PASS 6/6
library experience SOURCE / PACKAGED        PASS 8/8 / PASS 8/8
runtime errors across four tracked E2Es      0
packaged window handoff                     PASS 20 rounds / 42 transfers
handoff phase probes / commands             PASS 134 / 134 · PASS 43 / 43
stable resources                            2 → 3 → 2
release / provenance / secrets               PASS / CURRENT / PASS
renderer bundle SHA-256                      f8029974e094fb4db980b7e3fabe41afc56754dae9e2399dd18a08c2d1b2c833
```

这不是完整 Neat Reader 或 NeeView 的功能、格式兼容、无障碍及交互等价声明。维护者提到的“nanview”在本轮按 **NeeView** 处理，只是基于漫画/压缩包、双页、预读、缩放和命令模型的高置信推断，不冒充原名已得到确认。

## 2. 关闭的根因

### 2.1 事实、位置与外观重新分权

- `LibraryRepository` 以 Workspace 为物理命名空间，书架、分类、进度和书签不再依赖全局 key。
- `LibraryLocatorStore` 保存位置/证据投影，`ReaderPreferencesStore` 只保存外观；切书与重开不会拿字号、主题去污染 locator。
- 封面持久化只接受稳定资源；session `blob:` 只属于当前 owner，不能写进长期书架记录。
- 下载自动入库由单一 coordinator 持有，多个 Library 页签不再各自重复消费同一事件。

### 2.2 开书从“先改共享状态”改为候选事务

`openBook()` 现在遵循：

```text
parse candidate concurrently
        ↓
serialize commit / flush / install / show
        ↓ success
release previous owner

        ↓ failure or stale generation
close candidate → restore last healthy owner
```

候选在成功渲染前不能成为 current；过期 load generation/epoch 不能迟到复活。页签关闭、模块 detach 和应用关闭等待异步释放/flush，主进程退出超时只是保险，不冒充持久化成功。

### 2.3 资源驻留与总书长解耦

- EPUB 分页和滚动都只保留当前邻域；章节图片 URL 随窗口退出而撤销。
- CBZ 使用有界 ComicViewport，不再一次解压、缓存并挂载整本漫画。
- 返回书架、换书、失败开书、关签与应用退出收敛到幂等 owner 释放口。

最终双态实测：100 章 EPUB 的 text resident / DOM chapter max 均为 `3`，loaded max 为 `5`、live URL max 为 `6`，合成 resident 门的观测最大值为 `7`、等于门限 `7`；300 页 CBZ decoded/materialized resident/cache max 为 `6`，等于门限 `6`。两种格式返回书架后 iframe、resident/cache 和 live blob URL 均归零。

这里的 bounded residency **只指 decoded/materialized viewport**，不是压缩源字节随机访问。当前受支持 EPUB/CBZ/ZIP 在 `≤128 MiB` 包络内仍整包读入 renderer，超过上限拒绝；按需 range/random-access archive adapter 尚未实现，不能拿 viewport 数字外推成“整源内存也与书长无关”。

### 2.4 大书架成为投影，不再等于全量 DOM

ShelfViewModel 统一搜索、排序、分类/格式、收藏、缺失源和进度投影；ShelfView 只渲染可视窗口与 overscan。1,000 条 workspace 书架在 Source 与 Packaged 的首屏和远端滚动均只保留 `40` 张卡片，门限为 `96`。

深层虚拟书架的 ResizeObserver 不再拿旧行号重算新列数。合同在 `book-640` 处验证 `8 → 4 → 8` 列变化，以 stable key + viewport offset 复原首个可见项，并保留聚焦卡片；`focusKey()` 还能把虚拟窗口外的 stable key 重新 materialize 后聚焦。

进度取全书 locator：E2E 中目标书显示 `62%`，不会错误退化成按章序计算的 `17%`。10k 书当前只通过 model/contract 证明窗口复杂度有界，没有运行 10k 真实 Electron 场景。

### 2.5 Reader 输入与漫画 spread 变为显式协议

- `ReaderInputController` 将 host 与 sandbox iframe 统一映射为语义命令，避免两套漂移的快捷键实现。
- `SpreadPlanner` 显式处理封面单页、奇数尾页、配对偏移、宽跨页和 RTL，不再机械地把 `(n,n+1)` 当作所有双页。
- 字号、行高、字体、页宽、主题、模式、方向、漫画缩放及 spread 外观可以重开恢复。

Packaged `PageDown` 曾暴露产品焦点交接不明确：Enter 开书后如果仍由已隐藏书卡持有焦点，方向键会留在宿主而不是进入阅读 frame。最终实现由产品在 candidate 提交并首帧 ready 后自动把焦点交给阅读器；测试不调用 frame/body 的 `focus()`，而是先证明焦点自然到达 `IFRAME → BODY`，再从顶层 Playwright keyboard 发送 `PageDown`，并由 frame capture probe 记录：

```text
key       PageDown
count     1
target    BODY
chapter   1 → 2
```

产品还会在用户把焦点移到目录等阅读工具栏控件后取消迟到的 focus retry，双 RAF 加 `360ms` 后焦点仍留在按钮；Back 返回书架时，以 stable key 重新 materialize 并聚焦原虚拟书卡，除非用户已经明确选择了别的书架控件。

最终 Source/Packaged 各自一次权威 `8/8`，并以相同 locator、焦点和 cleanup 断言通过。该输入门不扩张为物理键盘、触控或辅助技术结论。

### 2.6 连续滚动 Locator 与缺失源语义不再含混

- 连续阅读在离开当前模式前先抓取 outgoing locator，以稳定 `sectionId/spineItemId + section-relative ratio + overall progression` 保存；原始 `scrollTop` 只作同版调试 fallback，不充当跨布局身份。
- Source 与 Packaged experience 的 seeded、`scroll → single → scroll` 模式往返及返回书架后重开三态完全一致：`section=2`、`sectionId=chapter-03`、`ratio=0.44866`、`progression=0.61216`、`scrollTop=1368.8`；误差门仍为 `0.03`。
- “源文件缺失”只接受明确 `ENOENT`（或无矛盾错误码的显式 `exists:false`）。`EACCES`、`EPERM`、桥失败和损坏解析都不能把书目误标 missing；成功重开会清除历史 missing 状态。主进程 `fs:stat` 保留 OS error code，renderer 才能做这一分类。

### 2.7 跨窗交接 3PC 与整窗关闭 2PC

跨窗口标签移动不再是“目标收到就删源”。现行三阶段协议的精确边界是：源 owner 先冻结并从实时实例取得严格快照；目标按同一一次性 `transferId` 建立 provisional/inert owner 并 ACK `prepare`；源通过 `beforeClose`、snapshot/progress durability 与 detach 后才允许目标 `commit`；最终 owner snapshot 精确封印后发送 `finalize`。finalize ACK 丢失只能幂等重询，不能复制 owner。重复文件、目标销毁或阶段 NACK 必须保留源和目标原状态。

Packaged 真运行完成 `20` 轮、`42` 次成功 transfer，`134/134` 阶段探针与 `43/43` command 全 PASS，资源账稳定 `2→3→2`；循环 command `185–431ms`，平均 `251.6ms`，首次创建子窗 `3240ms`。重复文件 NACK 后双方原状态不变，最终只有一个 live owner 和一个 recovery snapshot。此前一次看似“3PC 卡死”的运行，根因是 E2E 把瞬态 `agent-cli-process` 计入稳定资源，同时 dirty 测试标签在 teardown 打开未保存模态框；修复的是 runner 的稳定资源过滤、逐阶段超时和有界清理，不是把产品协议降级。

整窗关闭使用保存/不保存/取消的相同用户语义，但在内部执行两阶段耐久提交。第一阶段冻结 owner 集，依次完成 `beforeClose`、`modules.prepareAll()`、严格 snapshot 和阅读进度 `flushAll()`；任何取消、owner 变化或耐久失败都调用 `abortPrepared()`，恢复窗口交互。第二阶段只有在所有可失败门均成功后才 `commitPrepared()` 一次性拆除 owner 并收尸。活 renderer 即使超过提示阈值也保持窗口并继续等待，不能把 timeout 当成功；只有 renderer 已销毁才允许 `renderer-gone` 旁路。

## 3. 最终证据矩阵

| 证据 | 结论 |
|---|---|
| [`W88_LIBRARY_RESIDENCY_SOURCE.json`](./evidence/W88_LIBRARY_RESIDENCY_SOURCE.json) | `mazz.w88-library-residency/v1`；`6/6`；100 章 EPUB 与 300 页 CBZ bounded；A/B/A fingerprint 稳定；back 后归零；runtime error 0 |
| [`W88_LIBRARY_RESIDENCY_PACKAGED.json`](./evidence/W88_LIBRARY_RESIDENCY_PACKAGED.json) | `6/6`；相同 residency、owner 释放与指纹门在真实 `release/win-unpacked` PASS；runtime error 0 |
| [`W88_LIBRARY_EXPERIENCE_SOURCE.json`](./evidence/W88_LIBRARY_EXPERIENCE_SOURCE.json) | `mazz.w88-library-experience/v1`；`8/8`；1,000 书、virtual DOM、查询投影、自动焦点、连续 locator、偏好和 cleanup PASS |
| [`W88_LIBRARY_EXPERIENCE_PACKAGED.json`](./evidence/W88_LIBRARY_EXPERIENCE_PACKAGED.json) | `8/8`；相同 experience 门在 packaged PASS；`PageDown` probe=`count=1 / BODY`，toolbar 不被迟到抢焦点，Back 恢复 stable book card；runtime error 0 |
| [`W88_LIBRARY_EXPERIENCE_SOURCE.png`](./evidence/W88_LIBRARY_EXPERIENCE_SOURCE.png) | Source 1,000 书虚拟书架与阅读偏好回程的视觉证据 |
| [`W88_LIBRARY_EXPERIENCE_PACKAGED.png`](./evidence/W88_LIBRARY_EXPERIENCE_PACKAGED.png) | Packaged 同路径视觉证据 |
| [`W71_WINDOW_HANDOFF_RUNTIME.json`](./evidence/W71_WINDOW_HANDOFF_RUNTIME.json) | 最终 packaged 20 轮/42 transfer；134 phase + 43 command PASS；唯一 owner/snapshot、重复文件 NACK 与 `2→3→2` 资源账 |

### 3.1 Residency 数字

| 场景 | Source | Packaged | Final Gate |
|---|---:|---:|---:|
| EPUB fixture | 100 章 | 100 章 | 固定 |
| EPUB text resident / DOM chapter max | 3 / 3 | 3 / 3 | ≤ 3 / ≤ 3 |
| EPUB actual loaded / live URL max | 5 / 6 | 5 / 6 | composite resident ≤ 7 |
| EPUB back 后 iframe/cache/live URL | 0 | 0 | 0 |
| CBZ fixture | 300 页 | 300 页 | 固定 |
| CBZ resident/cache max | 6 | 6 | ≤ 6 |
| CBZ back 后 viewport/cache/live URL | 0 | 0 | 0 |
| A→B→A 指纹 | A1 = A2，且 A ≠ B | A1 = A2，且 A ≠ B | 稳定且分离 |

### 3.2 Experience 数字

| 场景 | Source | Packaged | Final Gate |
|---|---:|---:|---:|
| Workspace shelf records | 1,000 | 1,000 | 1,000 |
| 首屏 actual DOM | 40 | 40 | ≤ 96 |
| 远端滚动 actual DOM | 40 | 40 | ≤ 96 |
| 深层 resize 合同 | `book-640`，8→4→8 stable key/offset/focus | 同一产品合同 | stable key 不跳 |
| 全书进度 / 旧章序比 | 62% / 17% | 62% / 17% | 必须使用 62% |
| 自动焦点 + iframe PageDown | Enter 后自然 `IFRAME→BODY`；chapter 1→2；probe 1/BODY | Enter 后自然 `IFRAME→BODY`；chapter 1→2；probe 1/BODY | 无测试强制 focus；单次命令/导航 |
| toolbar 焦点 | 双 RAF + 360ms 后仍为目录按钮 | 同左 | 迟到 retry 不抢焦点 |
| 连续滚动 locator | seeded / modeRoundTrip / reopened 均为 `chapter-03`、section 2、ratio `0.44866`、progression `0.61216`、scrollTop `1368.8` | 同左 | 同 section；误差 ≤0.03 |
| 返回书架 | frame 0；active owner null；原虚拟书卡获焦 | 同左 | owner 退役 + stable focus restore |
| runtime errors | 0 | 0 | 0 |

## 4. 回归、构建与发布账

最终工作树执行结果：

```text
node tests/run.js                 PASS 247/247 test files
npm run build                     PASS
source residency E2E             PASS 6 / 6
packaged residency E2E           PASS 6 / 6
source experience E2E            PASS 8 / 8
packaged experience E2E          PASS 8 / 8
packaged window handoff E2E      PASS 20 rounds / 42 transfers；134 phase / 43 command PASS
npm run audit:release             PASS
npm run audit:provenance          CURRENT
npm run audit:secrets             PASS
```

四份跟踪 E2E 的 renderer/main runtime error 总数为 `0`。审计 PASS 的准确含义是：当前构建产物边界、声明的依赖/provenance 账和 secrets 扫描门没有阻断；它不自动证明所有历史提交、所有用户书籍或未来引入的第三方 Adapter。

独立总入口审计发现既存 `tests/contract/w87-browser-composition.test.mjs` 过去未登记到 `tests/run.js`；单跑 `6/6` 后已补登记，最终 `247/247` 才是当前全量，不再沿用漏项水位。

最终 renderer bundle SHA-256=`f8029974e094fb4db980b7e3fabe41afc56754dae9e2399dd18a08c2d1b2c833`。Packaged 强绑定同时验证 `release/win-unpacked/resources/app.asar` SHA-256=`76a626425f305590216653f9f6f341fae652de85da494e5feab18bf62d0c76c3`，其中内嵌 renderer bundle SHA-256 仍为 `f8029974e094fb4db980b7e3fabe41afc56754dae9e2399dd18a08c2d1b2c833`，不拿工作树 bundle 代替 packaged 内容。当前 Windows 发布 specimen 已随最终代码重建：`release/Mazz Editor Setup 0.2.0.exe` 为 `134,147,142` bytes，SHA-256=`878bbd97b9a3bad12da8f817fdd933614ae223210826f469960e9a37bf94d5ab`；`release/Mazz Editor Setup 0.2.0.exe.blockmap` 为 `138,840` bytes，SHA-256=`d9a97c5a22e62a4776ec99d2487858091b8e1463e649349a8aacc3dfad79ba10`；`release/win-unpacked/Mazz Editor.exe` 为 `188,784,128` bytes，SHA-256=`9abce0f64882d7983364cc0ad266d3106a6a5d41289c5e770a83f9efb3a770bd`。它仍是未签名内部 Windows specimen，代码签名继续属于外部 Gate。

## 5. OSS 研究、许可与实现边界

W88 的拿来主义原则是吸收行为、协议和验收方法，不做 UI 仿制或来源不明的源码搬运。

| 项目 | 许可/固定研究坐标 | W88 裁决 |
|---|---|---|
| [NeeView](https://github.com/neelabo/NeeView) | MIT；46.3 / `686a43362dc4b3c9f2ea014240dbba2d0e9fbcaa` | 借鉴 spread、预读、命令与页就绪行为；原创 JS 实现 |
| [Readium CSS](https://github.com/readium/css) | BSD-3-Clause；v2.0.5 / `ffd817b73601818c4775c14c1f21fc18e8c75e69` | 后续固定版本 Adapter 候选；只面向 reflow EPUB |
| [Readium Web](https://github.com/readium/web) / [TS Toolkit](https://github.com/readium/ts-toolkit) | BSD-3-Clause；packages 必须成组锁定 | 只作长期 Publication/Navigator 分层候选，本波不换核 |
| [Thorium Reader](https://github.com/edrlab/thorium-reader) | BSD-3-Clause；v3.4.0 / `474491641d7a8051edfcbb7127b148092c2e2252` | 参考 Electron 隔离、书库/阅读器边界与验收 |
| [foliate-js](https://github.com/johnfactotum/foliate-js) | MIT；`78914aef4466eb960965702401634c2cb348e9b1`；无稳定 release | 只允许 pinned commit + Adapter + CSP 双轨 PoC |
| [epub.js](https://github.com/futurepress/epub.js) | 官方 package 声明 BSD-2-Clause；GitHub License API 为 `NOASSERTION`；v0.3.88 / `a1e77b745ba3d0ba122d70d276a08afe44270d17` | 老生态行为参考；两种元数据都如实保留，禁止把 `NOASSERTION` 写成“无许可证”，也禁止 caret/branch 漂移 |
| [Komga](https://github.com/gotson/komga) | MIT；v1.26.3 / `4cabeb8abd05ddfff473a8f850a3c33c8f9e9aa1` | 后续 Scan/Analyze/Metadata 分阶段入库参考 |
| [Readest](https://github.com/readest/readest) | AGPL-3.0-or-later | 只观察行为与测试；禁止复制代码、CSS、资产或近似翻译 |
| [Koodo](https://github.com/koodo-reader/koodo-reader) / [KOReader](https://github.com/koreader/koreader) / [Kavita](https://github.com/Kareadita/Kavita) | AGPL/GPL 系；各自仍须逐项目锁定精确版本与许可证据 | 只观察行为与测试；禁止复制代码、CSS、资产或近似翻译 |

准确声明：**W88 本轮未引入上述第三方运行时依赖，也未 vendor/import 上述项目源码。** `package.json` / lockfile 在 W88 没有因此增加依赖。Komga 的研究坐标是 tag `1.26.3`；epub.js 同时保留官方 package 的 BSD-2-Clause 声明和 License API `NOASSERTION`，不把二者互相抹平。该声明只覆盖 W88 增量，不扩大为全历史法证或“整个历史书库从未含有相似实现”的保证；历史来源卫生仍按独立 provenance 流程处理。

Readium 后续 PoC 必须成组锁定候选 packages：`navigator@2.8.2` / `893a5cc362605ad19f1be1d905159c1b7282c68d`、`decorator@1.0.2` / `1faa458ffafb9d3746478edad8829261e179a412`、`shared@2.4.0`、`navigator-html-injectables@2.6.3` / `1a859b4a7276a13dcbf2d9c4795d411d97e4b23b`。单包漂移不在允许边界内。

## 6. 条件边界

以下项目没有被 W88 的 `RESEALED` 吞并：

1. 完整 EPUB3 Fixed Layout、Media Overlay、嵌套 NAV/NCX、publisher CSS 保真与规范 CFI。
2. CBR/7z、ComicInfo.xml、自动裁边、旋转、色彩/锐化、放大镜与多显示器全屏。
3. Highlight/Annotation/Search 的统一 CanonicalLocator、OPDS、本地词典与 TTS。
4. Readium CSS/Web 或 foliate-js 的真实产品 Adapter；它们只能经独立 PoC、CSP、许可、性能和回滚门进入。
5. 屏幕阅读器、真实物理键鼠/触控、广谱 malformed EPUB/CBZ、真实大藏书迁移、跨机 DPI/GPU 与长时间 soak。
6. 10k 书真实 Electron E2E；本轮是 10k model/contract 与 1k Source/Packaged Electron E2E。
7. Neat Reader / NeeView 的全部功能、格式兼容、云服务、DRM、商店或界面等价。
8. 大于 `128 MiB` 的压缩源与按需 range/random-access archive 读取；本轮只封 decoded/materialized viewport resident set。

这些边界是后续候选，不是把半成品入口留在正式主链。当前正式入口只由已通过的执行范围背书。

## 7. Final Gate 与复开条件

W88 最终状态：

```text
W88a–f EXECUTED SCOPE RESEALED
```

后续修改只要触碰下列任一边界，就必须至少重跑对应 Source + Packaged 门，不能沿用旧 JSON 冒充 CURRENT：

- EPUB/CBZ cache、viewport、blob URL 或预取窗口；
- `openBook` candidate/commit/rollback、Repository Workspace key 或 locator flush；
- ShelfViewModel、虚拟窗口、进度投影或书架 DOM；
- Reader host/iframe focus、键盘映射、navigation queue 或 appearance restore；
- SpreadPlanner 的 cover/parity/wide/RTL；
- 页签/模块/应用关闭的异步 detach 与主进程 close handshake；
- 跨窗 `prepare/commit/finalize`、strict snapshot owner、幂等 ACK 或整窗 `prepareAll/commitPrepared/abortPrepared`；
- 打包依赖、第三方 Reader Adapter、CSP、license/NOTICE 或发布边界。

只有重新得到 bounded decoded/materialized residency、owner cleanup、1,000 书 experience、输入单次投递、跨窗唯一 owner/snapshot、整窗耐久关闭、runtime error 0、全量回归与发布审计，才能再次写 `RESEALED`。
