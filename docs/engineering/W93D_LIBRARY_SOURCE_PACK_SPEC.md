# W93D First Source Pack & Federated Discovery / 首批来源包与联邦发现规格

> 状态：**PASS / W93E NEXT**
> 日期：2026-08-25
> 上位规格：[W93 Library Resource Freedom](../plans/W93_LIBRARY_RESOURCE_FREEDOM.md)
> 前置检查点：[W93C Rights & Source Adapter Foundation PASS](./W93C_RIGHTS_SOURCE_ADAPTER_CHECKPOINT_2026-08-25.md)
> 范围：Project Gutenberg 合规 OPDS1、通用 OPDS 1.2/2.0、手动 HTTPS Candidate、强身份联邦分组、main-owned checkpoint/cache；不做 UI、不做 Torrent、不改 Factory。

## 1. 现时政策裁决

本规格在 2026-08-25 复核以下官方材料：

- Project Gutenberg Robot Access：<https://www.gutenberg.org/policy/robot_access.html>
- Project Gutenberg Terms of Use：<https://www.gutenberg.org/policy/terms_of_use.html>
- Project Gutenberg Offline Catalogs and Feeds：<https://www.gutenberg.org/ebooks/offline_catalogs.html>
- OPDS 1.2：<https://specs.opds.io/opds-1.2>
- OPDS 2.0：<https://specs.opds.io/opds-2.0>

裁决：

1. Gutenberg 主站不是通用爬虫目标；批量目录应使用官方 RDF/CSV/镜像，不爬 HTML 搜索页。
2. Gutenberg OPDS 应带可联系 User-Agent；每次用户搜索只取一页，只有用户明确继续时才取下一页。不得后台自动 drain 整个 feed。
3. Gutenberg 当前公开入口仍是 XML OPDS1；官方说明 OPDS2 仅测试且需联系获取，并预计 2027 退役 XML feed。因此本波不猜测或硬编码未公开 OPDS2 地址。
4. Gutenberg 的版权说明以美国受众为边界；US 外不自动判公版。Adapter 只能为 `jurisdiction=US` 提供 public-domain 来源主张，其他法域保持 unknown/awaiting-rights。
5. OPDS 1.2 是 Atom/XML；OPDS 2.0 是 JSON，支持 search、pagination 与 acquisition links。`download/open-access` 只表示取得方式，不等于开放许可；通用 OPDS 默认 rights=unknown。

## 2. 本波交付

- `LibraryCatalogHttpClient`：显式注入 resolver/requester；HTTPS、DNS 与每跳 redirect 公网复核；可联系 User-Agent；同来源串行礼貌请求；Retry-After 只影响该来源；默认构造不联网。
- `OpdsLibrarySourceAdapter`：严格解析 OPDS 1.2 Atom 与 OPDS 2.0 JSON，输出 W93C Page/Candidate；只接受支持格式和公开 HTTPS acquisition link。
- `GutenbergLibrarySourceAdapter`：冻结官方 OPDS1 根、US 权利证据与 user-driven pagination；没有 contact identity 时 live 请求前失败。
- `createManualHttpsCandidate()`：把用户明确提供的公共 HTTPS 文件做成 rights=unknown 的 source-scoped Candidate；不探测、不下载、不猜许可。
- `LibraryFederatedDiscovery`：逐来源一页查询，失败隔离；仅按 W93A strong workId 自动分组，不按标题/作者相似合并；返回每来源 continuation。
- `LibrarySourceCheckpointStore`：Workspace-bound main-owned cursor/cache envelope；原子写、重开、损坏阻断、来源 policy/adapter 版本绑定；不保存响应正文、签名 URL、凭据或 Candidate 描述。

## 3. 统一网络边界

- 构造时必须显式注入 resolver 与 requester；模块 import、registry register、descriptor、fixture tests 均零网络。
- URL 必须通过 W93A 公共 HTTPS/secret gate；DNS 返回任一非公共地址即拒绝；每个 redirect 重新解析并复核。
- redirect 不转发 Authorization、Cookie、Proxy-Authorization、Range、If-Range 或来源 validator；本波 catalog 请求根本不接受调用方 headers。
- 只发送固定 allowlist headers：`User-Agent`、`Accept`、`Accept-Encoding: identity`、条件缓存 `If-None-Match/If-Modified-Since`。
- User-Agent 必须包含产品 token 与部署方明确提供的 HTTPS contact URL 或 email；不得使用用户 API Key、Cookie、浏览器 Session。
- 同 provider 请求串行。通用 OPDS 的继续翻页只由调用者显式调用；Gutenberg 更严格地禁止 registry `collect()`/后台自动续页。
- 429/503 的 `Retry-After` 解析为来源健康事实和 `availableAt`；不睡眠阻塞 App，不自动无限重试。
- 响应 MIME 必须匹配 OPDS1/OPDS2；gzip/br 解压与大文档资源治理留在注入 requester，不用业务条数/页数/正文长度静默截断。

## 4. OPDS 规范化

### 4.1 OPDS 1.2

- 使用 namespace-aware streaming XML parser；禁止 DTD、ENTITY、外部实体与 processing instruction。
- Acquisition feed 的每个 entry 必须有 `atom:id`、`atom:title`、`atom:updated` 和至少一个 acquisition relation。
- 只接 `http://opds-spec.org/acquisition` 与 `.../open-access`；buy/borrow/sample/subscribe 不生成可下载 Offer。
- `atom:link rel=next` 解析为下一页，但 durable/API cursor 是 main-owned opaque token，不持久原始 URL。
- `dc:identifier` 仅在 ISBN/OLID/Gutenberg ID 严格合法时进入强身份；否则用 provider/resource source identity。

### 4.2 OPDS 2.0

- MIME 为 `application/opds+json`；feed 至少有 title、自链接以及 navigation/publications/groups 之一。
- 读取 publications 与 groups 内 publications；只接 `download` 或无额外要求的 `acquisition`。
- `metadata.identifier` 只有可证明类型才进入强身份；未知 URI 不强行映射。
- `links rel=next` 为下一页；search URI template 只允许 `{?query}`/明确支持参数，值按 URL 标准编码。

### 4.3 Candidate

- 每个来源 entry 形成 source-bound Candidate；同一 entry 的多个可读格式形成同 Edition 的多个 Offer。
- 首期可读格式严格等于书库现有支持：epub、pdf、txt、mobi、azw3、cbz。
- Generic OPDS 默认 rights=unknown。只有 Adapter descriptor 的政策快照明确声明模式、法域、rights evidence，且 entry 不冲突时，才允许 W93C 再裁决。
- Gutenberg 只对 US 标 public-domain，并以官方 Terms/License 页为 evidence；调用方选择其他法域时 W93C 不通过。
- 页面、封面、描述可缺；不得为满足 schema 伪造网页 URL、checksum、size、作者、出版时间或许可。

## 5. 手动 HTTPS

- 输入必须是原生公共 HTTPS URL、显式 format、title，可选 authors/language/strong identifier。
- URL 含 userinfo、token、signature、Bearer、私网/字面 IP 或 fragment secret 时拒绝。
- Candidate provider 固定 `manual-https`，rights 固定 unknown；用户自有权只能在 W93C user-owned assertion 流明确建立，不能由 URL 自动推断。
- 手动 URL 只是 Offer，不启动 W93B acquisition，不暴露通用网络 IPC。

## 6. 联邦发现与身份

- 一次调用按调用开始时的 registry descriptor snapshot 遍历全部选中 provider；不设来源数量上限，不丢失败前已完成来源。
- 每个 provider 每次最多执行一页。结果包含 `continuations[{providerId,cursorToken}]`；只有用户明确继续该 provider 才取下一页。
- 自动 group key 只使用 Candidate `work.workId`。因为 W93A 的无强 ID workId 已带 source namespace，所以标题同名不会误合。
- group 内保留每个原始 Candidate、provider、provenance 和 Offer；不创建跨 provider 的伪 Candidate，不让一来源 rights 覆盖另一来源。
- failure 只保留 allowlist `providerId/code`；不得带 URL、响应正文、路径或 secret。

## 7. Checkpoint / Cache

Schema：`mazz.library-source-checkpoint/v1`。

- 记录 workspaceIdentity、providerId、adapterVersion、policyVersion、queryHash、opaque cursor token、ETag/Last-Modified 的 hash、observedAt、revision。
- cursor token 只映射 Store 内经公共 URL校验的下一页 URL；对外结果只给 token；候选正文和完整响应不落 checkpoint。
- 同 Workspace/provider/queryHash 使用 revision CAS；reopen 后可继续；descriptor/policy 变化使旧 checkpoint stale，不自动复用。
- Store 位于 `<workspace>/书库/.resources/sources`，继承 W93A physical containment、reparse、原子 publication、corruption HOLD 与 watcher-silent 规则。
- 取消不前移 checkpoint；解析/网络失败保留上一成功 revision；同一页 replay 幂等。

## 8. 必查矩阵

1. OPDS1 namespace/entry/acquisition/next/search；DTD/ENTITY/XXE、错 MIME、未知 relation、非法 URL 全拒。
2. OPDS2 publications/groups/search template/next；blank/unknown/错类型/相对 URL、buy/borrow/preview 不生成 Offer。
3. Gutenberg descriptor/US rights/User-Agent contact/user-driven continuation；无 contact、自动 collect、HTML crawler path 均在请求前拒绝。
4. 手动 HTTPS strict type/secret/private URL/format/identity；默认 rights unknown。
5. 联邦同 ISBN/Gutenberg/OLID 强身份分组、标题同名不合、来源失败隔离、continuation 逐来源推进。
6. 333 页 fixture 可由 333 次显式 continuation 全部取得且不丢；单次调用绝不偷偷预取第二页。
7. Checkpoint create/CAS/reopen/stale/corrupt/reparse/crash；取消/错误零前移；响应正文/URL/secret 扫描为 0。
8. 网络 resolver 每跳、redirect、429/503 Retry-After、取消、requester error、资源 owner 归零。
9. Source + Packaged 离线 runtime：OPDS1、OPDS2、Gutenberg、manual、federated、checkpoint roundtrip；实际网络 0、runtime error 0。
10. W93D targeted、W93A-C adjacent、默认全量、build、dist/provenance、diff-check 全绿。

## 9. 明确不做

- 不注册 Renderer 可控 Adapter、URL/header/cookie；不新增 UI。
- 不做 Gutenberg HTML 页面爬虫、全站自动 OPDS drain、未公开 OPDS2、真实批量下载。
- 不接 IA/Open Library/Standard Ebooks/OAPEN/OpenStax；留给后续来源包。
- 不做 Torrent、DRM、借阅/购买、登录、验证码绕过。
- 不把 W93D 的 discovery 成功冒充 Rights pass 或 acquisition/import 完成。

## 10. Final Gate

只有第 8 节全部为绿、现时政策坐标写入 evidence、默认网络与资源 owner 为 0、无可复现 P0/P1，才可写 `PASS / W93E NEXT`。真实 Gutenberg live 不是必需门；若执行，必须显式 opt-in、单页、可联系 User-Agent、零下载，并单独记录时间与状态。
