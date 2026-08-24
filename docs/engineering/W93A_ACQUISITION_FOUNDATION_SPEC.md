# W93A Acquisition Foundation / 资源取得基础规格

> 状态：**PASS / W93B AUTHORIZED**
> 日期：2026-08-24
> 上位规格：[W93 Library Resource Freedom](../plans/W93_LIBRARY_RESOURCE_FREEDOM.md)
> 范围：只落纯合同与 Workspace 持久 job/inbox 基础；不注册真实来源、不发网络请求、不接 UI、不接 Torrent、不改 Factory。

## 1. 本波目标

W93A 解决“后续每条来源和传输用什么共同真相”这一件事。完成后仓库应具有：

- 可严格验证、可序列化的 Resource Candidate / Rights / Offer / Acquisition Job 合同；
- Work / Edition / Blob / Offer / Job 的强身份与幂等键；
- 创建时捕获 Workspace 的持久 Job Store 与 Inbox；
- 每条记录独立原子写入、revision、损坏文件留存和重启恢复投影；
- secret、签名 URL、路径穿越、格式虚报和非法状态迁移的 fail-closed 合同；
- `.resources` 内部状态写入不触发 Workspace 文件树/侧栏连续刷新。

本波不宣称已经下载、续传、入架、支持 OPDS、支持 P2P 或突破 Reader 的 Base64 打开链。

## 2. 文件范围

| 文件 | 目的 |
|---|---|
| `main/library-resource-contract.js` | schema、normalizer、身份、权利、状态迁移、secret 与路径验证 |
| `main/library-acquisition-store.js` | `<workspace>/书库/.resources` 下的 jobs/inbox 持久事实 |
| `main/file-watcher.js` | 精确忽略书库内部 `.resources`，避免状态写导致侧栏闪动 |
| `tests/contract/w93a-library-resource-foundation.test.mjs` | 合同、roundtrip、fault、恢复与 watcher ignore |
| `tests/run.js` | 正式登记 W93A 合同 |
| `.mazz/audit/surface-census.json` | build 后刷新受检 main surface 数与行数；只记录范围计数，不新增运行能力 |
| 本 SPEC 与 W93A CHECKPOINT | 规格和真实验收记录 |

任何超出本表的产品文件修改必须先解释并更新规格；Factory 文件零改动。

## 3. 物理布局

```text
<workspace>/书库/.resources/
  jobs/<jobId>.json
  inbox/<receiptId>.json
  staging/<jobId>/
  quarantine/<jobId>/
  locks/<scopeHash>.lock
```

- 一 job 一文件，避免一个总 JSON 随任务数增长而整文件重写。
- 写入使用同目录临时文件、`fsync`、原子 replace；创建仅接受 hard-link exclusive publication。文件系统不支持原子创建时明确失败，不用可被读到半份 JSON 的 copy fallback 冒充成功。
- 文件名只接受系统生成的稳定安全 ID；不允许远端标题、resourceId 或原路径直接成为叶名。
- 读取损坏 JSON 不覆盖、不删除；返回脱敏 corruption 记录并阻止该 ID 后续写入。任一 Job corruption 都使其原幂等身份不可知，因此人工修复前保守阻断全部新 Job create/put，不能换 `jobId` 重复取得；完好既有 Job 的精确 CAS 更新仍按自身事实处理。
- Store 构造时把输入路径解析为 canonical physical realpath，并由它派生唯一 `workspaceIdentity`；8.3/大小写等同物理路径不能形成第二套账，显式 identity 覆盖一律拒绝。调用方不能在任务运行时换成“当前 Workspace”。
- 关键写入以原子发布的 scope lock 串行化；锁 owner 先完整写入并 `fsync`，携带不可复用 token，释放前必须复核 token。Store 无权把死亡或畸形锁自动当成“全局无人持有”并删除；遗留锁必须由持有 Electron 单实例权威的启动协调器显式修复，普通窗口一律 fail-closed。
- `书库`、`.resources` 及内部目录逐级做 `lstat/realpath` 校验后才创建下一级；junction/symlink 不能把内部账引到 Workspace 外。构造完成后冻结各根目录的 physical identity，并在每个读写/锁/publication 边界复核，运行中 reparse swap 必须在外部写入前失败。

## 4. 合同规则

### 4.1 Candidate

- `schema` 必须为 `mazz.library-resource-candidate/v1`。
- 至少一个 Work、Edition、Offer；Offer 的 `editionId` 必须存在。
- 首期正式格式仅 `epub/cbz/txt/mobi/azw3/pdf`。
- Transport 枚举为 `https/magnet/torrent-file/local`；W93A 只验证，不执行。
- `sourceUrl/pageUrl` 只能是无 userinfo、无敏感 query 的 HTTPS 公共主机名 URL；纯合同层保守拒绝全部 literal IP，有 secret 时拒绝，不能“清洗后当没发生”。DNS 与 redirect 的逐跳解析属于 W93D transport gate。
- `acquisitionRef` 是不透明、无 secret、非路径的主进程引用；绝对/相对/UNC 路径和签名下载地址不得进入 Candidate。

### 4.2 Rights

- 状态只允许 `public-domain/open-license/user-owned/unknown/restricted`。
- `public-domain/open-license` 必须有 `evidenceUrl`、`assertedBy` 与 `checkedAt`。
- `user-owned` 必须由 `authority=user` 的 Rights Receipt 才能进入 queue。
- `unknown` 只能停在 `awaiting-rights`。
- `restricted` 不能转入 inspect/queue/transport。
- Job 固化不可变 `rightsStatus`；创建时必须提供并验证 Candidate。`public-domain/open-license/user-owned` 在 durable create 时即建立 Receipt；只有原始 `unknown` 可在 `awaiting-rights → inspecting` 接受显式 user-owned 声明，`restricted` 永不升级。

### 4.3 Job

- Schema 为 `mazz.library-acquisition-job/v1`，带 revision。
- Job 必带系统生成的 `intentId`，幂等身份是 `workspaceIdentity + intentId + offerId/transportIdentity + sorted(selectedFiles)`。同一 intent 从空选择 `awaiting-selection` 定稿时，新旧请求键同时加锁，新键原子生效，唯一可推导的同 intent 空选择键永久作为 alias；同 intent 之后不能静默改选，必须得到显式 selection conflict。不同 intent 可从同一个多文件 Offer 再取另一册。
- Job 创建时必须固化完整规范 Candidate 的 SHA-256 快照指纹；后续选档定稿必须提交同一 Candidate 并精确匹配该指纹，不能以相同 candidate/offer ID 替换文件目录、Rights 或 provenance。
- 调用方不能注入 alias。一个尚未持久化的、已明确选档的 intent 可直接创建为“已定稿 intent”，Store 必须自行补入同 intent 的空选择 alias；若同 intent 已存在 `awaiting-selection` 事实，后续选档请求必须携 revision 走 Store transition，不得以普通 put 静默丢弃选择。磁盘上任何有 `selectedFiles` 却缺少该唯一 alias 的 Job 都是 corruption，不得加载为事实。
- `workspacePath/workspaceIdentity` 必须与 Store 一致。
- Job 只引用 Candidate/Offer 的稳定 ID，不持久化远端响应正文和凭据。
- `selectedFiles` 只接受去重后的相对 POSIX 路径；拒绝 NUL、绝对路径、`..`、空段和 Windows ADS/设备名。
- 所有 durable `public-domain/open-license/user-owned` Job 都必须携带合法 Rights Receipt；`restricted/unknown` 不得伪装成通过。磁盘上缺 Receipt 的 passing Job 视为 corruption，不加载成事实。
- `stagingPath` 必须位于该 Store 的 staging root；`finalPath` 必须位于创建时 Workspace 的 `书库`。
- 绝对路径同时拒绝 ADS、设备名、尾随点/空格，并在 Store I/O 边界按现存祖先 `realpath` 复核。

### 4.4 状态迁移

允许：

```text
discovered → resolving / awaiting-rights / failed / cancelled
resolving → awaiting-rights / inspecting / failed / cancelled
awaiting-rights → inspecting / failed / cancelled
inspecting → awaiting-selection / queued / failed / cancelled
awaiting-selection → queued / failed / cancelled
queued → downloading / paused / failed / cancelled
downloading → paused / verifying / failed / cancelled
paused → queued / downloading / restart retryFrom 指定原阶段 / failed / cancelled
verifying → materializing / failed / cancelled
materializing → awaiting-import / failed / cancelled
awaiting-import → imported / failed / cancelled
failed → retryFrom 指定的合法非终态 / cancelled
```

`imported/cancelled` 为终态。本波只持久化，不执行运输。

应用重启时（仅由 App 启动 owner 显式调用恢复，不因第二个 Store/窗口打开而自动推断）：

- `downloading/verifying/materializing/awaiting-import` 变为持久 `paused`，保留 `retryFrom` 和 `APP_RESTART_RECOVERY`；
- `awaiting-rights/awaiting-selection/queued/paused` 原态保留；
- 终态不变；
- 恢复写入也必须走 revision 与原子 publication。
- `failed` 的 retry target、error 与审计事实不可原地改写，只能按既定 `retryFrom` 恢复或取消；`imported/cancelled` 除精确重放外完全不可变。

## 5. Inbox

Inbox Receipt：

```js
{
  schema: 'mazz.library-acquisition-inbox/v1',
  receiptId, jobId, workspaceIdentity,
  kind, state: 'pending' | 'acknowledged',
  artifact: { path, sha256, size, format },
  createdAt, acknowledgedAt
}
```

- receipt 只引用已经校验的 Workspace 内文件。
- 同 receiptId 重放幂等；不同内容不能覆盖。
- ack 只能 `pending → acknowledged`，重复 ack 返回同一事实。
- Library Renderer 是否存在不影响 receipt 创建与保留。

## 6. 安全与隐私不变量

- 对象任意深度不得包含 `authorization/cookie/apiKey/accessToken/refreshToken/password/secret/signature` 等字段。
- 字符串不得包含 Bearer、常见 API key 形态或敏感 URL query。
- 错误持久化只保存 code 与脱敏 message，不保存绝对远端 URL、绝对路径、headers 或响应正文；percent-encoding 递归解码到稳定态后仍须通过同一检查。
- `.resources` 是内部账，不出现在普通书架/文件树变更广播里；用户书籍真实新增仍必须正常触发 watcher，不能由固定 watcher depth 静默漏掉深层书库资产。
- 不设置 job 数量、候选数、文件数、文本字数、token 或任意文件大小业务上限。

## 7. W93A 必查矩阵

1. Candidate：合法完整 roundtrip；标题相同不同 edition 不误合；相同强 ID/Blob 可聚合。
2. Format：六种通过；`.azw/.fb2` 和未知格式拒绝。
3. Secret：字段名、Bearer、签名 URL、userinfo、敏感 query 全拒绝。
4. Rights：五态与 receipt 迁移矩阵。
5. Path：POSIX 相对路径通过；绝对、`..`、NUL、ADS、设备名拒绝。
6. Store：创建/更新/revision/reopen；同幂等键零新增；两 Workspace 不串。
7. Fault：损坏 job/inbox 保留且不能覆盖；临时文件不冒充正式记录。
8. Restart：活动态转 paused+retryFrom；等待态与终态不被改写。
9. Inbox：Library 不存在仍可写；重放/ack exactly-once。
10. Watcher：`.resources` 事件被精确忽略；普通 `书库/书名.epub` 仍广播。
11. Scope：Factory diff 为零，默认测试无网络。
12. Gate：定向合同、相邻 Library/W71 watcher、`node tests/run.js` 全量、build、diff-check、独立只读审计。

## 8. Final Gate

只有以下全部成立才写 W93A PASS：

- 上述 12 组检查真实通过；
- 没有 P0/P1 未关闭；
- W93A Checkpoint 记录真实命令、计数、失败与修正；
- README 与总设计推进为 `W93A PASS / W93B NEXT`。

否则保持 `HOLD`，不得开始 W93B。

## 9. 实施结果

W93A 已按本规格完成并通过最终门，真实命令、回归计数、独立审计结论、未执行边界与下一波准入条件见：

- [W93A 检查点](./W93A_ACQUISITION_FOUNDATION_CHECKPOINT_2026-08-24.md)
- [W93A 结构化证据](./evidence/W93A_ACQUISITION_FOUNDATION.json)
