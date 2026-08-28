# W94Ga World Runtime 检查点（2026-08-28）

> 状态：**PASS（本地 World；不含 Hub 公网写入）**
> 上位施工参照：[`W94G_WORLD_HUB_PUBLIC_PLANE_SPEC.md`](./W94G_WORLD_HUB_PUBLIC_PLANE_SPEC.md)
> 总计划：[`W94_UNIFIED_CAPABILITY_ARTIFACT_AND_PUBLIC_PLANE.md`](../plans/W94_UNIFIED_CAPABILITY_ARTIFACT_AND_PUBLIC_PLANE.md)

## 1. 本波边界

W94Ga 只交付本地 World Store 与 Canon 审阅/合并最小切片：

- `.mazz/world/store.json` 的 Workspace-scoped schema、state hash、previous hash、atomic replace 与 CAS；
- World create、Root Branch、Community Branch fork、Canon Proposal、human Review、partial/complete Merge；
- Branch effective-state 复用 `BranchEffectiveStateService`，不复制“最后写入即 Canon”语义；
- 主进程/preload 的 `world:*` 窄 IPC；
- Source/Packaged 的 Workspace A/B 隔离、close/reopen 恢复与 public-safe snapshot。

明确不在本波：真实 Hub、DNS/TLS、Publication Grant、公共排行榜、支付、推荐、公共 Watch Room，以及任何公网写入。

## 2. 实现落点

| 面 | 落点 |
| --- | --- |
| World runtime | [`main/world-runtime-service.js`](../../main/world-runtime-service.js) |
| main assembly | [`main/main.js`](../../main/main.js) |
| preload allowlist | [`preload/bridge.js`](../../preload/bridge.js) |
| contract | [`tests/contract/w94ga-world-runtime.test.mjs`](../../tests/contract/w94ga-world-runtime.test.mjs) |
| Source/Packaged E2E | [`tests/e2e/w94ga-world-runtime.mjs`](../../tests/e2e/w94ga-world-runtime.mjs) |

## 3. 每波必查结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| schema/unknown/private/path/URL 字段拒绝 | **PASS** | W94Ga contract `2/2` |
| branch identity、fork、revision/CAS | **PASS** | contract + Branch store |
| proposal → human review → partial/complete merge | **PASS** | contract + Source/Packaged E2E |
| Root Canon 与 Community Branch 分离 | **PASS** | 两个 branch；effective fact 仅在显式 merge 后进入 Root |
| Workspace A/B 隔离 | **PASS** | A `1` → B `0` → A `1` |
| close/reopen 恢复 | **PASS** | restart World `1`，Proposal `merged` |
| Source runtime | **PASS** | [`W94GA_WORLD_SOURCE.json`](./evidence/W94GA_WORLD_SOURCE.json)、[`W94GA_WORLD_SOURCE.png`](./evidence/W94GA_WORLD_SOURCE.png) |
| Packaged runtime | **PASS** | [`W94GA_WORLD_PACKAGED.json`](./evidence/W94GA_WORLD_PACKAGED.json)、[`W94GA_WORLD_PACKAGED.png`](./evidence/W94GA_WORLD_PACKAGED.png) |
| network/public effect | **PASS_WITH_SCOPE** | network calls `0`；本波没有公网写入 |
| resource cleanup | **PASS** | active external-tool processes `0`；`runtimeErrors=[]` |

## 4. 可复验命令与回归

```text
node --check main/world-runtime-service.js
node --check main/main.js
node --check preload/bridge.js
node --test tests/contract/w94ga-world-runtime.test.mjs
node tests/e2e/w94ga-world-runtime.mjs
npm run dist:dir
node tests/e2e/w94ga-world-runtime.mjs --executable "release/win-unpacked/Mazz Editor.exe"
npm test
```

定向合同为 `2/2`；Source/Packaged E2E 均 PASS；构建与目录打包均 PASS；全量回归为
`280/282` 个测试文件通过。剩余两个失败是既有 W71 release foundation 与 W72c OSS
provenance ledger drift，未由 W94Ga 引入，也不在本检查点隐瞒。

## 5. 结论与下一波

W94Ga 可写入总计划为 **PASS**。它只证明本地 World 创作上下文和 Canon 审阅/合并边界，
不证明 Hub 已上线或拥有公共发布权。下一波是 W94Gb：先用同一 envelope/command/receipt
做本地 fake Hub 的 `prepare → publish → query → withdraw → sync`，仍不得触碰真实公网；
W94Gc 再单独处理服务器、DNS/TLS、备份恢复和事故演练。
