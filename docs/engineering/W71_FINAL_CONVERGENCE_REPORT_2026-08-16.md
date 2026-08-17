# Mazz W71 Final Convergence 最终封板报告

> 日期：2026-08-16
>
> 最终决策：**SEAL — unsigned internal Windows RC**
>
> 产品源码冻结点：`main@e753dd0`
>
> 后续纪律：完整主义继续留在未尽总表并后移；本结论不授权 W63–W86 开工。

## 1. Executive Decision

W71 的推荐范围已经完成。当前 Mazz 可以冻结为首个可信的 Windows 内部 RC，而不需要把所有历史欠账、外部条件和远期完整主义先做完。

这个 `SEAL` 的含义严格受限：

- 当前主机、Windows x64、Electron 33.4.11、版本 `0.2.0` 的冻结产物通过；
- 正式入口、代表性数据路径、生命周期、真安装和发布物边界可复验；
- Preview、Hidden 和 Deferred 均有明确产品表达，不冒充正式能力；
- 这是未签名内部 RC，不是已经取得 SmartScreen 信誉的公开发行；
- 异机、真实硬件、完整 Session、全组合和长时 soak 不被伪称完成。

## 2. 冻结产物

| 产物 | 冻结值 |
|---|---:|
| installer | `133,676,213` bytes |
| installer SHA-256 | `69940814475FCF2C294EB280BC1A6AFF2755DFB2F28DDCCCA422BBA3D41A41FA` |
| win-unpacked | `565,148,574` bytes / 438 files |
| app.asar | `257,845,274` bytes / 9,483 entries |
| app.asar SHA-256 | `35961F6770A469DA0E2216BACDC7CC8EB588B93E5F10FD79C7AF63C363F312CC` |
| source map / FFmpeg core | `0 / 0` |
| unpacked native | 10 files / `2,625,024` bytes / win32-x64 |

三个独立复跑批次的前后哈希全部一致；机器清单见 [`W71_RC_THREE_RUN_MANIFEST.json`](./evidence/W71_RC_THREE_RUN_MANIFEST.json)。2026-08-17 又按 C4 原始要求补做了三份各自独立的严格证据包，详见 [`W71_C4_STRICT_EVIDENCE_CHECKPOINT_2026-08-17.md`](./W71_C4_STRICT_EVIDENCE_CHECKPOINT_2026-08-17.md)。

## 3. 三次独立复跑

每次都重新创建隔离 userData、workspace 和安装目录，并完成：

- `153/153` 全量自动测试；
- 正式入口成熟度、正式主路径、FFmpeg 发行边界、原生媒体边界；
- PTY、Panel、WebContentsView、watcher、P2P、Python、Viewer、Factory request、Monaco 的 20 轮 packaged 生命周期；
- ResourceLedger `2→2`；
- clean install、同版本 repair、五入口冷启动、UserChoice 不改写；
- 安装态 20 轮真运行、正常退出与 EXE 释放；
- silent uninstall 后安装目录、卸载注册、自有协议/ProgID/backup、快捷方式零产品残留；
- release audit 与当前树 secret audit。

结果：最终批次 `20260817T012752968Z-e991dc` 连续 `3/3 PASS`，每轮 `9/9` 命令、`11/11` 派生证据；冻结产物漂移 `0`，安装残留 `0`，UserChoice 改写 `0`，当前 secret 候选 `0`。三个单轮 manifest 与 33 份派生证据均有独立 SHA-256，并由聚合器逐文件复算通过。

## 4. 最终模块矩阵

| 模块 | Final Gate | 当前承诺 |
|---|---|---|
| Shell / 页签 / 多窗格 / 文件树 | SEAL | 代表性外改、迁移、崩溃与恢复路径封板 |
| Markdown / Text / DOCX | SEAL | 正式编辑、保存、失败保护和代表性往返 |
| Code / Terminal / DAP | SEAL | 当前 Windows Python DAP 与 PTY/Monaco 生命周期封板 |
| Sheet / XLSX | SEAL | 正式编辑与代表性 roundtrip；广泛语料后移 |
| Slide / PPTX | SEAL | 当前大纲/对象模型与导出边界封板 |
| Math | SEAL | 冻结现有能力，不扩展工具链 |
| Notes / Search / 当前笔记图谱 | SEAL | 保存/恢复竞态、owner 与正式入口封板 |
| Mindmap / Draw | SEAL | 代表性结构恢复与保存边界封板 |
| Library / Reader | SEAL | 创建、开书、返回、恢复、进度和 owner 封板 |
| Viewer / PDF / 原生音视频 | SEAL | 原生播放、图片/PDF、字幕和生命周期封板 |
| Browser / Native Surface | SEAL | 保留经验证 workaround，不做 SurfaceManager 重构 |
| Factory / W68 / AI Provider | SEAL | 产品自有请求、故障、取消、恢复与密钥边界封板 |
| LAN Sync / Share / Progress Relay | SEAL | 当前已落地主链；三方合并与广泛异机矩阵后移 |
| Themes / i18n / Activity / Panels | SEAL | 中心主题/入口/面板与代表性窄窗封板 |
| OCR / Vision | PREVIEW | 首次依赖、准确率、超时/取消矩阵未达 Formal |
| Recorder / Voice | PREVIEW | WebM 保留；真实设备/权限/长录制未穷举 |
| Plugins | PREVIEW | 哈希信任已落；完整权限/发布者生态未封板 |
| Archive | PREVIEW | 基础能力保留；密码包/大包/依赖矩阵未穷举 |
| W65 网络源 | PREVIEW | 仅 DMHY 族能力；不声称四站完成 |
| Mobile / Updater / W62e Feed | DEFER / HIDDEN | 实现保留，正式入口不暴露 |
| W66 Harness | INTERNAL | Foundation 保留；Vendor Adapter/UI 未过激活门 |
| FFmpeg 转码 / Player GIF / Recorder MP4 | DEFER / HIDDEN | 完整对应源码和持续源码交付闭环后再激活 |
| W63/W64/W69/W70/完整 W67/W72–W86 | DEFER | 完整保留到 Post-W71，需独立批准 |

## 5. Definition of Done

| 可测试标准 | 结果 |
|---|---|
| 正式范围已知 P0/P1 为 0 | PASS |
| 所有产品入口只有 Formal / Preview / Hidden 一种状态 | PASS |
| 全量测试三次 `153/153` | PASS |
| 正式 Electron 主路径与代表性数据错误态 | PASS |
| 20 轮核心资源生命周期回基线 | PASS |
| Windows 安装、同版本 repair、五入口、退出、卸载 | PASS |
| UserChoice 不改写，卸载零产品残留 | PASS |
| installer / asar / native / source map / notices 审计 | PASS |
| 当前发行许可阻塞清零 | PASS（FFmpeg core 不分发） |
| 当前产品树高置信 secret 候选为 0 | PASS |
| PARTIAL 全部明确为 Preview / Hidden / Internal | PASS |
| 三轮冻结 hash 不漂移 | PASS |

## 6. Known Limitations / 条件门

以下不推翻 `SEAL`，但阻止扩大对应承诺：

- 代码签名、SmartScreen 与公开发布信誉；
- 其它 Windows 版本、CPU、干净机、多用户和广泛 DPI/RDP/GPU；
- 摄像头、麦克风、屏幕采集与真实权限拒绝矩阵；
- 第三方 Provider 的真实账号、代理、限流和非标准 SSE；
- Explorer 用户主动默认应用选择后的完整 UX；
- `0.2.0` 之前开发构建的升级/降级；
- FFmpeg 转码运行时的完整 corresponding-source 交付。

发行物内的 [`KNOWN_LIMITATIONS.md`](../../KNOWN_LIMITATIONS.md) 是用户可见边界；完整工程账见 [`W71_RC_CLOSURE_LEDGER_2026-08-16.md`](./W71_RC_CLOSURE_LEDGER_2026-08-16.md)。

## 7. 完整主义没有被删除

完整 Session 拓扑、全模块全组合、全格式/编码/权限、LAN Sync 三方合并、4–8 小时以上 soak、SurfaceManager、Universal Asset Loader、完整 W67/Harness、W63–W86、Event/Episode/多父/World/Organization/`.maz` 等仍在《Mazz 当前未落地全景 · W71 归并版》中。它们从 W71 Hard Gate 后移，不等于取消。

历史 FFmpeg core 两个文件从当前分支删除；可从 `main@7fa4778` 恢复，但在完整对应源码与发行 Gate 通过前不得重新纳入产品或安装包。

## 8. 最终回答

Codex 已经在当前可验证边界内突破了过去 Electron / Windows / Native Surface 施工的主要限制：不是靠一次性重构，而是以 owner、ACK、ResourceLedger、真实 Windows 进程/安装器和冻结证据，把代表性主链收敛到了可长期低强度维护的内部 RC。

能达到的现实边界是“可信封板、诚实降级、可重复验收”，不是“所有平台、硬件、格式和未来架构数学意义上的 100%”。在这个边界内，W71 可以停止；下一步应从完整未尽总表重新选择新增内容，而不是继续无期限抛光本轮。
