# W72 Asset & Capability Foundation 施工规格

> 版本：v0.1
>
> 日期：2026-08-17
>
> 状态：**W72a COMPLETE / W72b–W72d NOT APPROVED**
>
> 前置：W71 `SEAL / COMPLETE`，严格 C4 提交 `cf35f5c`
>
> 跨波次真源：`C:\Users\Administrator\Downloads\交付区\Mazz 当前未落地全景-W71归并版.md` v1.41
>
> 设计来源：`C:\Users\Administrator\Downloads\MAZZ_新上下文技术梳理_资产Factory关系检索多父导图_v0.2.md`

## 1. 本轮定位

W72 是 W73、W74、W79、W81、W82、W84、W85、W86 等后续波次的依赖根。它只建立资产身份、能力描述、来源纪律和外部工具适配边界，不把所有文件、关系、运行时和工具塞进同一系统。

四项最终交付保持为：

```text
Asset Envelope v0
Capability Registry v0
持续 Open Source Provenance Ledger
External Tool Adapter Spec
```

W72 完成不等于这些消费者波次自动获批。

## 2. 仓库审计结论

1. 当前没有统一 Asset Envelope 或通用 Capability Registry 实现。
2. W62d 已有真实 `sourceRef`，用于 Markdown 提炼到 Mindmap 后跨保存回跳；W72 必须把它作为不透明、可移植值复用，不能另造不兼容来源协议。
3. `main/agent-harness.js` 的 `capabilities` 是 W66 Agent 执行器会话能力布尔表，语义是 `workspace/fileEdit/terminal/...`；它不等于 `image.edit`、`document.parse` 这类生产 Capability，不能被改名后冒充 W72 Registry。
4. `renderer/ai/provider.js` 是 AI Provider 注册表；它也不是通用生产能力注册表。
5. 现有 FFmpeg provenance 已证明发布许可需要持续证据，但单个 vendored 目录文档不等于全局持续 OSS Ledger。

## 3. 永久边界

- 文件、Markdown、PNG、Office、Mindmap、Factory Artifact 等领域格式继续是真源。
- Asset Envelope 只管 `id/path/type/version/sourceRef/provenance/status/relations`。
- `Semantic Identity != File Path`；重命名不能自动制造新资产身份。
- Envelope 不保存文件正文，不扫描工作区，不建立 Universal Asset DB。
- relations 只做必要引用的透明运输，不在 W72 发明 Universal Graph 或 W77 Promotion 语义。
- Capability Registry 只登记描述和健康快照，不执行、不自动路由、不持有进程。
- Factory 日后依赖 Capability；具体 Router、成本决策和组织调度仍归 W73。
- `Agent Harness != Tool Adapter != Capability Registry != AI Provider`。
- W72 不引入新依赖、后台服务、SQLite/图数据库、模型权重或正式 UI 入口。

## 4. 子波次

### W72a — Contract Foundation（COMPLETE）

本次已完成范围：

- 纯数据 `Asset Envelope v0` 构造/校验；
- 纯数据 `Capability Provider v0` 构造/校验；
- 同一 capability 多 provider 的内存注册和显式 health snapshot；
- 契约测试与本规格；
- 不接任何产品入口或持久化。

退出 Gate：

- 既有 `sourceRef` 形状无损保留；
- semantic id 不由 path 派生；
- 未冻结顶层字段被拒绝，防止包络自然膨胀成万能对象；
- 同一 capability 可以登记多个 provider；
- Registry 没有 `execute/resolve/spawn/createSession`，不抢 W73/W66/W79 职责；
- 全量回归通过。

### W72b — Existing Asset / Capability Adapters

后续另行施工：盘点现有正式模块的资产类型和第一方 capability，只做薄适配；先以 Markdown→Mindmap `sourceRef` 和一个无外部依赖的第一方能力作样本。不得批量迁移所有模块。

### W72c — Continuous OSS Provenance Ledger

后续另行施工：把项目、固定版本/commit、来源、许可证、修改、分发、NOTICE/源码义务、更新和漏洞状态形成持续账本，并和 release audit 对接。不得把研究储备中的许可证推测直接当最新事实。

### W72d — External Tool Adapter Spec

后续另行施工：只冻结 `probe/version/workdir/input/output/stdout/stderr/exit/duration/cancel/dispose/provenance` 契约。Blender 或其它工具试点归 W79，W72 不安装、不调用外部生产软件。

## 5. W72a 数据契约

Asset Envelope v0：

```text
schema = mazz.asset-envelope/v0
id / path / type / version
sourceRef / provenance / status / relations
```

Capability Provider v0：

```text
schema = mazz.capability-provider/v0
capabilityId + providerId
inputTypes / outputTypes
agentUsable
execution.mode = embedded | cli | service | external
cost.type = local | api
health.status = unknown | available | degraded | unavailable
provenance
```

这些 schema 是内部 v0 契约，不是 `.maz v1`、公共 Hub 协议或跨生态标准。

## 6. 当前停止线

W72a 已通过，只能宣称“薄契约地基已落”，不能宣称 W72 完成。验证见 [`W72A_CONTRACT_FOUNDATION_CHECKPOINT_2026-08-17.md`](./W72A_CONTRACT_FOUNDATION_CHECKPOINT_2026-08-17.md)。下一步必须先回写完整未尽总表，再在 W72b、W72c、W72d 中按依赖选择；不得顺手启动 W73、W74、W79 或 W84。
