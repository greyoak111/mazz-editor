# W86 Capability Production Runtime
## Physical Production Extension / 物理生产能力扩展

> 状态：`W86a–W86d SIMULATION/READ-ONLY LANDED / W86e EXTERNAL SAFETY REVIEW CONDITIONAL`
> 版本：v0.1
> 登记日期：2026-08-16
> 来源：维护者《从内容网络、World、组织编译器到 .maz 生产资料标准》
> 原始 SHA-256：`79A1588A2971E134B6CEB1CFD02AC4D27AB4981968A0E46285DEA0EE3D039408`
> 跨波次真源：`C:\Users\Administrator\Downloads\交付区\Mazz 当前未落地全景-W71归并版.md`

## 0. 定位与最高安全边界

W86 研究 Mazz 的组织层能否扩展到物理生产，但不允许 LLM、Agent、W82 或 W73 直接控制电机、PLC、CNC、机器人、DCS、车辆或其他现实设备。

```text
Factory:       “希望这样生产”
Safety Kernel: “允许 / 拒绝 / 降级 / 紧急停止”

Factory has no override authority.
```

W86 的正式实现前提不是“接口能通”，而是独立的安全工程、法规责任、现场风险分析、认证设备、隔离网络、人工 Authority 和可验证 fail-safe。当前只登记架构词汇与模拟 Gate。

## 1. 五层模型

```text
L5 Organizational Compiler
Goal / Organization / Resource / Recompile Proposal

L4 Production Runtime
Workflow / MES-like State / Quality / Maintenance /
Logistics / Scheduling / Recovery

L3 Capability / Adapter Plane
OPC UA / CNC / Robot / Vision / Human / Supplier

L2 Deterministic Control
PLC / DCS / Servo / Robot Controller

L1 Physical Process
Machine / Material / Sensor / Environment

Sidecar: Independent Safety Kernel
interlock / envelope / emergency stop / authorization / audit
```

越往上可以越智能，越往下必须越确定。L5/L4 只能提出经验证的 production intent；L2 与 Safety Kernel 持有实时控制和拒绝权。

## 2. Capability Division of Labor

Executor 候选扩为：

```text
Human / AI / Agent / Script
Robot / CNC / PLC / Vision / Warehouse
Simulation / Truck / External Supplier
```

统一 Capability Contract 回答：

```text
canDo / input / output
cost / latency / capacity / reliability
permission / safetyClass / operatingEnvelope
evidence / calibration / certification
failureModes / recovery / humanFallback
```

`Seat != Machine`：Seat 是职责与交接边界；Machine A 故障后可以查询 Machine B 或 B + Human inspection，但任何替换必须重新满足安全等级、校准、能力、产能和 Gate，不能只因“接口相同”自动接管。

## 3. Production State Machine

候选链：

```text
Order / Goal
→ Production Blueprint
→ Capability Graph
→ W82 Organizational Compiler
→ process / station / resource / logistics / quality / maintenance plan
→ W86 Production State Machine
→ Safety Kernel authorization
→ deterministic controller command
→ physical process
→ sensor / quality evidence
→ state feedback / exception / local recompile proposal
```

状态回流只能形成 evidence 和 proposal。模型不得根据单一传感器、自然语言描述或预测结果自行确认物理完成；必须由经校验的 measurement、controller state、independent quality Gate 和 Authority 共同推动状态迁移。

## 4. Safety Kernel 不变量

- 与 AI/Factory 进程、凭据和部署权限隔离；
- 默认拒绝、明确 operating envelope、硬超时和 heartbeat loss safe state；
- 紧急停止、interlock、速度/力/温度/区域等限制在确定性层执行；
- Factory 无修改、绕过、关闭或降级 Safety Kernel 的权限；
- 网络断开、时钟漂移、重复/乱序命令、重启和旧计划重放均 fail-safe；
- 每次授权绑定设备身份、程序版本、工件/批次、校准状态和责任主体；
- 模拟证据不能替代真实安全认证，AI 生成测试不能替代法规/现场验证。

## 5. Human / Supplier / Physical Authority

采购、排班、供应商和人工工位也可表达为 Capability，但合同、法律、财务、劳动安全和现实签发仍由相应责任主体持有。外部 Supplier 的“已完成”只能成为声明，必须经收货、质量、来源和 Authority Gate 才能迁移。

## 6. 与现有波次的边界

| 波次 | W86 消费 / 提供 | 禁止混写 |
|---|---|---|
| W72 Capability | 通用 capability identity/provenance | Capability Registry 不直接控制设备 |
| W73 Factory Runtime | 数字 Task/Run/Artifact/Gate 前件 | W73 不成为 MES/PLC/DCS |
| W79 External Tool | 结构化 Adapter 生命周期经验 | Desktop CLI Adapter 不冒充工业安全 Adapter |
| W82 Compiler | 组织与重编译 proposal | Compiler 无 Safety override 或实时控制权 |
| W84 `.maz` | 可移植 Definition 候选 | 包不能携带 secret、活跃状态或自动执行设备命令 |
| W85 Context | 操作手册/状态/证据上下文 | Context/LLM 不能替代实时控制或 Safety Kernel |

## 7. 研究拆波

### W86a — Vocabulary / Threat Model / Responsibility Map

只做术语、层级、事故面、Authority、网络区、数据流与法规/认证缺口；没有设备接入。

### W86b — Simulation-only Capability Graph

以纯模拟器和假设备验证 Seat/Capability/Executor 替换、capacity、failure、maintenance 和 recovery；所有输出明确 `SIMULATION`。

### W86c — Read-only Industrial Evidence Adapter Research

只有在独立批准后研究只读状态/历史证据，先做离线录制 fixture；不得向现场系统写入或连接生产网络。

### W86d — Shadow Planning

对历史生产记录生成不执行的计划与 recompile proposal，与真实结果离线比较；不得进入实时决策链。

### W86e — External Safety Review Gate

是否存在任何现场试点，必须由维护者、行业责任主体和独立安全审查重新立项。W86a–d 通过不自动批准 W86e。

## 8. Hard Validation Sample I — Simulation only

```text
simulated production cell
→ Machine A capability fails
→ query compatible executor
→ reject unsafe Machine C
→ select Machine B + Human inspection
→ recompute schedule and affected artifacts only
→ Safety Kernel rejects out-of-envelope proposal
→ produce complete evidence / recovery ledger
```

退出条件：全链没有真实设备写入；unsafe proposal 必须被独立层拒绝且 Factory 无法覆盖；替换决策包含能力、校准、产能、安全和人工 Gate；模拟/真实标签不可混淆；重放、断网、重复命令和旧计划均安全失败。

## 9. 永久禁区

```text
× LLM / Agent / W82 / W73 直接写 PLC/CNC/Robot/DCS
× Factory 拥有 Safety Kernel override
× GUI automation 冒充工业 Adapter
× 互联网模型连接生产控制网
× 单一传感器或 Executor 自报完成推动物理状态
× 模拟通过 = 现场安全 / 法规合规 / 认证通过
× 设备接口兼容 = capability/safety equivalence
× 把现场 secret、程序、配方、私人记录打进 .maz
× 未经独立授权从 read-only 研究升级到写入/控制
```

## 10. 当前停止线

W86 是远期研究架构，优先级低于 W71、全部数字生产前件和 W83–W85。当前不得安装工业 SDK、接 OPC UA/PLC/CNC/Robot、扫描现场网络、创建控制凭据、写设备模拟以外的 Adapter，或把 Sample I 描述为现实生产能力。
