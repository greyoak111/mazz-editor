# W94D Blender External Capability 施工与验收规格

> 状态：**PASS / CHECKPOINTED / W94E NEXT**  
> 版本：v0.1  
> 日期：2026-08-26  
> 前置检查点：[W94A Capability Execution Spine](./W94A_CAPABILITY_EXECUTION_SPINE_CHECKPOINT_2026-08-25.md)、[W94B Calc + Chart Artifact](./W94B_CALC_CHART_ARTIFACT_CHECKPOINT_2026-08-26.md)、[W94C Canvas Agent Construction](./W94C_CANVAS_AGENT_CONSTRUCTION_CHECKPOINT_2026-08-26.md)  
> 总施工参照：[W94 Unified Capability, Artifact & Public Plane](../plans/W94_UNIFIED_CAPABILITY_ARTIFACT_AND_PUBLIC_PLANE.md)  
> 完成检查点：[W94D Blender External Capability 检查点](./W94D_BLENDER_EXTERNAL_CAPABILITY_CHECKPOINT_2026-08-26.md)

## 1. 本波裁决

W94D 把已存在的 W79 Blender Headless 外部工具适配器接入 W94A 的
`Capability Registry → Proposal → Lease → Adapter → Receipt → Artifact` 耐久脊柱。
Blender 是独立安装的外部能力，不打包进 Mazz，不由 Mazz 下载，也不取得公共面权限。

```text
durable .blend Artifact Ref
        ↓ exact scene schema + hash/type verification
Workspace-contained run-* staging
        ↓ fixed Mazz-owned Python capability script
Blender external process (probe/version/timeout/cancel/process-tree)
        ↓ output format + content hash verification
Artifact Store publish → Receipt → one-time grant/readback
```

本波不开放任意 Blender Python、shell、环境变量、绝对路径、网络、下载、公共发布或
GPU 资源控制；不新增字数、token、文件数、图层数或输出大小业务门限。

## 2. 冻结 Descriptor 与输入/输出合同

Capability Descriptor：

```json
{
  "capabilityId": "mazz.blender.external",
  "version": "1.0.0",
  "adapterId": "mazz.blender.external-process",
  "kind": "blender",
  "executionPlane": "external-process",
  "inputSchemas": ["mazz.blender-scene/v1"],
  "outputSchemas": [
    "mazz.blender-render/v1",
    "mazz.blender-inspection/v1",
    "mazz.blender-export/v1"
  ],
  "determinism": "external",
  "safetyClass": "external-write",
  "cancelMode": "process-tree",
  "resumeMode": "restart"
}
```

Proposal 只允许：

```json
{
  "inputs": [{
    "artifactId": "artifact-…",
    "contentHash": "sha256-…",
    "role": "scene",
    "schema": "mazz.blender-scene/v1"
  }],
  "parameters": { "operation": "scene.render.frame/v0" },
  "expectedOutputs": ["mazz.blender-render/v1"],
  "constraints": {}
}
```

`scene` Artifact 必须是已持久、完整哈希、`application/x-blender` 的 `.blend` 内容；
适配器不会接受输入路径或用户脚本。三种最小 operation：

| operation | output role/type | Artifact kind/schema |
| --- | --- | --- |
| `scene.render.frame/v0` | `frame` / `image/png` | `blender-render` / `mazz.blender-render/v1` |
| `scene.inspect/v0` | `report` / `application/json` | `blender-inspection` / `mazz.blender-inspection/v1` |
| `scene.export.obj/v0` | `model` / `model/obj` | `blender-export` / `mazz.blender-export/v1` |

## 3. 外部工具边界

- `main/external-tools/blender-headless-adapter.js` 复用 W79 的探测、版本回执、路径
  containment、输出校验、timeout、取消、partial 证据与进程树收尸；扩展 operation
  表，不改变既有 `scene.render.frame/v0` 合同。
- `resources/tools/blender/mazz_blender_capability.py` 是 Mazz-owned 固定脚本：渲染、
  inspect、OBJ 导出只由白名单 mode 选择；不把 proposal、Agent 或 Renderer 的字符串
  拼进 Python。打包态脚本位于 `asarUnpack` 的 `resources/tools/blender/`。
- Blender 探测只输出 availability、版本和稳定 evidenceRef；不可用时 proposal 被拒绝，
  不下载、不 fallback、不把安装文件存在冒充授权。
- Receipt 记录 runtime/toolVersion/operation/executionPlane/graphics 摘要；不写入用户
  绝对路径、完整命令行、Key、Cookie、Bearer 或原始私有正文。

## 4. Artifact Ref、staging 与发布

每次执行建立：

```text
<workspace>/.mazz/capability-blender/staging/run-*/
  inputs/scene.blend
  outputs/result.png | result.json | result.obj
```

- staging、输入、输出目录都必须是 Workspace 内物理目录；拒绝 symlink/reparse、越界、
  绝对路径和覆盖已有输出。
- 输入由 Artifact Store `open(storageRef, expectedHash)` 流式物化，使用 `wx`、hash、
  fsync 后才交给 Blender；输出先按 PNG/JSON/OBJ 校验并计算完整 SHA-256，再以
  `publishReadable` 原子进入 Artifact Store。
- 输出 Artifact 保留 `sourceArtifacts=[sceneArtifactId]`、contentHash、contentSchema、
  storageRef 和 `createdByReceiptId`；Renderer 只拿一次性 grant，不拿文件系统路径。
- 正常结束、失败、取消、应用退出和外部进程崩溃都必须清理 run staging；partial 输出只
  留在本次 run 的临时语义中，不能冒充正式 Artifact。

## 5. 取消、失败、恢复与资源

- 取消由主进程 `CapabilityExecutionService` 发起：先登记 Lease cancel-requested，再
  调用 adapter process-tree terminate，最后持久化 `CAPABILITY_CANCELLED` Receipt。
- 版本探针、Artifact 物化与 Blender spawn 之间存在取消竞态；启动态 run 记录、单次
  cancel promise 与 materialize 后 signal 闸保证取消不会启动一个无人收尸的 Blender。
- 非零退出、输出缺失/类型错误、hash drift、脚本缺失、工作区越界和磁盘失败分别留在
  durable failure/diagnostic 事实；失败不提交正式输出 Artifact。
- App restart 不自动重放 Blender 副作用；未完成 Lease 进入 W94A recovery 语义，下一次
  执行必须由新的 Proposal 明确发起。
- 退出门验证 Capability active、`external-tool-process`、Artifact stream、staging、
  listeners、timers 和 process handles 全归零。

## 6. 安全与非目标

拒绝：任意 Python/JavaScript、shell/env 注入、用户 commandPrefix、绝对/越界输入输出、
symlink/reparse、未知 operation/schema、错误媒体类型、旧 hash、输出覆盖、网络访问、
自动安装和公共发布。

本波不声称：Blender 版本全矩阵、复杂材质/纹理资产编排、GPU 渲染一致性、动画批处理、
远程 Blender、Marketplace、Hub 或 Player 传输；这些必须另立波次和合同。`external`
determinism 明确表示 Blender 版本、系统字体、GPU/CPU 和场景环境会影响结果。

## 7. 必查矩阵

1. Descriptor：三 operation、版本/可用态、external-process、provenance、无网络/无打包。
2. Artifact：`.blend` schema/type/hash、stream materialize、source lineage、一次性 grant。
3. Output：PNG magic、JSON object、OBJ header、完整 content hash、三类 mediaType/schema。
4. Fault：missing/hash/type/path、非零崩溃、partial、timeout/SLEEP、取消、输出漂移、
   staging/reparse、磁盘/发布失败。
5. Resource：W79 supervisor、W94D adapter、Capability Lease、Artifact Store staging、
   process tree、handles/listeners 在每次执行和 app quit 后归零。
6. Runtime：fixture Source + Packaged；真实 Blender 5.2 opt-in Source + Packaged；均从
   同一 `.blend` 产出并重新读取 Artifact。
7. Regression：W79、W94A/B/C 相邻合同、full `npm test`、build、`dist:dir`、provenance、
   secret audit、release audit。

## 8. Final Gate

W94D 只有在 fixture 与真实 opt-in、三 operation、故障/取消/收尸、Source/Packaged、全量
回归、构建和隐私/provenance 证据全部同代且为 PASS 时，才能推进到 W94E。任何资源未归零、
真实工具失败或证据缺失都保持 `PARTIAL/BLOCKED`，不得缩小口径结案。
