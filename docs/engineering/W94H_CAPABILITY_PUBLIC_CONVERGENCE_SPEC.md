# W94H Capability / Public Convergence Release Seal 施工参照

> 状态：**H-local PASS / 总公共 Seal PARTIAL/BLOCKED**
> 日期：2026-08-28
> 上位参照：[W94 Unified Capability, Artifact & Public Plane](../plans/W94_UNIFIED_CAPABILITY_ARTIFACT_AND_PUBLIC_PLANE.md)

## 0. 目的与边界

W94H 不新增业务功能，只把 W94A–G 的合同、运行证据、资源与公共效应放到同一张可审计的收口表。它必须失败关闭：任何一项证据缺失、版本不一致、资源未归零、隐私红线或真实服务器门未闭合，都只能输出 `PARTIAL/BLOCKED`，不得写 `W94 COMPLETE`。

本波只读 seal 脚本不会部署、发布、上传、修改服务器，也不会因为 staging health 为 200 就授权公共 effect。服务器上的 staging origin 当前明确设为 `MAZZ_HUB_PUBLIC_EFFECT=0`；本地 fixture 可以显式打开测试开关，但不能把 fixture 当生产授权。

## 1. Gate 状态（2026-08-28）

| Gate | 当前状态 | 证据 / 未闭合项 |
| --- | --- | --- |
| W94A | PASS | Capability/Proposal/Lease/Receipt 脊柱与 Source/Packaged 证据 |
| W94B | PASS | Calc/Chart 定义、血缘、回放与构建证据 |
| W94C | PASS | Canvas Agent construction 与回滚证据 |
| W94D | PASS | Blender 5.2 opt-in、外部进程收尸与 Source/Packaged 证据 |
| W94E | LOCAL PASS | 八域 producer 按真实生命周期覆盖；Player 人工选择、World approval/cancel 已补，Canvas 同步原子 mutation 的 cancel 明确不适用 |
| W94F | LOCAL PASS / EXTERNAL OPEN | 本地 durable transport、W93 bridge、Range、双 Mazz loopback 已闭；公网 P2P / 物理跨机仍为显式 opt-in |
| W94Ga | PASS | 本地 World Store、Branch、Proposal/Review/Merge、A/B、restart |
| W94Gb | LOCAL PASS | Artifact→human Grant→safeStorage-protected Ed25519→fake Hub prepare/publish/withdraw；桌面 Source/Packaged/restart 通过 |
| W94Gc | PASS_WITH_SCOPE | 服务器 staging HTTPS/health/snapshot 与禁写门通过；根域 DNS、备份恢复、日志/资源告警、incident drill、生产签名治理未闭合 |

## 2. 每波必查

1. **合同**：新 schema 的未知字段、identity、revision/CAS、grant/rights、路径/URL/secret/正文注入全部 fail closed。
2. **耐久**：save → close → reopen → replay；projection、receipt、World/Branch identity 和 revision 不漂移。
3. **故障**：cancel、crash、I/O、损坏、stale revision、网络失败、外部进程退出均有明确失败或恢复，不把 200/可读冒充持久成功。
4. **资源**：窗口、listener、timer、worker、外部进程、临时文件、协议连接回到基线或稳定身份子集。
5. **相邻面**：共享 main/preload、Factory、Player、Library、World、Hub 的合同与旧兼容入口仍全绿。
6. **隐私**：证据 JSON、日志、截图、manifest 不含 API Key、Bearer、Cookie、用户绝对路径、私有正文、transcript。
7. **真实工具/网络**：Blender、HTTPS、服务器只作为显式 opt-in 补强；fixture 仍是确定性底座。
8. **回滚**：feature flag、schema 兼容读、staging 禁写、证书/服务恢复路径可复核。

## 3. 退出条件

只有以下条件同时满足，才允许人类另行授权 `W94 COMPLETE`：

- W94A–G 全部 `PASS`，不含 `PASS_WITH_SCOPE`；
- W94E 缺失事件覆盖已补齐，W94F 的公开范围与权限有正式裁决；
- fake Hub 的测试签名被真实密钥管理和可验证的生产签名替代；
- staging/prod 账号与 secret 分离，apex 与 www DNS、TLS、80→443、备份恢复、证书续期、监控和 incident drill 均有证据；
- 最后一处代码/文档改动之后，全量 `node tests/run.js`、`npm run build`、涉及打包的 `npm run dist:dir` 全绿；
- README、总计划、W94G/W94H 规格、checkpoint、evidence 同代且可回放；
- 无未裁决 P0/P1、无公网自动发布、无未经人类确认的外部副作用。

## 4. 当前复开顺序

本地 H seal 与总公共 seal 分列：本地全量/构建/打包/Source/Packaged 通过可写 `H-local PASS`，但
`completeClaim` 仍为 false。后续只复开公网 P2P/物理跨机，以及 W94Gc production DNS/TLS、监控、
incident drill、服务器信任/密钥轮换与人工公共 effect；任何公共红门未闭，总 W94 继续保持
`PARTIAL/BLOCKED`。
