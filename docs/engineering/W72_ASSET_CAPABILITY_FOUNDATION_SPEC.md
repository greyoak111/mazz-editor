# W72 Asset & Capability Foundation 施工规格

> 版本：v0.4
>
> 日期：2026-08-17
>
> 状态：**W72 COMPLETE — FOUNDATION ONLY**
>
> 前置：W71 `SEAL / COMPLETE`，严格 C4 提交 `cf35f5c`
>
> 跨波次真源：`C:\Users\Administrator\Downloads\交付区\Mazz 当前未落地全景-W71归并版.md` v1.44
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

### W72b — Existing Asset / Capability Adapters（COMPLETE）

本次按最小样本完成：

- 建立现有正式模块的资产/能力候选盘点，不把盘点结果冒充全局注册；
- 以保存—重开的 W62d Mindmap 文档为样本，把既有 `sourceRef` 投影到 Asset Envelope；
- 只有调用方给出稳定 `sourceAssetId` 时才生成 `derivedFrom`，不得从 filePath 猜 ID；
- 登记现有 `parseOutline` 为 `mindmap.outline.import` 第一方描述；
- Provider 标为 local/embedded，但 `agentUsable=false`、health=unknown，因为本轮没有 Runtime Adapter 或统一探针；
- 无批量迁移、无全局 Registry 实例、无 IPC/UI/Factory 接线。

退出 Gate：盘点、适配器、描述和定向契约测试齐全；Envelope 不含 Mindmap roots/正文；现有 W62d 保存往返继续通过。证据见 [`W72B_EXISTING_ADAPTER_CHECKPOINT_2026-08-17.md`](./W72B_EXISTING_ADAPTER_CHECKPOINT_2026-08-17.md) 与 [`W72_EXISTING_ASSET_CAPABILITY_CENSUS.md`](./W72_EXISTING_ASSET_CAPABILITY_CENSUS.md)。

### W72c — Continuous OSS Provenance Ledger（COMPLETE）

本次完成：

- 以 `package-lock.json` 为固定坐标，生成 801 个 npm 包的确定性来源/许可账；
- 区分 runtime-graph candidate、development 和 Electron platform runtime，不把锁图冒充实包；
- 记录 resolved/integrity、declared license、修改、证据文件、分发状态、更新/漏洞状态；
- `limiter@1.1.5` 的 lock license 缺失只由实际包 metadata + LICENSE 精确 override；
- WebTorrent patch-package、ExcelJS override、Electron/Chromium 与 libass 复合 notice 均入账；
- FFmpeg wrapper 固定哈希与 core 未分发激活账分离；core 对应源码 Gate 不因 ledger 存在而关闭；
- 生成器不联网、不写时间/绝对路径，并把自身、配置、锁文件、补丁和证据文件哈希纳入输入；
- `release-audit` schema v4 读取 ledger、检查全部输入是否 current。

账本不是法律意见、在线漏洞扫描、最新版本查询、标准化公共 SBOM 或真实 installer 内容证明。退出 Gate 与证据见 [`W72C_OSS_PROVENANCE_CHECKPOINT_2026-08-17.md`](./W72C_OSS_PROVENANCE_CHECKPOINT_2026-08-17.md)。

### W72d — External Tool Adapter Spec（COMPLETE）

本次只冻结 `probe/version/workdir/input/output/stdout/stderr/exit/duration/cancel/dispose/provenance` 契约：

- Adapter 只有 `probe/run/cancel/dispose`，不复制 W66 Session Harness；
- Probe 的 available 必须与 executable path/version 或 unavailable reason 对应；
- Run Request 强制显式 workdir、稳定输入资产、预声明输出与 operation id；
- 顶层 raw command/shell/env 被拒绝，协议不成为任意命令执行器；
- Terminal Result 强制 status/exit 一致，并记录 stdout/stderr、duration、产物版本和 provenance；
- cancel 可表达 accepted/cancelled/already-terminal/not-found；
- dispose 只有在 `activeRuns=0` 时才允许宣称完成；
- 实现没有进程、文件、网络、Electron、IPC、UI 或真实工具副作用。

Blender 或其它工具试点仍归 W79，W72 不安装、不调用外部生产软件。协议、真实激活 Gate 与证据见 [`W72D_EXTERNAL_TOOL_ADAPTER_SPEC.md`](./W72D_EXTERNAL_TOOL_ADAPTER_SPEC.md) 和 [`W72D_EXTERNAL_TOOL_ADAPTER_CHECKPOINT_2026-08-17.md`](./W72D_EXTERNAL_TOOL_ADAPTER_CHECKPOINT_2026-08-17.md)。

## 5. W72 数据契约

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

External Tool Adapter v0：

```text
adapter = id / toolId / provenance + probe / run / cancel / dispose
request = runId / operation / workdir / inputs / outputs / provenance
result  = status / stdout / stderr / exit / durationMs / outputs / provenance
```

协议只描述外部工具调用边界，不持有进程、不登记 Capability、不调度 Factory，也不替代 Resource Ledger 的真实释放证据。

## 6. 当前停止线

W72a–d 已通过，W72 只能按 `FOUNDATION ONLY` 标记完成：四项依赖根交付已闭合，但没有自动批准任何消费者。下一步必须先回写完整未尽总表；不得顺手安装 Blender、调用外部工具或启动 W74/W79/W84。若继续依赖顺序进入 W73，第一子波只能做 Factory 现状—设计差额审计与施工规格，不能直接扩写下一代 Runtime。
