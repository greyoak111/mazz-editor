# W93E Library Resource Surface / 书库资源界面与修复规格

> 状态：**PASS / W93F NEXT**
> 日期：2026-08-25
> 上位设计：[W93 Library Resource Freedom](../plans/W93_LIBRARY_RESOURCE_FREEDOM.md)
> 前置：W93A–D 均 PASS；Factory 继续冻结；W93F Torrent 不进入本波。
> 用户授权：继续推进；每波必须独立检查。

## 1. 本波目标

W93E 把已经完成的 Source、Rights、Acquisition 与 Inbox 四层真相接入现有书库，形成用户可见、可恢复、不会把 Renderer 变成取得权威的闭环：

```text
书库 / 资源页
  → main-owned Source discovery
  → durable Candidate snapshot
  → Rights Decision + immutable Receipt
  → durable Acquisition Job
  → HTTP transport / verify / promotion
  → durable Inbox
  → existing LibraryRepository shelf CAS
```

“资源页可用”必须同时意味着：候选可追溯、权利状态可见、取得状态耐久、失败可修、Workspace 切换不串账、Library 未打开也不丢完成事实。

## 2. 范围

### 2.1 本波交付

1. 书库内“书架 / 资源”双页签，不新造独立书架。
2. Project Gutenberg 与用户显式配置的公共 HTTPS OPDS 发现；手动 HTTPS 候选。
3. Candidate、版本、格式、来源、法域与 Rights 状态的安全投影。
4. 主进程持久 Candidate/Descriptor 快照，支撑重启后的 resume/retry。
5. 取得队列：queued/downloading/paused/verifying/materializing/awaiting-import/imported/failed/cancelled。
6. 显式刷新、继续下一页、暂停、继续、重试、取消、恢复账本。
7. Inbox 到现有书架 CAS 的自动重放；资源页事件只作 wake hint。
8. Source + Packaged Electron UI/生命周期运行门。

### 2.2 非目标

- Torrent/Magnet/.torrent 选择、DHT/Tracker、P2P 上传策略（W93F）。
- DRM、登录/验证码绕过、受控借阅规避、影子图书馆。
- 默认后台联网、自动翻页、自动批量下载、定时健康探测。
- Renderer 直接提交任意 Candidate、headers、cookie、路径或签名 URL。
- 把 `unknown` Rights 通过一个按钮静默升级成 `user-owned`。

## 3. Owner 与真相边界

### 3.1 Main owner

主进程拥有：SourceAdapter、catalog requester、Candidate 快照、Rights Decision、Acquisition Job、传输 owner、Inbox、Workspace capability 与修复事务。

每个 IPC 请求都必须：

1. 来自已发布的 `mazz-res://app/index.html` 主 frame；
2. 绑定主进程当前物理 Workspace；
3. 等待该 Workspace 单飞恢复完成；
4. 只接受严格 allowlist 字段与 opaque identity；
5. 返回安全投影，不返回 artifact path、sourceUrl、acquisitionRef、evidence URL、响应正文或错误正文。

### 3.2 Renderer owner

Renderer 只拥有视图状态和一次请求的 AbortController。它可以提交：查询词、已注册 providerId、opaque continuation、candidateId/fingerprint、offerId、expectedRevision 与明确动作。它不能创建权利事实、修改 Job、选择任意文件路径或替换 Candidate。

Provisional/handoff、Workspace retirement、destroy preflight 会同步 abort 资源请求；只有 finalize/activate 后才重新取得查询与修复能力。

### 3.3 Durable Candidate catalog

物理位置：`<workspace>/书库/.resources/candidates/`。

每条记录保存严格规范 Candidate、对应冻结 Descriptor、Candidate SHA-256 fingerprint、revision 与 observedAt。发布采用同 Workspace 临时文件、`fsync`、排他 hard-link create/原子 replace；不支持原子发布时 fail-closed。损坏、非普通文件、目录替换或 Candidate/Descriptor 绑定漂移均进入 repair-required，不覆盖原件。

## 4. 配置合同

全局 settings 只保存非 secret 配置：

```js
{
  contact: "user@example.org" | "https://example.org/contact",
  jurisdiction: "US" | "",
  opds: [{
    providerId, displayName, rootUrl, searchTemplate,
    version: "1.2" | "2.0"
  }]
}
```

- 未配置 contact 时不发 catalog 请求，UI 明确提示。
- 自定义 OPDS 永远以 Rights `unknown` 注册，不能由配置声明为公版。
- URL 必须是无 secret 的公共 HTTPS；不支持 headers/cookie/auth 字段。
- Gutenberg 的 US 来源主张只有在法域 `US` 且当前政策证据有效时才可能 pass；其他法域保持 awaiting-rights。

## 5. IPC 合同

允许通道：

- `library:resourceSnapshot({workspacePath})`
- `library:resourceConfigure({workspacePath, contact, jurisdiction, opds})`
- `library:resourceSearch({workspacePath, query, providers, continuations})`
- `library:resourceManual({workspacePath, url, format, title, authors, language})`
- `library:resourceAcquire({workspacePath, candidateId, candidateFingerprint, offerId, intentId})`
- `library:resourceAction({workspacePath, jobId, expectedRevision, action})`
- `library:resourceRepair({workspacePath})`

主进程广播 `library:resourceChanged` 只含 wake hint；Renderer 完全忽略 payload，重新 snapshot。

## 6. 取得与修复语义

1. acquire 先从 durable Candidate catalog 重取原快照，再按当前 frozen Descriptor 重新裁决 Rights。
2. `pass` 才创建 queued Job 并启动 HTTPS；`unknown/restricted/jurisdiction unresolved` 只创建可解释的 awaiting-rights/blocked 投影，不发网络。
3. start/resume/retry 总是携带 durable Candidate、Job expectedRevision；同 Job 同时只能有一个 owner。
4. pause/cancel 等待 Acquisition Service 的耐久边界；UI 不凭内存先宣布成功。
5. repair 只执行 orphan-lock repair、restart recovery 与 reconcile；不自动删除 corruption、quarantine 或用户书籍。
6. Job 失败只显示稳定 code 与阶段，不向 Renderer 泄露原始路径/远端正文。

## 7. UI 约束

- 书架与资源页共享现有 Library 生命周期；阅读器打开时资源页不叠加。
- 候选卡显示：书名、作者、来源、格式、Rights 状态、法域、版本数和取得动作。
- 队列显示确定性状态、字节进度和稳定错误 code；无固定队列条数或分页条数裁剪。
- “继续下一页”必须是用户明确动作；不存在后台 collect。
- unknown/restricted 明确不可取得；不提供含混的“仍然下载”按钮。
- 空态、未配置 contact、部分来源失败、账本 repair-required 都有可见说明。

## 8. 资源与退出

- discovery 请求无定时器；视图 abort 后 registry/client/discovery owner 必须归零。
- 主进程维护每 Workspace 单飞 context；配置变化只在无活动发现时替换。
- App 退出顺序：停止接收资源 UI 请求 → abort/等待 discovery/background acquisition → Browser bridge durable settle → Acquisition Service shutdown → owner 归零 → quit。
- Library tab 销毁移除 `resourceChanged` listener、abort 请求并等待 binding pending 固定点。

## 9. 必查矩阵

| Gate | 必须证明 |
| --- | --- |
| Contract | 严格 IPC、Candidate/Descriptor 持久 roundtrip、corruption HOLD、无 secret/path 泄露 |
| Rights | public-domain/unknown/restricted/jurisdiction mismatch 均按 W93C 结果展示与执行 |
| Acquisition | search→acquire→HTTP fixture→verify→Inbox→shelf；pause/resume/retry/cancel |
| Restart | Candidate 与 Job 重开后仍可 resume；当前 B 启动后再开 A 仍单飞恢复 |
| Multi-window | 同 intent exactly-once；provisional 无写权；wake payload 无事实权 |
| Workspace | A/B 查询、Job、Inbox、Candidate 不串账 |
| Fault | DNS/redirect/网络/校验/发布/Store corruption 可见且 fail-closed |
| Resource | request/controller/listener/context/background owner 全归零 |
| Source | BrowserWindow 真实 UI 全链；runtime error 0；默认 fixture 网络 |
| Packaged | 同代 app.asar 重跑同一 UI/修复链 |
| Regression | W93A–D、Library atomic/repository/security、全量、build、dist、provenance |

## 10. Final Gate

W93E 只能在以下全部成立时 PASS：

1. 定向与相邻合同全绿；
2. Source + Packaged UI E2E 全绿，资源 owner/listener/timer/临时目录归零；
3. 默认测试无真实书源请求；
4. 全量、build、dist、provenance 通过；
5. 检查点记录精确证据、失败、回滚和 W93F 边界。

任一 RED 时保持 PARTIAL/BLOCKED，不推进 W93F。

本波已于 2026-08-25 按上述 Gate 完成，权威结论见
[W93E 检查点](./W93E_LIBRARY_RESOURCE_SURFACE_CHECKPOINT_2026-08-25.md)；W93F 在本文件范围外，未提前施工。
