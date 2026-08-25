# W93C Rights & Source Adapter Foundation / 权利与来源适配器基础规格

> 状态：**PASS / W93D NEXT**
> 日期：2026-08-25
> 上位规格：[W93 Library Resource Freedom](../plans/W93_LIBRARY_RESOURCE_FREEDOM.md)
> 前置检查点：[W93B Streaming Acquisition PASS](./W93B_STREAMING_ACQUISITION_CHECKPOINT_2026-08-25.md)
> 范围：离线 SourceAdapter registry、严格来源页合同、权利证据裁决、W93A Job/Rights Receipt 接线；不接真实来源、不默认联网、不做新 UI、不接 Torrent、不改 Factory。

## 1. 本波目标

W93A 已冻结 Candidate/Rights/Job，W93B 已贯通字节取得与书架 Inbox。W93C 只补“候选从什么协议边界进入、来源的权利主张如何被降格为可审计系统裁决”。

本波完成后必须得到：

- 一个无厂商分支的 `LibrarySourceRegistry`，只接受严格 `SourceAdapter`；
- `descriptor/search/discover/resolve/health` 五种调用的统一输入、输出、取消、错误与健康合同；
- 默认只注册内存 fixture adapter，整个默认测试和 Source/Packaged 坐标网络调用为 `0`；
- Candidate 必须再次通过 W93A strict normalizer，Adapter 不能通过未知字段、错误类型、secret、私网 URL 或伪强身份进入系统；
- public-domain / open-license / user-owned / unknown / restricted 五态均得到确定性裁决，来源声明不被冒充为全球法律结论；
- 通过裁决只生成最小 allowlist Rights Receipt；Receipt 绑定 Candidate fingerprint、Provider policy snapshot、法域与权利证据摘要；
- 可直接用裁决结果创建 W93A durable Job，重开后 Receipt 与 Candidate fingerprint 不变，unknown/restricted 永不进入取得队列。

## 2. 明确不做

- 不连接 Project Gutenberg、OPDS、Internet Archive、Open Library、Standard Ebooks 或任何真实站点；
- 不实现抓取、分页 HTTP、缓存、速率限制、User-Agent、Retry-After；这些属于 W93D 的具体 Adapter；
- 不暴露 Renderer 可注册 Adapter、任意 URL、header、cookie、acquisitionRef 或下载能力；
- 不自动推断版权期限、不把来源标签当法律意见、不允许 unknown/restricted 自动升级；
- 不增加资源搜索 UI、下载队列 UI、许可弹窗、Torrent 或 Reader 渐进读取；
- 不设置候选条数、页数、正文长度、文件大小、字数或 token 业务门限。循环来源只能由空页、稳定 cursor、显式取消或明确协议错误收敛。

## 3. SourceAdapter 合同

### 3.1 Descriptor

Schema：`mazz.library-source-adapter-descriptor/v1`

```js
{
  schema,
  providerId,
  displayName,
  adapterVersion,
  capabilities: ['search', 'discover', 'resolve', 'health'],
  policy: {
    policyVersion,
    checkedAt,
    jurisdictions: [],
    rightsModes: [],
    termsUrl,
    rightsUrl
  }
}
```

- 所有文本必须是原生 string，不能 trim 后静默改写 boxed/object/number；
- `providerId/adapterVersion/policyVersion` 是 opaque identity，前后空白一票否决；
- URL 有值时必须过 W93A 公共 HTTPS、secret 与特殊地址门；
- `checkedAt` 是政策坐标，不是“永远有效”；不得晚于裁决时刻；
- capabilities、jurisdictions、rightsModes 必须去重、稳定排序；registry 不凭方法存在猜能力。

### 3.2 Page / Resolve Result

Schema：`mazz.library-source-page/v1`

```js
{
  schema,
  providerId,
  adapterVersion,
  policyVersion,
  candidates: [],
  nextCursor: null | 'opaque-string'
}
```

- search/discover 返回 Page；resolve 返回同 schema 且必须精确一个 Candidate；
- 每个 Candidate 的所有 Offer 与 provenance 必须属于该 provider，provenance adapterVersion 必须等于冻结 descriptor；
- 返回页的 provider/version/policy snapshot 必须与调用开始时 descriptor 完全一致；调用中换版本 fail-closed；
- 同页相同 candidateId 内容相同可幂等去重，内容不同为冲突；跨页同 candidateId 内容变化同样冲突；
- 不跨来源按标题/作者合并；强身份聚合留给 W93D federated discovery；
- cursor 是不透明原生 string。重复 cursor 表示来源未前进，收敛但不得重复输出；空 candidates + null cursor 自然完成。

### 3.3 调用与资源

- `register()` 同 provider 同 descriptor+同 adapter 实例为幂等；任何替换必须显式 unregister 后重新注册；
- search/discover/resolve/health 必须检查 AbortSignal；取消后不得再调用 Adapter；
- Registry 不创建 interval、listener、network client 或后台 owner；`close()` 后调用全部拒绝；
- Adapter 异常按 provider 隔离，健康事实只记 allowlist code/time，不落响应正文、URL、路径或 secret；
- fixture adapter 只读冻结内存页，不使用 `fetch/http/https/net`，用于所有默认 gate。

## 4. Rights Policy 合同

裁决输入冻结为：规范 Candidate、冻结 Descriptor、目标 jurisdiction、裁决时刻，以及仅在 user-owned 时出现的用户声明。

裁决输出 Schema：`mazz.library-rights-decision/v1`

```js
{
  schema,
  outcome: 'pass' | 'awaiting-rights' | 'blocked',
  candidateId,
  candidateFingerprint,
  providerId,
  policyVersion,
  jurisdiction,
  sourceStatus,
  decidedAt,
  receipt: null | { decision, authority, evidenceRef, at },
  reasonCode
}
```

硬矩阵：

| Candidate rights | 必要证据 | 系统结果 |
| --- | --- | --- |
| `public-domain` | evidenceUrl/assertedBy/checkedAt、rightsStatement、明确且匹配的法域、descriptor 声明支持 | `pass` |
| `open-license` | 上述字段 + licenseId、明确法域、descriptor 声明支持 | `pass` |
| `user-owned` | Candidate 已是 user-owned + 当前用户原生严格确认、candidate fingerprint、法域与时间绑定 | `pass`，authority 固定 `user` |
| `unknown` | 任意来源主张都不得补齐 | `awaiting-rights`，receipt=null |
| `restricted` | 不接受用户或 Adapter 覆盖 | `blocked`，receipt=null |

补充不变量：

- Candidate `rights.checkedAt`、descriptor `policy.checkedAt` 均不得晚于裁决时刻；Candidate 证据不得早于当前 descriptor policy snapshot；
- descriptor 不声明该 rights mode 或 jurisdiction 时不能 pass；
- `worldwide` 只作为来源自己声明的法域坐标，系统不解释成全球公版；调用方必须显式选择 `worldwide` 才能匹配；
- Receipt `evidenceRef` 是 canonical allowlist evidence package 的 SHA-256，不含 URL、正文、路径或 secret；
- `public-domain/open-license` authority 固定为 `adapter-policy-<providerId>`；user-owned 固定为 `user`；
- unknown/restricted 不生成 passing Receipt，也不能通过修改调用参数升级 Candidate rights。

## 5. Durable Job 接线

`prepareAcquisitionJob()` 只做纯数据接线：

- 输入 main-owned canonical Workspace identity/path、intentId/jobId、Candidate、Offer、冻结 Descriptor、法域、Rights Decision 与创建时刻；
- 不能信任调用方传回的 Decision；函数必须用 Candidate + Descriptor + 法域（user-owned 还含用户声明）重新裁决并与 Decision 做 canonical 全等比较；
- decision `pass`：单文件/无需选择进入 `queued`，有 selectableFiles 且未选进入 `awaiting-selection`；
- `unknown`：进入 `awaiting-rights`，无 Receipt；
- `restricted`：进入 `awaiting-rights`，无 Receipt，且任何 W93B start 都继续拒绝；
- Job 交给现有 `LibraryAcquisitionStore.createJob(...,{candidate})` 重新做 Candidate/Rights/Offer/Workspace 校验；本模块不得直接写 JSON；
- 重开 Store 后 candidateFingerprint、rightsStatus、rightsReceipt、state、idempotencyKey 完全不变；同 intent 重放仍走 W93A exactly-once。

## 6. 安全与隐私

- Descriptor/Page/Decision/User Assertion 全部拒绝 unknown field；
- 任何层发现 cookie、Authorization、Bearer、API key、token、签名 query、绝对本地路径或非公共 URL 均 fail-closed；
- 错误只持久 allowlist code；原始 Adapter error 只在调用栈返回，不进入 Decision/Job/证据；
- Evidence JSON 只记录 fixture ID、计数、状态、哈希和退出门，不记录 Candidate 正文、URL、用户路径或原始错误；
- 本波不引入任何新的信任 IPC，不把 Adapter 对象或注册能力暴露给 Renderer。

## 7. 必查矩阵

1. Descriptor strict type、unknown field、重复能力、secret/私网 URL、未来时间、版本漂移；
2. search/discover/resolve/health 正常、异常、取消、关闭后拒绝、同页/跨页冲突；
3. 无固定页/条目门：大量 fixture pages 自然走完；重复 cursor/空页自然停；
4. 五态 Rights 全矩阵、法域不匹配、policy mode 不支持、证据早于 policy、future time、user assertion 绑定；
5. Decision → Job → Store reopen roundtrip；unknown/restricted 无法 queue/start；passing receipt 不变；
6. secret/path/URL 污染反向矩阵；Adapter 响应正文不进入 durable error/evidence；
7. Registry close/cancel 后 listener/timer/owner/network 全为 0；
8. Source + Packaged 离线 runtime 均加载同代 module，执行 fixture discover→rights→durable Job roundtrip，网络调用 0、runtime error 0；
9. `npm run test:w93c:library`、默认全量、build、dist/provenance、`git diff --check` 全绿；
10. 检查点与 JSON evidence 记录精确边界、失败、回滚和下一波，不预写 W93D 真实来源结果。

## 8. Final Gate

只有第 7 节全部为绿，且当前树不存在可复现 P0/P1，才可把状态写成 `PASS / W93D NEXT`。任一默认联网、unknown/restricted 升级、Candidate/provider 漂移、持久 Receipt 不可重放、Source/Packaged 不同代或资源不归零，均保持 `HOLD`。

W93C PASS 只表示 Adapter 与 Rights 基础协议可用；不表示任何真实来源已获准、其 ToS/robots/licensing 已被现时核验，或用户可以在 UI 中发现/下载书籍。
