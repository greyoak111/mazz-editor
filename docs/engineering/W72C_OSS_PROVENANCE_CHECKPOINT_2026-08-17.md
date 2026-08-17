# W72c Continuous OSS Provenance Ledger 检查点

> 日期：2026-08-17
>
> 状态：**COMPLETE — REPOSITORY PROVENANCE BASELINE**
>
> 前置：W72b `4ca4ac8`
>
> 规格：[`W72_ASSET_CAPABILITY_FOUNDATION_SPEC.md`](./W72_ASSET_CAPABILITY_FOUNDATION_SPEC.md)

## 1. 交付

```text
scripts/oss-provenance-ledger.js
docs/engineering/OSS_PROVENANCE_MANUAL.json
.mazz/audit/oss-provenance-ledger.json
npm run audit:provenance
npm run audit:provenance:update
```

`audit:provenance:update` 只在维护者明确更新证据时重生成；常规 CI/复核使用 `audit:provenance`，任何输入漂移都会返回非零。Release audit 已升级至 schema v4，并将 ledger 的 SHA-256、summary、blocker 和 stale input 纳入发布审计。

## 2. 当前账面

| 项目 | 结果 |
|---|---:|
| 锁定 npm 包 | 801 |
| runtime-graph candidates | 380 |
| development packages | 421 |
| 直接 runtime dependencies | 22 |
| 已声明 package patch | 1 |
| 精确人工 license override | 1 |
| vendored / deferred components | 2 |
| missing license | 0 |
| missing source artifact / integrity | 0 |
| blocker | 0 |

当前 ledger：`826,909` bytes，SHA-256=`1B1B1C1D96405EA66C3867F8326C28F68A9BE0AAC23C513AC7C54DFD776ABEC1`，Gate=`PASS_REPOSITORY_PROVENANCE_BASELINE`。

## 3. 证据纪律

- npm 项目只宣称“锁定 artifact + integrity + 包声明 license”，不冒充逐包法律审查；
- `limiter@1.1.5` 同时固定已安装 package metadata 与 `LICENSE.txt`，并校验 legacy `licenses[]` 确实为 MIT；
- `webtorrent@2.8.5` 的 `patches/webtorrent+2.8.5.patch` 作为产品修改明示并计 hash；
- `package.json#overrides` 原样进入账本，`exceljs > unzipper@0.12.3` 不会隐身；
- Electron 固定自身 LICENSE 与 Chromium notices；libass-wasm 固定 compound COPYRIGHT；
- FFmpeg wrapper 七份文件必须命中已知 hash；历史 core 两文件必须不存在；
- 生成器、manual config、package/lock、补丁、根 notice、安装包 metadata 和专项证据文件均进入 input hash 集。

## 4. 明确保留的未知项

```text
updateStatus = LOCKED_NOT_CHECKED_LATEST
vulnerabilityStatus = NOT_ASSESSED_OFFLINE
legalConclusion = NONE
actual installer contents = release-audit 独立 Gate
```

这四项不是失败，而是防止离线账本冒充在线依赖情报、律师审查或实包清单。公共发布前仍须执行独立 advisory/license review；真实 installer 仍由 release audit 与安装矩阵裁决。

FFmpeg core 保持：

```text
distributionStatus = NOT_DISTRIBUTED_ACTIVATION_CAPSULE
gate = DEFERRED_OPEN_CORRESPONDING_SOURCE
```

它只是不阻塞当前“不分发 core”的 sealed scope，未来激活 Gate 没有关闭。

## 5. 验证

```text
npm run audit:provenance
.mazz/audit/oss-provenance-ledger.json CURRENT

node tests/contract/w72c-oss-provenance.test.mjs
通过 7 / 失败 0

node tests/run.js
156/156 个测试文件通过
```

## 6. 停止线

W72c 只完成持续来源/许可工程账，不创建 Hub 公共 SBOM、在线漏洞服务、自动更新器或依赖升级机器人。W72d 只允许冻结 External Tool Adapter 的纯协议；不得借下一波安装 Blender、接 UI 或启动 W79 pilot。
