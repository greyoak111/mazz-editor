# W86 Capability Production Runtime 安全前置收口检查点（2026-08-19）

## 结论

W86a–d 已按唯一安全合法范围落成 `SIMULATION / OFFLINE READ-ONLY / SHADOW PLANNING`；W86e 被收束为唯一、不可由软件测试自动关闭的 `CONDITIONAL_EXTERNAL_SAFETY_REVIEW`。这不是现场控制系统，也不授权 Mazz、Factory、Agent 或 LLM 连接或写入任何 PLC/CNC/Robot/DCS/设备网络。

## W86a–d

1. 冻结 L5 Organization、L4 Production Runtime、L3 Capability Adapter、L2 deterministic controller、L1 physical process 与独立 Safety sidecar 的责任/越权图。
2. Capability Contract 明示 canDo、I/O、成本、容量、可靠性、权限、安全级、operating envelope、校准、认证、failure/recovery/human fallback；`Seat != Machine`。
3. 独立 Simulation Safety Kernel 对 replay/duplicate/out-of-order/stale plan/clock drift/expiry/heartbeat loss/capability mismatch/identity/calibration/certification/human Authority/out-of-envelope fail-safe；Factory 永无 override。
4. Offline Evidence Adapter 只接受本地录制 fixture，形成 hash chain；出现 endpoint/host/IP/port/control/write 或 OPC UA/HTTP/TCP 等地址立即拒绝。
5. Shadow Plan 只以离线证据生成 `PROPOSED_NOT_EXECUTED`，没有 controller command，不进入 realtime decision chain。
6. Hard Sample I：Machine A failed；Machine C 因无 calibration/certification/safety class 被拒；Machine B + Human inspection 接替；只重排 part/quality 两项，不污染 packaging/shipping；越界 speed 提议被独立层拒绝。

## 产品实证

- “组织编译台”提供“物理生产模拟”入口，展示 `SIMULATION ONLY`、安全/拒绝决定、Machine 替换、`controllerCommandsProduced=0`、`realDeviceWrites=0` 和 W86e 外部安全 Gate。
- W86 合同 `9/9` PASS。
- `npm run build` PASS。
- 真 Electron W82/W86 联合入口 PASS，renderer page error 0；证据见 [`W82H_ORGANIZATION_RUNTIME.json`](./evidence/W82H_ORGANIZATION_RUNTIME.json)。

## W86e 唯一条件终态

任何现场试点必须另立项目，并至少取得独立安全工程师、行业责任主体、法规/认证分析、认证设备、隔离网络、可验证 fail-safe 与人工最终签发。模拟通过、离线回放、合同测试或 Mazz 维护者单方批准均不能满足该 Gate。

当前明确为：

```text
fieldActivationAuthorized = false
deviceWriteAuthorized = false
automaticallySatisfiedBySimulation = false
```

本波没有安装工业 SDK、扫描生产网、创建设备凭据或发送任何设备命令。
