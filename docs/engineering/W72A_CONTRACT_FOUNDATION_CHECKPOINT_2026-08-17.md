# W72a Asset / Capability Contract Foundation 检查点

> 日期：2026-08-17
>
> 状态：**COMPLETE**
>
> 前置：W71 严格 C4 `COMPLETE`，提交 `cf35f5c`
>
> 规格：[`W72_ASSET_CAPABILITY_FOUNDATION_SPEC.md`](./W72_ASSET_CAPABILITY_FOUNDATION_SPEC.md)

## 1. 本次完成

- 新增 `mazz.asset-envelope/v0` 纯数据包络；
- 新增 `mazz.capability-provider/v0` 纯数据描述；
- 新增同一 capability / 多 provider 的内存 Registry；
- 新增显式 health snapshot 与条件过滤；
- 既有 W62d `sourceRef` 作为不透明可移植值无损保留；
- 新增 6 条契约测试并接入全量入口。

## 2. 不变量实证

| 不变量 | 证据 |
|---|---|
| 文件与领域格式继续是真源 | Envelope 只保存元数据，不读取或复制内容 |
| Semantic Identity != File Path | 同一 id 在 path 重命名、version 变化后保持 |
| 不造 Universal Asset DB | 实现没有 fs、SQLite、索引、扫描或持久化服务 |
| sourceRef 复用 | W62d 的 `filePath/title/selection` 形状深拷贝后守恒 |
| 同能力多实现 | `image.edit` 同时登记 embedded local 与 service API provider |
| Registry 不做 Router | 没有 `resolve` 或自动排序；只返回透明 candidates |
| Harness / Tool Adapter 分离 | Registry 没有 `createSession/execute/spawn/probe`，不导入 Agent Harness |
| v0 不自然膨胀 | 未冻结的 Envelope / Provider 顶层字段被拒绝 |

## 3. 验证

```text
node tests/contract/w72-foundation.test.mjs
通过 6 / 失败 0

node tests/run.js
154/154 个测试文件通过
```

全量测试从 153 增到 154；既有 W71、W66 Harness、W62d sourceRef 和各格式 roundtrip 均继续通过。测试没有重建或改写 W71 冻结 installer/app.asar。

## 4. 代码边界

```text
main/foundation/plain-value.js
main/foundation/asset-envelope.js
main/foundation/capability-registry.js
tests/contract/w72-foundation.test.mjs
```

这些是内部 Contract Foundation，不是正式 UI、公共 API、`.maz v1`、Hub schema、Factory Router 或 External Tool Runtime。

## 5. 下一停止线

W72a 完成不等于 W72 完成。仍未施工：

- W72b 现有资产/第一方能力的最小适配；
- W72c 持续 OSS Provenance Ledger；
- W72d External Tool Adapter Spec。

下一步只能在以上三个子波中选择一个小切片并回写完整未尽总表；不得借本检查点自动启动 W73、W74、W79、W84 或任何外部工具安装。
