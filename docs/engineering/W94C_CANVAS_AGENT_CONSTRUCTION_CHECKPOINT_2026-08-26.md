# W94C Canvas Agent Construction 检查点

> 结论：**PASS / CHECKPOINTED / W94D NEXT**  
> 日期：2026-08-26  
> 施工规格：[W94C Canvas Agent Construction](./W94C_CANVAS_AGENT_CONSTRUCTION_SPEC.md)  
> 总施工参照：[W94 Unified Capability, Artifact & Public Plane](../plans/W94_UNIFIED_CAPABILITY_ARTIFACT_AND_PUBLIC_PLANE.md)

## 1. 结论

W94C 已将 Canvas 的结构化文档、Operation、revision/CAS、durable receipt、撤销/重做和 deterministic SVG Artifact 接入主进程 Workspace 真相。Agent/Renderer 只能走严格结构化 operation；没有 JS、DOM/Canvas 指令、绝对路径或 data URL 旁路。

本检查点只结算 W94C 已落地边界，不把 Mask、Boolean、Mindmap/Slide 适配、Blender 或公共 Hub 施工冒充完成。下一精确波次为 W94D Blender External Capability。

## 2. 已落地文件与链路

- `main/canvas-document-contract.js`：Document/Operation/Receipt/Export schema，节点图引用、group 环、几何、actor、secret/path/URI 和 operationHash 校验。
- `main/canvas-document-store.js`：Workspace 绑定的 `documents/receipts/exports/locks/staging`，锁 + CAS + temp fsync + rename + directory fsync；启动清理 orphan staging、回收确认死亡 owner 的锁，腐败 record 阻断读取/变更。
- `main/canvas-document-service.js`：主进程服务、Artifact Ref 存在性检查、SVG 发布、一次性 export grant。
- `main/canvas-document-ipc.js`、`main/main.js`、`preload/bridge.js`：trusted shell/current Workspace/startup gate 的窄桥与 `mazz-res://canvas-artifact` 流式读取。
- `main/canvas-svg-exporter.js`：六类节点的确定性 SVG；转义文本，拒绝脚本、foreignObject、外部 URL 和事件属性。
- `renderer/lib/canvas-agent.js`：结构化 Canvas client/operation helper。
- `renderer/modules/draw/model.js`、`renderer/modules/draw/index.js`：legacy Draw frame fork adapter、显式 bridge-backed save/apply/undo/redo；非法/重复 legacy ID 会净化且不碰原文件。

Durable layout：

```text
<workspace>/.mazz/canvas-documents/
  documents/<documentId>.json
  receipts/<receiptId>.json
  exports/<exportId>.json
  locks/<documentId>.lock
  staging/<owner>.part
```

本波未新增图层数、节点数、文本长度、输出字节数、token 或业务条目门限；只保留 schema、路径、SVG、磁盘和进程资源安全边界。

## 3. 验证矩阵

| 门 | 结果 | 证据 |
|---|---|---|
| W94C targeted contract | **8/8 PASS** | `tests/contract/w94c-canvas-agent.test.mjs` |
| Full regression | **274/274 test files PASS** | `npm test` |
| Source runtime | **PASS**：create/insert/update/undo/redo/reopen/export，revision `5`，grant 单次消费，network `0`，runtime errors `0` | [W94C Canvas Source](./evidence/W94C_CANVAS_SOURCE.json) |
| Packaged runtime | **PASS**：同一断言集运行于 `release/win-unpacked` | [W94C Canvas Packaged](./evidence/W94C_CANVAS_PACKAGED.json) |
| Build / packaged directory | **PASS** | `npm run build`、`npm run dist:dir` |
| Static syntax | **PASS** | W94C CJS/ESM `node --check` |
| Provenance | **CURRENT / PASS_REPOSITORY_PROVENANCE_BASELINE** | `npm run audit:provenance` |
| Secret audit | **PASS** | `npm run audit:secrets` |
| Release audit | **PASS** | `npm run audit:release` |
| W71 census | **PASS** | `npm run audit:w71:census` |

定向测试覆盖：所有节点类型/几何与引用拒绝、actor 路径/URI、insert/update/remove/reorder/set-selection/replace-document、affected IDs、selection precondition、stale CAS、同 operation 幂等与冲突、undo/redo、重启、orphan staging/dead lock、损坏记录、SVG 安全、Artifact Ref 验证、一次性 export grant、legacy Draw ID 净化。

## 4. 运行证据与资源边界

- Source 与 Packaged 均在真实 Electron 中重启读取同一文档 revision；不是 Node mock 或 jsdom Canvas fallback。
- 导出只返回 Artifact descriptor 与 grant；SVG 正文经 `mazz-res` 流式读取，不进 Receipt、IPC 大对象或 Base64。
- 第二次消费同一 grant 失败；staging 为零；运行过程没有外网请求。
- `NODE MODULE_TYPELESS_PACKAGE_JSON`、Playwright `DEP0190`、npm mirror 配置弃用和既有 jsdom Canvas warning 是现有测试环境噪声，不被写成 W94C 功能证据。

## 5. 未完成边界（明确留给后续）

- Mask、Boolean operation、复杂矢量布尔几何和 Mindmap/Slide 统一 Canvas adapter 未在 W94C 声称落地。
- Draw 既有 PNG/ORA/Canvas 像素导出继续是兼容路径；W94C 权威事实是结构化 Document + SVG Artifact。
- Blender 5.2 的真实外部能力、进程/临时目录收口和 Source/Packaged Blender roundtrip 属于 W94D。

## 6. 关键文件 SHA-256

| 文件 | SHA-256 |
|---|---|
| `main/canvas-document-contract.js` | `33D7B22D40BEFB16C3311AF5BC46A3D9D1734CD606E8D2E8CA0FAD12FD83631C` |
| `main/canvas-document-store.js` | `32540F6957B4B44BE5351D309DF428B4C5D8F4EE9224DDE96057AF97397F17C5` |
| `main/canvas-document-service.js` | `4D1670093D96421C5E2ED010ED535E06BE2636B36029343FDA1E8EAF07618DD6` |
| `main/canvas-document-ipc.js` | `828F39346383AEE21527D38384A6378132D0DCD81420FAA0E9C385DA64186881` |
| `main/canvas-svg-exporter.js` | `B244B4EC5DC269471D36F70144AE9E6C63423A5C92E546B946F3AB663604455E` |
| `renderer/lib/canvas-agent.js` | `591A3D0309A7005AD5FDE62C4CF4CB13F730849182C9C45136497E0EB6DA1CCA` |
| `renderer/modules/draw/model.js` | `65432C6C2C356B01C1A2F372A1C897DDF8075B1ECD28BD6E32B492F8C146B5D1` |
| `renderer/modules/draw/index.js` | `410E48FE26EF5AB1285D1CACD7CAFF415969F15C1092A30536E58E61E7EFD39E` |
| `tests/contract/w94c-canvas-agent.test.mjs` | `D3BB619C3A1D75EE857877241E125EFD8B68C849A42676D3F02464305033B342` |
| `tests/e2e/w94c-canvas-runtime.mjs` | `3CD49CC2F785B5A424A7A2CCE8016A4556153B17B3EFECE74070C4ECB7A5F9B8` |

**W94C PASS。** 下一精确波次只有 **W94D Blender External Capability**；本检查点不授权 Player、World、Hub 或其他旁路能力越过 W94A/B 的 Proposal/Artifact/Receipt 边界。
