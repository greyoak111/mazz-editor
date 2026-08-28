# W94H Capability / Public Convergence 检查点（2026-08-28）

> 结论：**PARTIAL / BLOCKED**。本检查点完成收口审计与已授权 staging 部署，不宣称 W94 完成。

## 已完成

- W94Ga 本地 World Store 与 Source/Packaged restart/A-B 证据保持 PASS。
- W94Gb fake Hub contract `2/2`，Source/Packaged runtime 均通过，public-safe envelope/manifest/grant/receipt、withdraw、sync、CAS、私有字段拒绝均有证据。
- W94Gc 在 `167.160.161.115` 完成隔离 `mazzhub` 用户、Node.js 18、nginx、systemd、UFW（22/80/443），origin 只绑定 `127.0.0.1:3210`。
- `https://www.mazz-hub.com/healthz` 与 public snapshot 实测 200；publish 在 staging 实测 403 `HUB_PUBLIC_EFFECT_DISABLED`。ACME 证书只覆盖 `www.mazz-hub.com`，有效期至 2026-11-26。
- 本地 origin runtime 与公网 staging runtime 均留下 JSON 证据；服务器不接收 Workspace、私钥、草稿或 transcript。
- 以独立 `mazzhub` 权限在 localhost:3211 做 prepare → publish → stop → backup → remove → restore 演练；恢复后 projection 为 `published`，store SHA-256 保持 `a34901ab230e9f737f00d9a6f361442c8b407d1c6fd3e26d65d64a6869eeac9b`。详见 [`W94GC_SERVER_RECOVERY.json`](./evidence/W94GC_SERVER_RECOVERY.json)。
- W94H seal contract 保持失败关闭；`completeClaim=false`、`publicEffectAuthorized=false`。
- 最后一处代码改动后的全量 `node tests/run.js` 为 **285/285**；`npm run build` 与 `npm run dist:dir` 均通过，最终 packaged EXE SHA-256 为 `f452fbfdc65d6695c9f758619b4dba058b5de49fd7444bb2c4482bd01c1f348f2`。

## 未闭合

- 根域 `mazz-hub.com` 当前没有可用 A/AAAA 记录，无法把 apex 与 www 作为同一证书/入口验收。
- 已完成一次隔离恢复演练，但生产备份轮换/保留、缓存失效、回滚、资源/日志告警与 incident drill 仍未形成完整治理证据。
- W94Gb 的 `signatureRef` 目前是确定性 digest reference，不能充当生产 Ed25519 签名；服务器 staging 公共 effect 因此保持关闭。
- W94E formal event coverage 与 W94F public P2P/cross-machine scope 仍为 PARTIAL。

## 证据

- [`W94GC_SERVER_BASELINE.json`](./evidence/W94GC_SERVER_BASELINE.json)
- [`W94GC_SERVER_STAGING.json`](./evidence/W94GC_SERVER_STAGING.json)
- [`W94GC_ORIGIN_SOURCE.json`](./evidence/W94GC_ORIGIN_SOURCE.json)
- [`W94H_RELEASE_SEAL.json`](./evidence/W94H_RELEASE_SEAL.json)
- [`W94GB_PUBLICATION_HUB_CHECKPOINT_2026-08-28.md`](./W94GB_PUBLICATION_HUB_CHECKPOINT_2026-08-28.md)

## 本波命令记录

```text
npm run test:w94gc:runtime
npm run test:w94gc:staging
node --test tests/contract/w94gc-server-origin.test.mjs
node tests/run.js → 285/285
npm run build → PASS
npm run dist:dir → PASS
```

旧的 `280/282` 快照不作为本波结果。
