# W72d External Tool Adapter 检查点

> 日期：2026-08-17
>
> 状态：**COMPLETE — PROTOCOL ONLY**
>
> 前置：W72c `d2d50e6`
>
> 权威协议：[`W72D_EXTERNAL_TOOL_ADAPTER_SPEC.md`](./W72D_EXTERNAL_TOOL_ADAPTER_SPEC.md)

## 1. 完成范围

- 新增 `mazz.external-tool-adapter/v0` 纯协议；
- 冻结 `probe/run/cancel/dispose` 四个生命周期方法；
- 冻结 Probe、Run Request、Terminal Result、Cancel Result、Dispose Result 五类数据包；
- Run Request 强制显式 workdir、稳定输入资产和预声明输出；
- Terminal Result 强制记录 stdout/stderr、exit、duration、产物版本和 provenance；
- 取消状态可幂等表达；dispose 完成态必须 `activeRuns=0`；
- raw command、shell、env 和未冻结顶层字段被拒绝；
- 新增 7 条定向契约并接入全量入口。

## 2. 边界实证

| 边界 | 结果 |
|---|---|
| 不吞并 W66 Agent Harness | Adapter 没有 createSession/send/events/capabilities |
| 不吞并 Capability Registry | 没有 register/resolve/candidates/health |
| 不吞并 Factory | 没有 Router、成本、重试、审批或组织调度 |
| 不成为任意命令执行器 | Request 不接受 command/shell/env |
| 不调用外部工具 | 实现没有 child_process/node-pty/Electron/网络/文件 I/O |
| 不提前做 W79 | 无真实 Adapter、无工具名、无进程、无 UI/IPC |

## 3. 验证

```text
node tests/contract/w72d-external-tool-adapter.test.mjs
通过 7 / 失败 0

node tests/run.js
157/157 个测试文件通过
```

## 4. 结论

W72 的四个地基交付现已齐全：Asset Envelope、Capability Registry、Continuous OSS Provenance Ledger、External Tool Adapter Protocol。这里的 `W72 COMPLETE` 只代表依赖根协议闭合，不代表 W73/W74/W79/W81/W82/W84/W85/W86 自动获批。

下一步如进入 W73，只能先做 Factory 现状—设计差额审计与子波冻结；如进入 W79，则必须重新取得真实外部工具 Pilot 授权并逐项通过协议第 7 节激活 Gate。
