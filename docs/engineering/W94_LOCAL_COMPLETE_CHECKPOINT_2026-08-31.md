# W94 本地完成封板（2026-08-31）

> 结论：**W94 LOCAL COMPLETE / H-local PASS**
> 总公共结论：**PARTIAL/BLOCKED；`completeClaim=false`，`publicEffectAuthorized=false`**
> 只读证据边界：`docs/archaeology_v2/00–12` 未修改。

## 1. 封板口径

这里的“本地完成”覆盖 W94A–E、W94F 的本地 transport/Range/W93 bridge/双 Mazz loopback、
W94Ga World、W94Gb 本地 Publication/fake Hub，以及 W94H 的本地收口。它不把下面三类外部验收
伪装成本地代码欠账，也不由本地完成自动授权：

- 真实公网 P2P/DHT/Tracker 与公共 Watch Room；
- 两台物理机器的网络/时钟/防火墙/断网验收；
- W94Gc production Hub 的 DNS/TLS 同域、服务器 trust/rotation/revocation、监控、事故演练与公共 effect。

## 2. 最后一处本地贯通

```text
W94A immutable Capability Artifact
  → desktop World/Publication workbench
  → explicit human Publication Grant
  → local Ed25519 identity protected by Electron safeStorage
  → strict envelope + content-addressed manifest
  → W94Gb fake Hub prepare
  → explicit local projection publish
  → withdraw
  → close/reopen/replay
```

落点：

- `main/publication-signing-service.js`：Ed25519 私钥只以 safeStorage 保护结果落盘；IPC 不返回私钥；
- `main/local-publication-bridge-service.js`：从 Artifact Store 取 hash/size，renderer 不接触 blob path；
- `main/world-runtime-service.js`：补齐未裁决 Canon proposal 的人工 withdraw 与 `cancelled` event；
- `renderer/modules/world/index.js`：World/Branch/Proposal/Review/Merge/Withdraw 与 Publication 全生命周期产品入口；
- `renderer/modules/viewer/index.js`：用户明确选择媒体时记录 Player approval，不创造额外审批接口；
- `docs/engineering/evidence/W94E_DOMAIN_EVENT_COVERAGE.json`：按真实 domain lifecycle 审计，不强迫同步 Canvas 伪造 cancel。

## 3. 每波必查结果

| Gate | 结果 |
| --- | --- |
| W94A–D targeted | **PASS**；既有 Capability/Calc/Chart/Canvas/Blender 合同保持绿 |
| W94E targeted | **9/9 PASS**；八域 event coverage **PASS** |
| W94F adjacent | **3/3 + 2/2 + 5/5 + 3/3 PASS**；公网/物理跨机未启动 |
| W94G local contract | **9/9 PASS**；含 World withdraw、protected Ed25519、Artifact bridge、strict fake Hub |
| W94Ga Source/Packaged | **PASS/PASS**；A/B、restart、资源与 runtime error 通过 |
| W94Gb Source/Packaged | **PASS/PASS**；Ed25519 verified、publish/withdraw/sync、A/B、restart |
| desktop workbench Source/Packaged | **PASS/PASS**；World/Fork/Proposal withdraw + Publication prepare/publish/withdraw/restart |
| network/public effect | `networkCalls=0`、`publicEffectAuthorized=false` |
| build/dist | `npm run build`、`npm run dist:dir` **PASS** |
| packaged executable | SHA-256 `c4ebe9df4bec731e06393101c852d01f9336b3f04b413bd95566e0b322fc9fbd` |
| full regression | **287/287 PASS**；以 `W94H_FULL_REGRESSION.json` 与 code digest 为准 |
| release seal | `localStatus=PASS`、`localCompleteClaim=true`；总状态仍 `PARTIAL/BLOCKED` |

## 4. 运行与视觉证据

- [`W94G_LOCAL_WORKBENCH_SOURCE.json`](./evidence/W94G_LOCAL_WORKBENCH_SOURCE.json)
- [`W94G_LOCAL_WORKBENCH_SOURCE.png`](./evidence/W94G_LOCAL_WORKBENCH_SOURCE.png)
- [`W94G_LOCAL_WORKBENCH_PACKAGED.json`](./evidence/W94G_LOCAL_WORKBENCH_PACKAGED.json)
- [`W94G_LOCAL_WORKBENCH_PACKAGED.png`](./evidence/W94G_LOCAL_WORKBENCH_PACKAGED.png)
- [`W94GB_HUB_SOURCE.json`](./evidence/W94GB_HUB_SOURCE.json)
- [`W94GB_HUB_PACKAGED.json`](./evidence/W94GB_HUB_PACKAGED.json)
- [`W94H_FULL_REGRESSION.json`](./evidence/W94H_FULL_REGRESSION.json)
- [`W94H_RELEASE_SEAL.json`](./evidence/W94H_RELEASE_SEAL.json)

Packaged 工作台截图已人工核验：World 为 2 branches，Canon proposal 显示 `withdrawn`，Artifact 使用
`sha256` identity，Publication 显示本机 Ed25519 signer 与本地 projection 状态；截图没有 API key、
Bearer、Cookie、绝对用户路径、私钥或私有正文。

## 5. 外部复开条件

后续只能作为新的、显式授权波次复开：公网 P2P/物理跨机，或 W94Gc production Hub。复开时必须
重新做相应网络、权限、事故与 public-effect 审批；不得修改本封板把外部门写成“其实本地早已完成”，
也不得用外部门未验收否定已经可复验的本地完成。
