# W94Gb Publication / Fake Hub 检查点（2026-08-28）

> 状态：**PASS_WITH_SCOPE（本地 fake Hub；不含真实公网写入）**
> 上位施工参照：[`W94G_WORLD_HUB_PUBLIC_PLANE_SPEC.md`](./W94G_WORLD_HUB_PUBLIC_PLANE_SPEC.md)
> 总计划：[`W94_UNIFIED_CAPABILITY_ARTIFACT_AND_PUBLIC_PLANE.md`](../plans/W94_UNIFIED_CAPABILITY_ARTIFACT_AND_PUBLIC_PLANE.md)

## 1. 本波边界

W94Gb 只实现同一 `envelope/manifest/grant/command/receipt` 语义下的本地 fake Hub：

- `preparePublication`：校验公开包络、内容寻址 manifest、Rights/Grant 和签名范围；
- `publishPublication`：显式 Grant + human authority 后幂等写入公共投影；
- `syncPublication`：按 Publication identity 读取当前公共状态；
- `withdrawPublication`：撤回公共投影，不删除本地 World、Artifact、字节或 Receipt；
- `Workspace A/B`、持久 Store、CAS、坏文件拒绝和 close/reopen 恢复。

明确不在本波：真实 HTTP/HTTPS、DNS、Cloudflare、生产账号、支付、推荐、排行榜、公共 Watch Room、
私有 World 同步和任意本地字节上传。fake Hub 通过不能解读为 `www.mazz-hub.com` 已上线。

## 2. 实现与证据

| 面 | 落点 |
| --- | --- |
| fake Hub runtime | [`main/world-hub-publication-service.js`](../../main/world-hub-publication-service.js) |
| main/preload wiring | [`main/main.js`](../../main/main.js) · [`preload/bridge.js`](../../preload/bridge.js) |
| contract | [`tests/contract/w94gb-publication-hub.test.mjs`](../../tests/contract/w94gb-publication-hub.test.mjs) |
| Source E2E | [`W94GB_HUB_SOURCE.json`](./evidence/W94GB_HUB_SOURCE.json) · [`W94GB_HUB_SOURCE.png`](./evidence/W94GB_HUB_SOURCE.png) |
| Packaged E2E | [`W94GB_HUB_PACKAGED.json`](./evidence/W94GB_HUB_PACKAGED.json) · [`W94GB_HUB_PACKAGED.png`](./evidence/W94GB_HUB_PACKAGED.png) |

## 3. 每波必查结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| unknown/private/path/URL 字段拒绝 | **PASS** | contract `2/2` |
| Grant active/scope/expiry/rights identity | **PASS** | contract + E2E negative paths |
| manifest/content IDs/contentRoot 一致 | **PASS** | contract + E2E |
| signatureRef 与 envelope/grant 绑定 | **PASS** | contract unsigned/signature mismatch |
| prepare → publish → query → withdraw → sync | **PASS** | Source/Packaged E2E |
| publish/withdraw 幂等与 stale CAS | **PASS** | contract |
| Workspace A/B 与 restart | **PASS** | A `1` → B `0` → A `1`；restart `1` |
| 公共投影不持有 sourceArtifactRefs、路径或 URL | **PASS** | contract + E2E `publicFieldsOnly=true` |
| network/public effect | **PASS_WITH_SCOPE** | `networkCalls=0`；fake Hub only |
| resource cleanup | **PASS** | active external-tool processes `0`；`runtimeErrors=[]` |

## 4. 可复验命令与回归

```text
node --check main/world-hub-publication-service.js
node --check main/main.js
node --check preload/bridge.js
node --test tests/contract/w94gb-publication-hub.test.mjs
node tests/e2e/w94gb-publication-hub-runtime.mjs
npm run dist:dir
node tests/e2e/w94gb-publication-hub-runtime.mjs --executable "release/win-unpacked/Mazz Editor.exe"
```

W94Gb 定向 contract 为 `2/2`；Source/Packaged E2E、build、dist 均通过。

## 5. 结论与下一波

W94Gb 可写入总计划为 **PASS_WITH_SCOPE**。它证明公共投影边界和撤回/重同步语义，
不证明真实服务器、TLS、DNS 或生产 Hub 已经具备。下一波 W94Gc 必须先完成服务器只读基线、
部署用户/权限、进程与 TLS/health/runbook 证据；没有这些证据不得把域名 200 或 Cloudflare 页面当真相。
