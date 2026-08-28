# W94G World + MazzHub Public Plane 施工参照

> 状态：**W94Ga PASS / W94Gb PASS_WITH_SCOPE / W94Gc PASS_WITH_SCOPE**
> 日期：2026-08-28
> 上位参照：[W94 Unified Capability, Artifact & Public Plane](../plans/W94_UNIFIED_CAPABILITY_ARTIFACT_AND_PUBLIC_PLANE.md)
> 产品真源：[W69 MazzHub Local-first Content Network](../plans/W69_MAZZHUB_LOCAL_FIRST_CONTENT_NETWORK.md)
> 资产真源：[W84 `.maz` Production Asset Standard](../plans/W84_MAZ_PRODUCTION_ASSET_STANDARD.md)

## 0. 这份文档解决什么问题

W94G 不是把本地 Workspace 直接“同步到云端”，也不是先做一个带排行榜的网页壳。它负责把两条已经在 W69 中冻结、但当前仓库尚未贯通的边界拆开施工：

1. 本地 World：可持久化、可分支、可审阅、可合并的创作上下文；
2. Hub Public Projection：只有拿到显式 Publication Grant 的公开投影、内容寻址 manifest、撤回和重新同步。

本波不把 Hub 变成本地真相，不上传草稿、私有 World、Agent transcript、Workspace 路径、私钥、未发布 Rights 或运行实例；不以 DNS、反向代理、一个 HTTP 200 或一个榜单页面冒充公共面完成。

## 1. 已知现状与复用边界

| 现有能力 | 本波复用方式 | 禁止的误读 |
| --- | --- | --- |
| `main/foundation/branch-effective-state.js`、`main/branch-effective-state-service.js` | 复用 branch identity、revision、fact、resolution 和 sourceRefs 语义 | 不另造一套“最后写入即 Canon”状态 |
| `main/workspace-event-service.js` | World mutation 记录为 workspace event，保留顺序、来源和可恢复游标 | 不把 UI 当前值当历史 |
| W84 `maz-production-asset.js` | `.maz` inspect-only、manifest/index/hash/signature/rights 分层 | 不因签名自动授予执行或发布权 |
| W94A Capability/Receipt/Artifact | Publication Grant 与上传/撤回均挂 capability、receipt、artifact lineage | 不在 Hub 端执行本地 workflow |
| W74c `promotion-ledger.js` | 可复用 human authority / revoke / projection 的审计原则 | 不把 conversation promotion ledger 冒充 Publication store |
| W69/W83/W94F | Publication、World、Event Feed、Player transport 分层 | 不把 Comment/Danmaku/Watch Room 混成 World Canon |

服务器、DNS、TLS、反向代理、生产账号和公开域名均属于后置 staging/prod 运行门；本地 fixture 通过不能替代真实服务器证据。当前 staging origin 已部署并通过 HTTPS health/snapshot 验证，但保持 `MAZZ_HUB_PUBLIC_EFFECT=0`，不产生公网发布写入。

## 2. W94G 的冻结对象

### 2.1 World 与 Branch

World 是可选创作上下文，不是所有 Publication 的强制父级。World 至少包含以下可寻址对象：

```text
worldId
worldVersion
canonHead
branchId
baseCanonVersion
forkPoint
contextRefs
lockedFacts
timeline
characters
locations
institutions
relations
rules
provenance
```

具体字段允许按领域扩展，但必须满足：

- `worldId`、`branchId`、`canonVersion` 是逻辑身份，不能由 URL、文件路径或标题代替；
- Canon、Branch、Proposal、Review、Merge 都是独立事实，不能写进一个不可解释的 metadata JSON；
- branch 的 fork 不修改 Root Canon；热门、播放量、AI 排名和 Factory Pass 都不自动成为 Canon；
- 只有 Root Authority 可推进 Canon Head；Derivative/Community Branch 只能提交 Proposal 或拥有自身 Branch Authority；
- simulation 结果只能作为带 Artifact/Receipt 的 proposal evidence，不能直接改 Canon。

### 2.2 Canon Proposal / Review / Merge

最小 proposal 结构：

```text
canonProposalId
worldId
branchId
baseCanonVersion
forkPoint
changes[]
evidenceRefs[]
proposedBy
proposedAt
status: proposed | under-review | accepted | rejected | withdrawn
```

Review 必须记录 reviewer、authority、reason、decisionAt 和 evidenceRefs。Merge 是语义 cherry-pick：只采纳被点名的 fact/timeline/relation，保留未采纳 Branch 与完整 provenance；冲突或缺证据时返回 `resolutionRequired`，不得静默选择。

### 2.3 Publication Public Envelope

W94G 首轮只冻结 metadata-only/public-envelope，不上传任意本地字节：

```text
schema: mazz.publication-envelope/v1
publicationId
workId
creatorId
editionType
version
title
summary
visibility: public | unlisted | withdrawn
worldRef?                # 仅公开 World 引用，不是私有 World 快照
contentManifestRef
contentIds[]
licenseRef
provenance
publicationGrantRef
signatureRef
createdAt
publishedAt?
withdrawnAt?
```

不变量：

1. `publicationId != URL`；同一 Publication 可以由多个 Hub、个人站、NAS 或 P2P 节点引用；
2. Hub 只接收显式 grant 覆盖的字段和 content IDs，不能从 Workspace 扫描出“应该公开”的内容；
3. `summary/title` 是公开正文边界，草稿、Agent transcript、绝对路径、凭据、私钥和未发布 Rights 一律拒绝；
4. content manifest 只描述 content-addressed block、media type、size、hash、加密状态和来源能力，不把 Hub URL 当内容身份；
5. `withdrawn` 只撤回公共投影和缓存授权，不删除用户本地合法资产，不伪造内容已经物理消失。

### 2.4 Publication Grant / Receipt

没有 Grant 不能产生 publication 投影，也不能调用 Hub publish。Grant 至少绑定：

```text
grantId
publicationId
subjectId
scope[]
authorityRef: human:*
sourceArtifactRefs[]
rightsRef
issuedAt
expiresAt?
status: active | revoked | expired
```

Publication Receipt 记录一次幂等 publish/withdraw 的命令 hash、投影 digest、Hub endpoint identity（若有）、状态和可重放证据。网络失败不能被解释成发布成功；重放同一 command 必须得到同一 outcome 或可解释的冲突。

## 3. 本地 World Store 首个施工切片（W94Ga）

W94Ga 只做本地确定性运行时，不接公网：

1. 在 Workspace `.mazz/world/` 建立物理目录、schema version、event log、snapshot、recovery；
2. create/fork/propose/review/merge/withdraw 都经过严格字段校验、revision/CAS 和 workspace identity；
3. 复用 W94E branch effective-state 计算，不复制其冲突语义；
4. 任何 simulation 或 Factory 结果只能通过 artifact/receipt ref 进入 proposal；
5. restart、corrupt tail、旧 schema 和 Workspace A/B 必须有可观测、可恢复或明确拒绝的结果；
6. World snapshot 对外只返回 public-safe projection，禁止返回绝对路径、密钥、原始 prompt、私有正文和网络定位器。

W94Ga 退出条件：Source/Packaged 各跑一遍 create → fork → proposal → review → partial merge → restart；Root Canon、Community Branch、未采纳事实、冲突和 sourceRefs 均保持可解释。

W94Ga 已完成并通过：`main/world-runtime-service.js` 持久化 `.mazz/world/store.json`，复用
`BranchEffectiveStateService` 的 branch/revision/effective-state 语义，主进程与 preload 只暴露
`world:*` 窄 IPC。Source/Packaged 均完成 create → fork → proposal → human review → partial
Canon merge → Workspace A/B → close/reopen；两份证据的 `runtimeErrors=[]`、网络调用为 0、
重启后 World/Proposal 可恢复、活动外部进程为 0：

- [`W94GA_WORLD_SOURCE.json`](./evidence/W94GA_WORLD_SOURCE.json) · [`W94GA_WORLD_SOURCE.png`](./evidence/W94GA_WORLD_SOURCE.png)
- [`W94GA_WORLD_PACKAGED.json`](./evidence/W94GA_WORLD_PACKAGED.json) · [`W94GA_WORLD_PACKAGED.png`](./evidence/W94GA_WORLD_PACKAGED.png)

W94Ga 定向 contract 为 `2/2`；全量 `npm test` 为 `280/282` 个测试文件通过，剩余两项仍是既有
W71 release foundation 与 W72c provenance ledger drift，未由本波引入。W94Ga 不产生公网写入，
因此不能把本地 PASS 解读为 Hub 已上线。

## 4. Hub Public Projection 首个施工切片（W94Gb）

W94Gb 先做本地 fake Hub/staging adapter，再做真实服务器；两者必须复用同一 envelope/command/receipt，而不是各写一套对象。

W94Gb 已完成本地 fake Hub：`main/world-hub-publication-service.js` 只在 Workspace
`.mazz/hub/fake-store.json` 保存 public-safe projection、manifest、receipt 和命令摘要，
并由 `hub:preparePublication`、`hub:publishPublication`、`hub:withdrawPublication`、
`hub:syncPublication` 窄 IPC 暴露。Source/Packaged 均完成 prepare → publish → query →
withdraw → sync、A/B、restart；证据与检查项见 [`W94GB_PUBLICATION_HUB_CHECKPOINT_2026-08-28.md`](./W94GB_PUBLICATION_HUB_CHECKPOINT_2026-08-28.md)。

### 4.1 Adapter 只允许四个动作

```text
preparePublication   # 校验 Grant、签名范围、manifest 与 content IDs
publishPublication   # 幂等写入 public projection
withdrawPublication  # 撤回 projection，不删除本地事实
syncPublication      # 按 publicationId/contentRoot 重新同步公开状态
```

`prepare` 可以是 offline deterministic fixture；`publish`/`withdraw` 才是 public-effect capability，必须显式 human authority、receipt 和可回滚的 projection state。未配对 endpoint、未知 schema、过期/revoked grant、签名范围变化、content hash 不匹配一律 fail closed。

### 4.2 不做的事情

- 不在 W94Gb 做支付、订阅、推荐、Overall Score、Marketplace 交易和公共 Watch Room；
- 不让 Hub 读取或推断本地 Workspace、私有 World、未发布 Rights、私钥和 agent transcript；
- 不把公开 metadata 当明文内容授权；加密 payload 仍服从 W84 Entitlement/Runtime Permission；
- 不把服务器在线、DNS 指向、Cloudflare/反代状态当 Publication truth；
- 不因为网络或用户离线而删除本地 Publication、World、Branch 或 Receipt。

## 5. Staging/Production 运行门（W94Gc）

真实服务器验收必须有独立 runbook 和证据，不以“命令行能登录”代替：

| 门 | 必须证明 |
| --- | --- |
| 身份 | 非 root 部署用户、SSH key policy、最小服务权限、staging/prod 分离 |
| 网络 | apex/`www` DNS、80→443、TLS chain、反向代理、health endpoint；521/5xx 有记录且最终为 0 |
| 数据 | publication projection、receipt、withdraw、re-sync 的备份与恢复，恢复后 digest 不变 |
| 安全 | secrets 不进仓库、日志、截图、manifest；上传/撤回有 authority 和审计链 |
| 资源 | 进程管理、日志轮转、磁盘/内存/连接监控、限流和故障告警 |
| 事故 | 证书续期、回滚、缓存失效、Hub 不可用时本地继续工作，至少一次 drill |

任何真实公网写入都必须由人类明确授权；没有授权时只跑 fake Hub/staging fixture。

## 6. 每波必查矩阵

### W94Ga 检查

- contract：World schema、fork identity、proposal authority、partial merge、conflict/revision/CAS；
- runtime：Source/Packaged create/fork/review/merge/restart，Workspace A/B 隔离；
- safety：绝对路径、URL、secret、私有正文、无 evidence 的 simulation 结果全部被拒；
- resource：event writer、World store、temporary/recovery resource 在 close/reopen 后归零；
- evidence：World source/packaged JSON + 最终桌面截图 + `runtimeErrors=[]`。

### W94Gb 检查

- contract：grant 必需、签名/manifest/content ID 一致、publish 幂等、withdraw/re-sync 可重放；
- negative：无 grant、过期/revoked grant、未知字段、未知 profile、路径/密钥/草稿注入全部 fail closed；
- runtime：fake Hub Source/Packaged，publish → query → withdraw → sync，Hub 不持有私有字段；
- provenance：每个 public projection 都可回到本地 artifact/receipt/grant，不把 URL 当 identity；
- evidence：projection/receipt JSON、network call 统计、进程归零、截图人工核验。

### W94Gc 检查

- runbook：新服务器从零恢复，staging 与 production secret/账号分离；
- network：DNS/TLS/反代/health/521 证据按时间记录；
- recovery：备份恢复、撤回、缓存失效、客户端重同步和回滚各至少一次；
- public safety：未授权时不写公网；公开运行前人工确认全部 red gate 已关闭。

当前运行证据：服务器已创建隔离 `mazzhub` 用户，origin 绑定 `127.0.0.1:3210`，nginx 反代到 HTTPS；`https://www.mazz-hub.com/healthz` 和只读 public snapshot 为 200，publish/withdraw 在 staging 明确返回 403 `HUB_PUBLIC_EFFECT_DISABLED`。ACME 证书只覆盖 `www.mazz-hub.com`；根域当前没有可用 A/AAAA 记录，因此 apex、备份恢复、日志/资源告警和 incident drill 仍未闭合。证据见 [`W94GC_SERVER_BASELINE.json`](./evidence/W94GC_SERVER_BASELINE.json) 与 [`W94GC_SERVER_STAGING.json`](./evidence/W94GC_SERVER_STAGING.json)。

## 7. W94G 完成定义

W94G 只有在 W94Ga、W94Gb、W94Gc 全部通过，且 README、总计划、检查点、Source/Packaged 证据同代时，才能写 `W94G PASS`。只有 fake Hub 或本地 World 通过时，状态分别写 `W94Ga PASS` / `W94Gb PASS_WITH_SCOPE`，不能写 Hub 已上线。

当前状态明确为：**W94Ga PASS；W94Gb PASS_WITH_SCOPE；W94Gc PASS_WITH_SCOPE**。真实 staging
origin 已经可复核，但生产公共 effect 仍关闭；只有非 root 部署、双域 DNS、备份恢复、资源告警、
证书续期和 incident drill 证据齐全，并完成签名密钥治理后，才能由人类另行授权开启。
