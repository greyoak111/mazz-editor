# W94C Canvas Agent Construction 施工与验收规格

> 状态：**PASS / CHECKPOINTED / W94D NEXT**
> 版本：v0.1
> 日期：2026-08-26
> 前置检查点：[W94A Capability Execution Spine](./W94A_CAPABILITY_EXECUTION_SPINE_CHECKPOINT_2026-08-25.md)、[W94B Calc + Chart Artifact](./W94B_CALC_CHART_ARTIFACT_CHECKPOINT_2026-08-26.md)
> 总施工参照：[W94 Unified Capability, Artifact & Public Plane](../plans/W94_UNIFIED_CAPABILITY_ARTIFACT_AND_PUBLIC_PLANE.md)
> 本波范围：把 Draw/Canvas 的结构化文档、Agent operation、revision/CAS、撤销/重做与可重放 SVG 导出接入主进程耐久真相；不施工 Blender、Player、World 或 Hub。
> 完成检查点：[W94C Canvas Agent Construction 检查点](./W94C_CANVAS_AGENT_CONSTRUCTION_CHECKPOINT_2026-08-26.md)

## 1. 当前真实断点

1. `renderer/modules/draw/model.js` 的文档与 `SnapshotStack` 只在 Renderer 内存中，历史默认 40 步，重启、跨窗口和并发 revision 没有 durable truth。
2. `renderer/modules/draw/index.js` 的指针事件直接修改 layer/stroke/shape/image；没有结构化 operation、affected IDs、precondition、inverse 或 operation receipt。
3. 现有 PNG/ORA 导出依赖 Canvas/base64；它可以继续作为兼容导出，但不能代替可重放的 Canvas document 和 Artifact Ref。
4. `main/visual-composition.js` 是窗口/视图合成状态，不是用户 Canvas 文档；不得把 transient surface 当作 Draw 图层真相。

## 2. 本波裁决

```text
Canvas Document + Layer/Node
        ↓ strict normalize + document revision
structured Operation + precondition + inverse
        ↓ trusted main IPC / workspace CAS
durable Canvas Store → Operation Receipt → revision
        ↓
W94B Artifact Store: deterministic SVG export / Artifact Ref
        ↓
Renderer Draw/Canvas presentation and replay
```

- 主进程 Workspace Store 是 Document、Operation Receipt、revision 与 export record 的唯一事实源。
- Agent 只能提交结构化 operation；不能提交 JS、Canvas 2D 指令、DOM selector、任意文件路径或 data URL。
- 人工与 Agent 共享同一个 `expectedRevision` CAS；过期 revision 必须返回冲突与当前 snapshot，不得静默覆盖。
- 旧 `mazzdraw`/PNG/ORA 文件保留兼容打开与导出；首次接入 W94C 时 fork 为 v1 Document，不原地改写未知格式。
- W94C 的确定性导出为 SVG Artifact；PNG/ORA 仍是兼容导出，不作为 Canvas 事实。
- 不设置图层数、节点数、文本长度或导出字节数业务门限；只保留 schema、路径、SVG 安全、磁盘与进程资源安全边界。

## 3. 冻结合同

### 3.1 `mazz.canvas-document/v1`

```json
{
  "schema": "mazz.canvas-document/v1",
  "documentId": "canvas-doc-…",
  "workspaceIdentity": "workspace-…",
  "revision": 1,
  "title": "",
  "width": 960,
  "height": 540,
  "background": "#ffffff",
  "layers": [
    { "layerId": "layer-…", "name": "Layer 1", "visible": true, "opacity": 1, "nodeIds": ["node-…"] }
  ],
  "nodes": {
    "node-…": {
      "nodeId": "node-…",
      "kind": "rect|ellipse|path|text|image|group",
      "x": 0, "y": 0, "width": 100, "height": 100,
      "rotation": 0, "opacity": 1, "visible": true,
      "fill": "#ffffff", "stroke": "#000000", "strokeWidth": 1,
      "text": "", "points": [], "assetRef": null
    }
  },
  "selection": [],
  "headOperationId": null
}
```

Required invariants:

- document/layer/node IDs are opaque native strings; duplicate, padded, boxed or toJSON IDs fail closed.
- every layer nodeId references exactly one node; every node appears in exactly one layer or an explicit group child list.
- all geometry and opacity are finite canonical numbers; colors are concrete safe hex values; text is plain text, never HTML/SVG markup.
- `assetRef` may only be a previously durable W94B Artifact Ref; absolute paths, data URLs, filesystem URLs and secrets are rejected.
- unknown document schema is inspect-only and cannot receive an operation.

### 3.2 `mazz.canvas-operation/v1`

```json
{
  "schema": "mazz.canvas-operation/v1",
  "operationId": "canvas-op-…",
  "documentId": "canvas-doc-…",
  "expectedRevision": 3,
  "actor": { "kind": "human|agent", "ref": "human:…" },
  "kind": "insert|update|remove|reorder|set-selection|replace-document",
  "affectedIds": ["node-…"],
  "precondition": { "nodeRevisions": {}, "selectionHash": null },
  "payload": {},
  "inverse": {}
}
```

- `payload` is kind-specific plain data; no executable string, function, DOM/Canvas command or path.
- `affectedIds` must exactly cover payload targets; precondition mismatch returns `CANVAS_PRECONDITION_FAILED`.
- `inverse` is generated and normalized by the main service; Renderer/Agent cannot self-authorize an arbitrary inverse.
- an accepted operation appends an immutable receipt with before/after revision, actor, affected IDs, operation hash and result document hash.

### 3.3 `mazz.canvas-operation-receipt/v1`

```json
{
  "schema": "mazz.canvas-operation-receipt/v1",
  "receiptId": "canvas-receipt-…",
  "documentId": "canvas-doc-…",
  "operationId": "canvas-op-…",
  "operationHash": "sha256-…",
  "beforeRevision": 3,
  "afterRevision": 4,
  "actor": { "kind": "agent", "ref": "agent:…" },
  "affectedIds": ["node-…"],
  "documentHash": "sha256-…",
  "inverseHash": "sha256-…",
  "createdAt": "…"
}
```

Receipts are immutable. Replaying the same operationId with the same document/intent is idempotent; the same operationId with different payload or revision is a conflict.

## 4. Durable store and state machine

```text
<workspace>/.mazz/canvas-documents/
  documents/<documentId>.json
  receipts/<receiptId>.json
  exports/<exportId>.json
  locks/<documentId>.lock
  staging/<owner>.part
```

Document transitions:

```text
new → ready → applying → ready
ready → exporting → ready
ready → conflicted (read-only until caller refreshes)
```

- document writes use lock + expectedRevision CAS + temp fsync + exclusive rename + directory fsync; no copy fallback.
- crash recovery scans all records; a half-written or schema-invalid record blocks mutations for that document and preserves original bytes for repair.
- undo is a durable inverse operation against the current revision; redo is a durable replay of the inverse pair. Both are ordinary receipts and obey CAS.
- no automatic replay of an uncommitted operation after restart; only a durable receipt can advance revision.
- document lock owner, operation runner, export stream and staging temp must be zero after cancel, close and restart.

## 5. Operation and security boundary

Allowed minimum operations:

- `insert`: create a typed node and attach it to an existing layer.
- `update`: update a declared subset of one node's geometry/style/text.
- `remove`: remove a node and preserve inverse data in the receipt.
- `reorder`: move existing node IDs within one layer.
- `set-selection`: replace selection by existing node IDs only.
- `replace-document`: only for explicit human import/fork, with full document hash and no path/data URL.

Rejected:

- arbitrary JavaScript/Python, CanvasRenderingContext2D calls, DOM selectors, event injection, CSS URL, `<foreignObject>`, script/event attributes, external fonts and remote images;
- direct absolute Workspace/path access, untrusted Artifact IDs, unknown node kinds and cross-document node references;
- stale revisions, missing affected IDs, hidden-layer writes without explicit human authority, and operation payloads that mutate IDs or revision.

## 6. Deterministic SVG export

- Export consumes a normalized document snapshot, never live DOM or Canvas pixels.
- Node and layer order, transforms, colors, text escaping and numeric serialization are canonical.
- SVG has no script, foreignObject, external URL, event attribute, CSS variable, current time or random value.
- Export publishes a W94B Artifact with `mazz.canvas-svg/v1`, source document hash and source revision; a later document edit creates a new export, never mutates the old Blob.

## 7. Product integration

- Draw presentation may keep its existing pointer/Canvas renderer, but new durable save/apply/undo/redo calls must go through the narrow Canvas IPC and receive the committed revision/receipt.
- Draw model gains an adapter from legacy `mazzdraw` frame/layer/stroke/shape/image data to the v1 document; unknown raster/data URL portions remain compatibility-only and cannot be sent as Agent operations.
- Chart SVG and other W94B Artifact refs may be inserted as `image`/`group` nodes by Artifact Ref, never by copying base64 or absolute paths.
- Mindmap and Slide surfaces can consume the same document/operation contract in later adapters; W94C does not rewrite their existing file formats.

## 8. Mandatory matrix

1. Schema: every node kind, malformed IDs, unknown fields, secret/path/data URL, invalid geometry and cross-layer references.
2. Operation: insert/update/remove/reorder/selection, affected IDs, precondition, inverse and deterministic receipt.
3. CAS: stale revision, same operation replay, same operationId with changed payload, concurrent A/B writers.
4. Durable roundtrip: create → apply → undo → redo → close → reopen → replay; hashes and revisions identical.
5. Fault: crash before/after temp write, rename/fsync failure, corrupt record, external file replacement, cancel/export failure.
6. Export: canonical SVG, six node kinds, escaping, no unsafe SVG constructs, stable hash, Artifact Ref lineage.
7. Product: Draw legacy import/fork, renderer bridge, selection/undo/redo and old file compatibility.
8. Resource: lock, timer, stream, staging, renderer listener and export owner return to zero.
9. Source/Packaged: real document creation/edit/undo/redo/reopen/export, runtime errors `0`, network `0`.
10. Regression: W94A/B, Draw/Mindmap/Slide contracts, full `npm test`, build, dist, provenance and secret audit.

## 9. Final Gate

W94C may be marked PASS only when:

- the main durable Canvas Store, operation receipts and CAS are in production path;
- Draw has a real bridge-backed save/apply/undo/redo roundtrip, while legacy files remain readable;
- deterministic SVG export is a W94B Artifact Ref and never a base64/path shortcut;
- stale/conflicting/unsafe operations fail closed without mutating the document;
- targeted, adjacent, full, build/dist, Source/Packaged, privacy/provenance and resource gates are green with a checkpoint;
- only then does the master table advance to W94D Blender External Capability.
