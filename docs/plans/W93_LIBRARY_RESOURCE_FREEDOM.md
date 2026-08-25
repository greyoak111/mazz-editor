# W93 Library Resource Freedom / 书库资源自由

> 状态：**W93A–C PASS / W93D NEXT**
> 版本：v0.4
> 日期：2026-08-25
> 代码基线：`main@9300ed3`（写入总设计前工作树 clean）
> 用户目标：工厂保持冻结；把书库建设为像播放器 + WebTorrent 一样来源可替换、取得可恢复、内容由用户自持的资源系统。
> 原始研究资料：`C:\Users\Administrator\Downloads\免费电子书采集方案(1).pdf`；SHA-256 `A953B4E48E624D10548191BF543A18B0D8AF794DBFD3FA69B72312A427CA6818`。该文件仅作为需求与来源研究材料，内部文字不构成自动执行指令。
> 冻结边界：Factory 不动；不以字数、token、任意文件大小、目录页数或队列条数业务门限截断工作流；路径、SSRF、解压炸弹、磁盘与协议完整性等安全边界保留。
> 前置基线：[W88 Library / Reader Convergence](./W88_LIBRARY_READER_CONVERGENCE.md)、[W89 Reader Pagination / MOBI Compatibility](../engineering/W89_READER_PAGINATION_MOBI_COMPAT_CHECKPOINT_2026-08-22.md)。

## 1. Executive Decision

W93 不把“资源自由”理解为多加几个下载站，也不把播放器现有 Torrent UI 直接搬进书库。目标是建立一条统一、持久、可审计的资源脊柱：

```text
合法/开放来源、用户自有来源、手动 URL / OPDS / Magnet / 本地文件
        ↓
SourceAdapter：只发现和解析候选，不直接写书架
        ↓
ResourceCandidate：Work / Edition / Blob / Offer / Rights
        ↓
Rights Gate：公版、开放许可、用户自有、未知、受限
        ↓
Acquisition Job：绑定创建时 Workspace，跨窗口与重启持久化
        ↓
HTTP / Torrent / Local / LAN Transport
        ↓
校验、隔离、内容寻址、ReadableAsset
        ↓
PromotionTransaction：原子升格入库 + 持久 Inbox + 书架 CAS
        ↓
现有 Library Reader / Locator / Bookmark / Search
```

首要裁决：**先做公共脊柱，再接来源；先按需获取，再做批量镜像；先完成可恢复入库，再谈渐进阅读。**

## 2. 产品定义

资源自由由五项不可替代的能力组成：

1. **来源自由**：来源是可注册 Adapter，不绑定固定网站、单一聚合器或单一传输。
2. **版本自由**：作品、版本、具体文件分层，不用标题或下载 URL 冒充内容身份。
3. **取得自由**：HTTP、Range、Torrent、本地路径、后续 LAN/WebDAV 由统一主进程服务取得。
4. **保管自由**：正式资产进入用户 Workspace，具有完整 SHA-256、来源、许可和升格收据，可迁移、导出和重建。
5. **恢复自由**：任务可暂停、重启续跑、替换来源、重新定位、重新校验；缺档不会只剩一条失效绝对路径。

“自由”不包含：影子图书馆默认接入、验证码/登录绕过、DRM 破解、受控借阅规避、静默上传、隐瞒来源或许可证。

## 3. 当前基线与不可照搬项

### 3.1 可直接复用

- `LibraryImportService` 已有安全文件名、临时文件、`fsync`、排他发布、内容摘要、同名不覆盖和 receipt 补偿。
- `LibraryRepository` 已有 Workspace 分区、书架去重、双分区 journal/CAS、进度/书签/规则迁移。
- EPUB/CBZ/MOBI/AZW3/PDF/TXT 阅读链、HTML 清洗、sandbox/CSP、Locator、书签和有界已物化视口可继续使用。
- Player 已证明“来源检索与消费者解耦”“主进程任务 owner”“Range 消费端点”“缓存后升格”的产品形态。
- `torrent-site-network` 的礼貌访问、并发调度、缓存、瞬态重试和挑战停机可抽取思想；不得复制媒体站字段模型。

### 3.2 必须替换

- 现有“下载站”只是固定网页 + 一次性 `library:download` 事件；Library 未建立 owner 时可能漏消费。
- 普通书籍仍整本 Base64 进入 Renderer；TXT 32 MiB、其他 128 MiB 是当前实现架构上限，不是书籍业务规则。
- Torrent `jobs/torrents` 是内存 `Map`，绑定动态当前 Workspace，退出应用不能恢复；队列还有本地数量上限。
- Torrent 的动态 loopback URL 不是稳定内容身份，不能成为书籍 ID 或阅读进度键。
- 现有书架事实主要位于全局 settings 的 Workspace-hash 分区；实体迁移到另一台机器或换路径时不能仅凭 Workspace 自持文件重建完整目录。
- Browser 下载白名单声明 `.azw/.fb2`，Reader 实际不支持；来源层不得发布消费者不能兑现的格式。

### 3.3 安全前件

扩大书库网络入口前，必须完成并验证：

- `mazz-res://tor` 只代理当前 daemon 的精确 loopback host/port，不成为任意 HTTP 代理。
- 任何本地资源协议都以 WebContents capability 授权，不能把“知道绝对路径”等同于读取权限。
- Torrent 元数据路径经过 NUL、绝对路径、`..`、Windows 设备名/ADS 和最终 containment 校验。
- P2P 首次使用明确提示 IP 暴露、Tracker/DHT 与上传行为；默认不替用户盲补公共 Tracker。
- HTTP(S) 每次 redirect 都重新执行协议、DNS/IP、私网/localhost 与目标策略校验。

## 4. 冻结数据合同

### 4.1 Resource Candidate

Schema：`mazz.library-resource-candidate/v1`

```js
{
  candidateId,
  work: {
    workId, title, authors: [], languages: [], subjects: [],
    identifiers: { isbn: [], olid: [], ia: [], gutenberg: [], doi: [] }
  },
  editions: [{
    editionId, title, language, publisher, publishedAt,
    identifiers: {}, description
  }],
  offers: [{
    offerId, editionId, providerId, resourceId,
    format, transport, size, checksum, infoHash,
    sourceUrl, acquisitionRef, selectableFiles: []
  }],
  rights: {
    status,             // public-domain | open-license | user-owned | unknown | restricted
    licenseId, rightsStatement, jurisdiction,
    evidenceUrl, assertedBy, checkedAt, confidence
  },
  provenance: [{ providerId, resourceId, pageUrl, observedAt, adapterVersion }]
}
```

禁止在候选、任务、书架或证据中持久化 cookie、Authorization、API Key、签名下载 URL 的 secret 部分。

### 4.2 Strong Identity

- Work：权威作品 ID；无权威 ID 时使用来源命名空间 ID，禁止仅凭相似标题自动合并。
- Edition：ISBN、OLID edition、IA item、Gutenberg edition 等强 ID。
- Blob：完整 SHA-256；Torrent 可在取得前使用 BTIH 作为 transport identity，正式入库后仍补完整 SHA-256。
- Offer：`providerId + resourceId + format + transportIdentity`。
- Acquisition 幂等键：`workspaceIdentity + intentId + offerId/transportIdentity + sorted(selectedFiles)`。`intentId` 标识一次用户获取意图：同一 intent 的选档前/选档后请求 exactly-once，不同 intent 可从同一个多文件 Offer 再取另一册；最终 Blob/书架仍以完整 SHA-256 做跨 intent 内容去重。

跨来源自动合并只能依据 ISBN/OLID/IA/Gutenberg/DOI 映射、相同 BTIH 或相同完整哈希；标题/作者相似只做“可能同书”提示。

### 4.3 Acquisition Job

Schema：`mazz.library-acquisition-job/v1`

```js
{
  jobId, intentId, workspaceIdentity, workspacePath,
  candidateId, offerId, providerId,
  transport, transportIdentity, selectedFiles: [],
  rightsStatus, rightsReceipt: { decision, authority, evidenceRef, at },
  idempotencyKey, idempotencyAliases: [],
  state, retryFrom, bytes, error,
  integrity: { sha256, declaredChecksum, pieceVerified },
  stagingPath, finalPath, bookId,
  createdAt, updatedAt
}
```

状态机：

```text
discovered
  → resolving
  → awaiting-rights
  → inspecting
  → awaiting-selection
  → queued
  → downloading ↔ paused
  → verifying
  → materializing
  → awaiting-import
  → imported

任一非终态 → failed(retryFrom)
任一可取消态 → cancelled（只清理由该 job 持有的 staging）
```

“下载完成”不是业务完成。只有原子文件发布、书架 CAS 成功且 Inbox ack 后，状态才可成为 `imported`。

### 4.4 Workspace 持久事实

建议物理布局：

```text
<workspace>/书库/
  <managed books...>
  .resources/
    catalog.json
    acquisitions.json
    inbox.json
    staging/<jobId>/...
    quarantine/<jobId>/...
```

- 正式目录与任务事实属于创建时 Workspace，不能在任务运行中动态读取“当前 Workspace”。
- 全局 settings 只保留 UI 偏好、启用来源和不含 secret 的 source 配置引用。
- 任务文件使用临时文件 + `fsync` + 原子 replace；读损坏文件必须 fail-closed 并保留坏件证据。
- Catalog 可由资产 manifest 和实体扫描重建；用户复制 Workspace 后不应失去基本书架身份。

## 5. Source Adapter 合同

```text
descriptor()              稳定 providerId、版本、能力、政策说明
search(query, cursor)     只返回候选与下一游标，不直接下载或写书架
discover(cursor)          可选增量目录
resolve(resourceId)       取得 edition/offers/rights evidence
health()                  按需或低频，不因打开 Player/Library 自动探测所有来源
```

Adapter 必须：

- 使用可识别 User-Agent/contact，遵循官方速率和 `Retry-After`；默认串行/有界并发，不伪造人工会话。
- Cursor、checkpoint 和 ETag 可恢复；不得用固定页数、固定条目数静默截断目录。
- 失败只影响本来源；已取得候选保留 provenance，不用另一来源结果覆盖。
- 批量优先官方 dump/OPDS/OAI-PMH/镜像；网页与通用搜索只作线索，不自动授权二进制获取。
- 许可证是来源主张和证据，不是系统自动给出的法律结论；法域不明时保持 `unknown`。

## 6. 来源路线

### 首期正式入口

1. Project Gutenberg 官方目录/镜像/OPDS 或合规 robot harvest；主站不作批量页面爬虫。
2. 通用 OPDS 1/2；用户可接 Calibre、自有源或获得授权的第三方 feed。
3. 手动 HTTPS URL、现有 Browser 下载回收、本地文件。
4. 手动 Magnet/.torrent：先 inspect、默认不选文件，只允许用户选择受支持格式。

### 第二期 Adapter

- Open Library 低频发现 + 官方 dumps；Internet Archive 仅明确 public-domain/open-license 文件，跳过 controlled lending。
- DOAB/OAPEN/OpenStax；DOAB 只作开放元数据和链接，逐本读取实际许可。
- Wikisource API/dump；中文内容优先，但“页面集合 → 可阅读书籍”的装订是独立步骤。

### 后置或限定用途

- Standard Ebooks 当前 full ebook feed 不能假定为匿名公共基础设施；仅作为用户授权 OPDS/合作来源。
- LibriVox 音频进入 Player transport，再与 Edition 关联，不复制一套音频播放器。
- arXiv 进入独立论文 collection；CText 按账户/访问层级；HathiTrust/Google Books 默认只作元数据或授权链接。
- ManyBooks/Smashwords 在当前 robots/ToS 逐项复核前不启用。

官方政策坐标：

- Project Gutenberg robot access：<https://www.gutenberg.org/policy/robot_access.html>
- Project Gutenberg terms：<https://www.gutenberg.org/policy/terms_of_use.html>
- Open Library API / dumps：<https://openlibrary.org/developers/api> / <https://openlibrary.org/data>
- Standard Ebooks feeds：<https://standardebooks.org/feeds>
- Internet Archive metadata：<https://archive.org/developers/metadata-schema/index.html>
- MediaWiki API etiquette：<https://www.mediawiki.org/wiki/API%3AEtiquette/en>
- DOAB metadata：<https://www.doabooks.org/en/resources/metadata-harvesting-and-content-dissemination>
- LibriVox API：<https://librivox.org/api/info>

## 7. ReadableAsset 与内容边界

统一接口：

```text
stat()
readRange(start, end)
readEntry(path)
availability(range | entry)
materialize(destination)
cancel()
```

- PDF 第一阶段可直接使用 Range。
- EPUB/CBZ 当前解析器依赖完整 ZIP 字节；W93 前期完整下载后再打开，不冒充边下边读。
- 后续 Range-aware ZIP 先读取尾部 central directory，再按 entry 获取；必须保留 ZIP bomb、递归深度、路径和累计解压保护。
- MOBI/AZW3 后续可按 PalmDB record 偏移读取；首期仍完整 materialize。
- 不得以业务字数、token、章节数、固定目录页数或任意文件大小静默裁剪内容。
- 允许保留的门仅限：磁盘不足、地址/路径安全、容器炸弹、单 entry/累计解压资源、协议响应、用户取消和 Provider/来源明确失败；必须有可见错误与可恢复状态，不能静默少取。

## 8. 波次施工图

| 波次 | 目标 | 主要产物 | 退出门 |
|---|---|---|---|
| W93a · Contract & Durable Job Foundation · **PASS** | 冻结 Candidate/Rights/Job/Identity/格式、安全与持久任务合同 | [W93A 规格](../engineering/W93A_ACQUISITION_FOUNDATION_SPEC.md)、纯数据模块、schema normalizer、原子 job/inbox store、[检查点](../engineering/W93A_ACQUISITION_FOUNDATION_CHECKPOINT_2026-08-24.md) | 合同、roundtrip、损坏恢复、全量、build 全绿；无 secret；标题不误合；两轮独立审计 CLEAR |
| W93b · Main Transfer & Atomic Promotion · **PASS** | Workspace 绑定、流式 `materializePath`、Browser 下载持久回收、Inbox→书架 receipt | [W93B 规格](../engineering/W93B_STREAMING_ACQUISITION_SPEC.md)、主进程 service/IPC、path import、[检查点](../engineering/W93B_STREAMING_ACQUISITION_CHECKPOINT_2026-08-25.md)、[证据](../engineering/evidence/W93B_STREAMING_ACQUISITION.json) | Source + Packaged 离线真实 `DownloadItem`、Inbox→书架、双阶段退出 PASS；W93B 82/82、全量 266/266、build/dist/provenance/资源归零全绿 |
| W93c · Rights & Adapter Foundation · **PASS** | 注册 SourceAdapter 与权利判定，不接真实默认网络 | [W93C 规格](../engineering/W93C_RIGHTS_SOURCE_ADAPTER_SPEC.md)、registry、fixture adapter、rights receipt、[检查点](../engineering/W93C_RIGHTS_SOURCE_ADAPTER_CHECKPOINT_2026-08-25.md)、[证据](../engineering/evidence/W93C_RIGHTS_SOURCE_ADAPTER.json) | 默认离线；五态权利矩阵、57 页自然收敛、durable Job roundtrip、Source + Packaged 模块运行门通过；W93C 14/14、全量 267/267、build/dist/provenance/资源归零全绿 |
| W93d · First Source Pack & Federated Discovery | Gutenberg、通用 OPDS、手动 HTTPS URL；无固定页/条目裁剪 | `W93D_LIBRARY_SOURCE_PACK_SPEC`、分页/checkpoint/cache/聚合 | 官方协议 fixture、自然终止、部分来源失败、取消、脱敏全绿；显式 live 才联网；独立审计 CLEAR |
| W93e · Library Resource UI & Repair | 书库“资源”页、候选/版本/格式/许可/队列/修复；原子升格闭环 | `W93E_LIBRARY_RESOURCE_SURFACE_SPEC`、Resource Panel、Activity、shelf provenance | Source + Packaged E2E；未开书库/多窗/Workspace 切换 exactly-once；独立审计 CLEAR |
| W93f · Torrent Book Transport | Torrent inspect、选择性文件、持久恢复；协议、路径、Tracker 与 P2P 告知收紧 | `W93F_TORRENT_BOOK_TRANSPORT_SPEC`、Torrent adapter、ReadableAsset | 默认 deselect；恶意路径/私有 tracker/取消/重启/哈希错全绿；P2P 告知可见；独立审计 CLEAR |
| W93g · Portability & Convergence | Workspace catalog 重建、迁移/重新定位、PDF Range、缓存治理与发布级封板 | `W93G_LIBRARY_RESOURCE_CONVERGENCE_SPEC`、catalog rebuild、repair、GC | 拷贝 Workspace 可重建；缺档可换源；资源回线；Source/Packaged、全量、build、release/provenance；最终审计 CLEAR |

不允许为了“按时过波”把未完成项写成 PASS。若某子项需要拆分，必须先更新本文件并说明新边界，再施工。

## 9. 每波必查协议

每个波次严格执行同一顺序：

```text
实现冻结
  → Scope audit
  → Contract / unit tests
  → Adjacent regressions
  → Security / durability / privacy audit
  → Build
  → 独立只读复核
  → 修正并复跑
  → Wave checkpoint：CLEAR 或 HOLD
```

### 9.1 必查清单

1. **范围**：`git diff --name-only` 与本波文件表一致；Factory、无关 UI、无关协议未被顺带改写。
2. **无门限回归**：不得出现固定字数/token/maxTokens/目录页数/来源数/文件数/队列数造成的静默截断或工作流阻断。
3. **身份**：标题不作为强身份；Workspace、job、offer、Blob、bookId 不串。
4. **持久性**：所有外部副作用有 receipt；所有非终态可恢复；catch 不能遮蔽原始 I/O 错误。
5. **安全**：secret 不落证据；URL redirect、私网、路径 containment、压缩炸弹、内容魔数与 checksum fail-closed。
6. **权利**：P2P/HTTP 运输不得自动升级许可；restricted 不得获取；unknown 必须有用户权威决定。
7. **资源**：取消、关闭、切 Workspace、失败和重启后 owner/句柄/临时文件有明确归属。
8. **测试**：默认 `npm test` 不联网、不消费真实书源；每波必须执行 `node tests/run.js` 全量；live 测试必须显式 opt-in、隔离 Workspace、脱敏证据。
9. **构建**：`node --check`、定向合同、相邻回归、全量、`npm run build`、`git diff --check`。
10. **审计裁决**：独立 reviewer 明确 `CLEAR` 才进入下一波；发现 P0/P1 则 `HOLD`。

### 9.2 Wave Checkpoint 模板

每波在 `docs/engineering/` 新增或更新检查点，至少记录：

- 目标与实际改动文件；
- 关闭的根因与未关闭边界；
- 合同/回归/build 真实结果；
- 权利、隐私、网络和默认离线边界；
- 独立审计发现、修正与最终裁决；
- 下一波准入条件。

## 10. 离线验证矩阵

### Candidate / Identity

- 强 ID、BTIH、规范 URL 与 SHA 去重稳定。
- 同名不同版本不误合；同 Blob 多来源保留全部 provenance。
- cookie、token、签名 URL secret 和任意未知敏感字段拒绝持久化。

### Rights

- `public-domain/open-license/user-owned` 在凭证齐全时可进入队列。
- `unknown` 停在 `awaiting-rights`。
- `restricted` 不可进入 transport。
- 法域、来源主张与人工决定分别留痕，不把系统判断冒充法律意见。

### HTTP / Torrent

- Range、ETag、断点、后页/后段失败、取消与重启。
- 每次 redirect 重做 SSRF；私网/localhost/非 HTTPS 默认拒绝。
- Torrent 默认 deselect；仅选择支持格式；恶意 path、等量替换、新 Tracker 注入拒绝。
- 完整哈希或声明 checksum 不一致进入 quarantine，不能升格。

### Import / Inbox / Workspace

- 同名同内容复用、同名异内容不覆盖、并发 publication exactly-once。
- Library 从未打开时完成下载，之后仍能从 Inbox 拉回。
- event 重放、窗口重开、App 重启和 Workspace A/B/A 不重复、不串目录。
- 大文件只走 main path/stream，不产生 renderer Base64 副本。

### Reader / Recovery

- 首期六种正式支持格式均能由 Inbox 入架并打开。
- `.azw/.fb2` 在解析器落地前不对外声称支持。
- 缺档可重新定位或替换 Offer；不同 Blob 必须显式形成新版本/替换决定。
- PDF Range、EPUB/CBZ 完整 materialize 的能力边界如实显示。

## 11. Definition of Done

W93 只有在以下条件全部满足后才可封板：

- 用户可从至少三个不同类型入口发现/提交资源，不依赖固定网页菜单。
- Acquisition 任务跨窗口、重启和 Workspace 切换持久，所有副作用可追责。
- 大书不再由 Base64/Renderer 全量复制的架构门阻断。
- Work/Edition/Blob/Offer/Rights/Job 全链身份明确，书架可显示并导出 provenance。
- HTTP 与 Torrent 只承担运输，不篡改或推断许可。
- Workspace 复制后可从持久 catalog/manifest 重建基本书架并重新绑定进度。
- Source 与 Packaged 的资源获取、入库、打开、暂停/恢复、崩溃恢复与安全矩阵通过。
- 默认测试零真实网络；任何 live 证据显式 opt-in、隔离、脱敏。
- 全量测试、build、release/provenance 与独立最终审查均 CLEAR。

完成 W93 不等于：全球版权状态已被法律验证、所有 EPUB/MOBI/PDF 都兼容、所有公开目录都可无限抓取、WebTorrent 可在普通网页运行、DRM/受控借阅已支持，或公共资源发布网络已经完成。
