# W73g Director / Process Protocol Assets — 检查点

> 状态：`COMPLETE`
> 开工基线：`main@94a82aa`
> 日期：2026-08-17
> 下一波：`W73h Integration, Recovery & Soak — NOT APPROVED`

## 1. 本波结论

W73g 已把 W68 生产组织中原本散落在代码、工件名和历史说明里的 Director、交接、异常、工件链、Gate 与恢复结构冻结为本地协议资产，并把每次现有 Production Run 的事实引用投影为可重开、可追踪的只读资产。

本波没有创建新的“导演中心”、流程图编辑器或第二 Factory。项目级协议是 Definition；Run 投影是从 W73b–f 既有事实链派生的 View。W68/W73 Runtime 仍拥有执行、Gate、Finding、调度、成本和终态；W82 以后可编译更完整的组织图，但不能反向取得 Run 所有权。

关闭的缺口：

1. W68 有正式、版本化、普通 JSON/Markdown 可读的 Director/Process Protocol；
2. 交接、异常、证据、Authority、工件前后继和 Gate/Recovery 不再只存在于说明文字；
3. 当前 Run 的 Artifact/Gate/Finding/Rework/recovery 可按 sequence 生成历史投影，并通过现有 Factory Desk 打开。

## 2. 冻结协议

新增：

```text
mazz.factory-process-protocol/v0
mazz.factory-process-protocol-projection/v0
```

`ProductionRun v0` 只新增：

```text
protocol-assets-recorded
protocolRefs[]
```

W72 继续使用既有薄包络：

```text
mazz.asset-envelope/v0
```

两类 W73g JSON 都不保存 Prompt、模型回复、正文、密钥、环境变量、任意命令或不可解释推理。

## 3. 项目级 Protocol Definition

固定路径：

```text
<factory-project>/.mazz/protocols/
└─ w68-governed-review/
   └─ 1.0.0/
      ├─ protocol.json
      ├─ asset-envelope.json
      └─ README.md
```

`protocol.json` 当前包含：

| 结构 | 数量 | 作用 |
|---|---:|---|
| Director stages | 7 | intake、M1、M2、M3、M4/M5、M6、human-final |
| Handoffs | 7 | 显式 from/to、触发、必需工件、Gate、退回目标与 Authority |
| Exceptions | 6 | 预算、无合格执行者、Provider/Harness 不可用、三轮不收敛、账本恢复、越权 |
| Artifact roles | 12 | blueprint 至 final-output 的领域工件链 |
| W68 Gate | 4 | machine、point、review、objection |
| Recovery points | 6 | 所有 blocked/recovery-required 的人工证据恢复点 |

同一 `protocolId@version` 一旦存在，只允许逐字相同的幂等重开；内容变化却沿用旧版本会返回 `W73G_PROTOCOL_VERSION_CONFLICT`，不静默覆盖。

## 4. Director / Handoff / Exception 纪律

Director table 显式记录：

```text
stageId
directorRef
responsibility
authorityScope
input/output artifact roles
gateRefs
exceptionRefs
```

它只定义职责边界，不绑定某个 Model/Provider/Harness/Executor，也不自动派工。

Handoff 必须记录上游、下游、触发、必需工件、验收 Gate、退回目标、是否需要 Evidence 和 Authority。Exception 必须记录触发、合法阻断态、人工 Authority、证据要求和 Recovery Point。六类 Exception 全部固定：

```text
automaticFallback = false
```

因此无资格、越权、预算不足、执行边界不可用或账本损坏时不会暗降到任意模型/Provider，也不会绕过 W68 Gate。

## 5. Artifact Chain 与 Gate/Recovery

Artifact Chain 只保存 role/type/producer/consumer/predecessor/required/truthOwner；正文继续由领域文件持有。`truthOwner=domain-file`，W73g JSON 不成为工件正文数据库。

Gate projection 只描述 W68 已有 machine/point/review/objection 四闸的输入、通过态、失败态、Authority 和恢复点。它不改 `runW68Review()`，不自动打开 Gate，也不把 Factory seal 升格为 Human Final、Promotion、Publication 或 Canon。

## 6. Run Projection

固定布局：

```text
<factory-project>/.mazz/runs/<runId>/process-protocol/
└─ run-seq-NNNNNN/
   ├─ projection.json
   ├─ asset-envelope.json
   └─ README.md
```

每个投影版本绑定当前 Production Run `sequence`，只读引用：

```text
Run / Task / Project / status / sequence
Artifact refs
Gate refs
Finding refs
Rework refs
Recovery state
Protocol definition ref
```

有新 Run 事实时，下一次同步先以 `protocol-assets-recorded` 登记预测路径，再保存对应 sequence 的不可变投影；若写盘中断，重开可按同一 sequence 补回。Run 已进入 completed/failed/cancelled 后，只允许补写派生投影，不向终态 Run 追加幽灵事件。

删除 Factory Desk 视图、投影 JSON/Markdown 或某个投影版本，不会删除 Production Run events、领域工件或项目级 Protocol Definition。

## 7. W72 Asset Envelope

项目级 Definition 的 Envelope：

```text
type = application/vnd.mazz.factory-process-protocol+json
relation = describesWorkflow → workflow:W68
```

Run Projection 的 Envelope：

```text
type = application/vnd.mazz.factory-process-protocol-projection+json
relations = projectsRun + usesProtocol
```

两者均通过既有 `createAssetEnvelope/isAssetEnvelope` 契约验证。没有全局 Registry、后台扫描、Universal Asset DB 或 Universal Graph。

## 8. 现有 Factory Desk 消费

`FactoryPanel.ensureProductionRun()` 仍是唯一产品接线点。W73g 使用原有 `appendWorkshop()`，向项目 `工厂群.md` 幂等追加 `stage=process-protocol` 系统卡；Factory Desk 按既有 archive parser、watcher 和虚拟列表加载它。

卡片显示协议/投影身份、Director/Handoff/Exception/Artifact 数量、当前 Gate 引用和恢复状态，并给出普通 Markdown 入口。没有新增模块注册、Ribbon 入口、IPC、BrowserWindow、Canvas、流程图渲染器或第二状态源。

本波不改 Factory Desk 可见布局，因此没有用无关截图冒充验收；验证重点是现有加载链真实消费和物理档案可重开。

## 9. 故障与边界

已验证：

- 顶层与嵌套未知字段拒绝；
- secret 字段递归拒绝；
- 悬空 Stage/Gate/Artifact/Exception/Recovery 引用拒绝；
- 同 ID/version 异义冲突拒绝；
- Definition/Projection 保存—重开与幂等；
- Projection 版本按 Run sequence 留存；
- 终态不追加协议幽灵事件；
- max/legacy 明确排除；
- 当前 Factory Desk archive 真消费；
- 删除投影视图不删除事实。

未验证且没有冒充完成：

- W73h packaged Electron 与 20 次 create/pause/recover/seal/close soak；
- renderer crash / whole-app crash 下投影与全部 W73 账本组合恢复；
- W82 多行业 Organizational Compiler；
- W79 外部工具流程图渲染；
- W64 产品人格呈现；
- W69/W74 公共发布与 Promotion；
- W68 max/legacy 迁移。

## 10. 验证水位

- W73g 新增合同：`9/9`；
- W73a–g 关联断言：`86/86`；
- renderer build：`PASS`；
- 全量 `node tests/run.js`：`170/170` 个测试文件通过（退出码 0）。

本波止于 W73g。W73h 仍需维护者另行批准。
