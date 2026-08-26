# W94E Relation Retrieval + Branch Effective State 施工参照

> 状态：**SPEC READY / W94E PARTIAL · IN PROGRESS**  
> 版本：v0.1  
> 日期：2026-08-26  
> 前置检查点：[W94D Blender External Capability](./W94D_BLENDER_EXTERNAL_CAPABILITY_CHECKPOINT_2026-08-26.md)  
> 总施工参照：[W94 Unified Capability, Artifact & Public Plane](../plans/W94_UNIFIED_CAPABILITY_ARTIFACT_AND_PUBLIC_PLANE.md)

## 1. 本波裁决

W94E 把已有的 Relation Retrieval、Context Graph、Workspace Event Ledger 从“可调用
纯函数/局部 UI”接为一个 Workspace-scoped、可恢复、可解释的状态面，并为后续
Player/World/Hub 提供 Branch Effective State 基础。

本波不把相似度、共置或模型判断升级为 Authority；不复制正文、凭据、路径或 transcript；
不以 regex 命中冒充关系；不新增字数、token、候选条数或文件数量业务门。所有推断关系必须
带证据引用和可解释理由，人工升格仍是唯一 Authority 路径。

## 2. 现有基座与唯一真源

- main/foundation/relation-retrieval.js：Relation Edge、Episode、Recollection Query/
  Result 的纯数据规范化与排序内核。
- main/foundation/context-relations.js、main/context-relation-service.js：
  Navigation Context、Placement、Shadow/Promoted Edge 以及人工升格。
- main/foundation/workspace-events.js、main/workspace-event-service.js：
  Workspace Event hash-chain、Episode、生命周期与本地保留策略。
- main/addressable-evidence-service.js：文件/块/多模态证据的可寻址身份与失效重建。
- renderer/lib/workspace-events.js：现有各模块事件捕获入口；本波只扩展 producer
  覆盖，不另造第二事件账。

W94E 的 Workspace、Branch、Relation、Event、Artifact revision 均必须通过上述耐久事实
或明确的只读投影产生；Renderer 不得自建跨 Workspace 全局缓存。

## 3. 冻结数据合同

### 3.1 Relation Retrieval Service

Service 输入沿用 mazz.recollection-query/v0，输出沿用
mazz.recollection-result/v0，增加 Workspace 绑定的外层 envelope：

~~~
{
  "schema": "mazz.relation-retrieval/v1",
  "workspaceId": "workspace:<sha256>",
  "query": { "schema": "mazz.recollection-query/v0", "queryId": "query:…" },
  "candidates": [],
  "relations": [],
  "episodes": [],
  "explanations": [],
  "supersession": [],
  "sourceRefs": [],
  "rebuildable": true
}
~~~

- 输入只能引用当前 Workspace 的 candidate/episode/edge/context；跨 Workspace、未知
  schema、secret、绝对路径、正文和网络定位器在进入检索前拒绝。
- 每个结果必须能回到 anchorRef、eventRef、relation edge 或 Artifact revision
  的可寻址证据；理由必须说明命中的是 episode、semantic、relation、context 或时间关系。
- rejectedCandidateRefs 作为 durable negative fact 生效；同一查询重放保持相同排序，
  同分按稳定 ID 裁决。查询未提供显式输出偏好时不得由 UI 偷塞隐藏数量门。
- inferred/observed 只能是候选或建议；只有 human:* promotion receipt 才能产生
  promoted edge。旧 edge 被替代时保留 supersedes，不覆盖原事实。

### 3.2 Branch Manifest

新增严格、无正文的 mazz.branch-manifest/v0：

~~~
{
  "schema": "mazz.branch-manifest/v0",
  "branchId": "branch:<stable-id>",
  "workspaceId": "workspace:<sha256>",
  "baseBranchId": "",
  "parentBranchIds": [],
  "contextRefs": [],
  "relationRefs": [],
  "eventCursor": "event:<id>",
  "revisions": [
    { "domain": "calc", "artifactRef": "artifact:<id>", "revision": "rev:<id>", "status": "current" }
  ],
  "supersedes": [],
  "provenance": { "source": "branch-manifest" },
  "createdAt": "…",
  "updatedAt": "…"
}
~~~

domain 只允许 factory|library|player|calc|chart|canvas|blender|world；revision
只允许完整 Artifact/Receipt/Context/Event 身份，不允许路径或内容。Branch 是事实容器，
不是“当前 UI 选项”，也不授予发布或 Canon 权限。

### 3.3 Effective State

Effective-state 计算是纯数据 reducer，输入为一个 Branch Manifest、其 parent manifests、
Context/Relation refs、Event cursor 与 Artifact revision facts，输出：

~~~
{
  "schema": "mazz.branch-effective-state/v0",
  "branchId": "branch:<id>",
  "facts": [],
  "unknown": [],
  "conflicts": [
    { "key": "calc:sheet-1", "revisions": ["rev:a", "rev:b"], "reason": "concurrent-parent" }
  ],
  "sourceRefs": [],
  "resolutionRequired": true,
  "authorityGranted": false
}
~~~

- 同一 key 的单一线性 supersession 得到 current；多父并发 revision 得到显式 conflict，
  不静默选新、不按时间覆盖。
- 删除、恢复、revert、supersede 都保留可重放事件；缺证据只能进入 unknown。
- resolution 必须携带 human:*、前件 revision 和 reason；自动 merge 只能产生候选，
  不能把候选写回 current。
- Calc/Chart/Canvas/Blender/World 的 revision 命名空间彼此隔离；Branch 切换不串写
  其他 domain 的 current。

### 3.4 LAN State Sync

LAN Sync 新增关系/认知/branch 的离线 frame 类型，与文件 frame 分离：

~~~
{
  "type": "state-fact",
  "workspaceId": "workspace:<sha256>",
  "factKind": "relation|context|branch|event",
  "factId": "<stable-id>",
  "revision": "<stable-revision>",
  "payloadRef": "<local-evidence-ref>",
  "signature": "<device-signature>"
}
~~~

只同步可合并的无正文事实和本地证据引用；不传 Workspace 路径、正文、Key、Cookie、
Agent transcript 或未授权网络坐标。接收方按 Workspace identity、fact revision、签名和
冲突规则验证；文件复制成功不得冒充 state fact 已合并。

## 4. 生产接线

1. 增加 Workspace-scoped RelationRetrievalService 与窄 IPC：query、snapshot、
   reject-candidate、rebuild；IPC 请求必须绑定 trusted shell/current Workspace。
2. 让 Factory、Library、Player、Calc、Canvas、Blender、World 的现有正式成功/失败/取消/
   人工确认入口统一调用 captureWorkspaceEvent，只写 refs、状态和摘要，不写正文。
   人工确认统一记录为 `outcome=approval`；某个 domain 当前没有对应业务入口时，必须在
   覆盖审计中标明适用性/缺口，不得为满足矩阵凭空增加接口或推断事件。
3. 增加 Branch Store/Service：create、attach-parent、set-revision、resolve-conflict、
   snapshot、rebuild；每次 mutation 采用 CAS/hash-chain/Workspace containment。
4. 增加 Effective State reducer 与 explain projection；UI 只消费投影，不能自己合并
   revision。
5. 让 LAN Sync 对 state fact 使用独立 merge/ack/reject 轨；断线重连只重放 durable facts。
6. 旧 context:*、events:* 和文件同步入口保留兼容，但内部必须回到同一 Workspace
   owner；不得再增第二套关系或分支真相。

## 5. 故障、恢复与资源纪律

- 查询、事件、Branch 和 LAN state 均拒绝不完整 identity、跨 Workspace、未知字段、
  secret、坏 hash、未来 revision 和伪造 Authority。
- Store/CAS、hash-chain、目录 fsync 或签名失败时不发布部分事实；原始 bytes/ledger
  保留并生成可定位的恢复材料。
- 重启先校验 event/branch/state ledger；损坏中段阻断当前 owner，不猜测修复；尾部坏件
  隔离但保留原文。
- Workspace 切换、窗口关闭和 renderer destroy 必须取消 query、释放 listener/timer、
  清空 provisional branch owner；迟到结果不得复活旧 Workspace。
- 所有合并、拒绝和冲突结果必须可重放；无网络时不伪装“已同步”，只返回 offline/
  pending/blocked 状态。

## 6. 必查矩阵

| 门 | 必查 |
|---|---|
| Retrieval | 同查询可解释回到 anchor/event/edge/revision；拒绝候选后重放不回潮；同分稳定排序；未知/secret/跨 Workspace fail closed |
| Events | 八个正式 domain 按现有入口审计 success/failed/cancelled/approval；具备的入口全覆盖，缺失入口显式记录适用性/缺口；正文、路径、Key、transcript 为零 |
| Branch | 多父、线性 supersede、删除/恢复、并发冲突、显式 human resolution；domain revision 不串 |
| Effective | current/unknown/conflict 三态完整；缺证据不补值；reducer 确定性、可重建、无副作用 |
| LAN | offline A/B、乱序、重复、断线重连、签名/Workspace 拒绝；文件 frame 与 state fact 分账 |
| Lifecycle | 重启、切 Workspace、窗口关闭、迟到结果、损坏账、CAS 失败均无幽灵 owner |
| Regression | W63–W85 关系/事件/Context 合同、W94A–D、full npm test、build、dist、provenance、secret、release |

## 7. Final Gate

W94E 只有在以下条件全部满足后才可写 PASS：

- Source/Packaged 的 query、Branch、Effective State、LAN state 证据同代；
- A/B Workspace、离线并发、多父关系、删除/恢复、冲突重放和显式 resolution 全绿；
- 八个 domain 的事件覆盖可审计；具备入口的 outcome 映射完整，缺失入口保留精确适用性/缺口；所有资源/临时 owner/监听器归零；
- 无正文、路径、凭据或 hidden word/token/file-count gate 进入协议；
- W94A–D 与 full regression/build/dist 仍为 PASS。

未满足时只能写 PARTIAL/BLOCKED，保留失败事实与精确复开条件；不得把纯函数已有测试、
UI 显示或文件同步成功缩小口径成 W94E 完成。
