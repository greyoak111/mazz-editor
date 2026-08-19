# W66-R0a Canonical Rule Source / Registry 检查点

状态：`COMPLETE TO R0A FROZEN SCOPE`
基线：`main@86f1792`
后继：`W66-R0b Host Facts / Profiles / Current SSoT / Tool Capability`

## 1. Predecessor / Backlog Gate

W74 已按冻结范围封波；权威总表指定下一精确欠账为 W66-R0a。W66-R0a 是 R0b–R0e 与 R1–R6 的共同前置。本波没有启动 Kimi Code、Claude Code、Codex，没有注册真实 Adapter，没有创建 child process，也没有进入 R0b/c/d/e、W79、W82、W69 或其他历史欠账。

## 2. 已完成

- 新增 `main/agent-doctrine.js` 的 Canonical Raw Source 读取与不可变快照核心。
- UTF-8 使用 fatal decoder；缺失、不可读、非法编码、快照失败、hash 漂移分别给出确定性错误。
- 快照路径由原文 SHA-256 决定；相同原文幂等，既有路径内容不同则 `DOCTRINE_IMMUTABLE_CONFLICT`。
- 新增 Stable Rule Registry v0，首批覆盖军规装载、波次、来源、Git、runner、PowerShell、Electron 窗口/媒体、沙箱、远端结果、事故升格与 async guard。
- 新增 Incident Lineage v0；Rule 的 Incident 引用必须存在，机器 invariant 与人类尸检叙事保持连接。
- Runtime API 不硬编码交付区路径；Mazz 当前权威源由调用方显式配置，通用产品不会把本机路径强加给所有工作区。

## 3. 当前真实原文证据

```text
source: C:\Users\Administrator\Downloads\交付区\Mazz Editor 开发军规.md
byteLength: 23540
sha256: 549602E38C2FC3FD8FF526EA317A51976615428D5879B15680807DF5F97BE1B0
```

本检查点不把原文复制进 Git；产品 Runtime 按配置从 Canonical Source 逐字节快照到工作区本地 Doctrine 证据区。

## 4. 验证

- `npm run build`：PASS。
- `node tests/contract/w66-r0a-doctrine-foundation.test.mjs`：`5/5`。
- 覆盖：raw byte/hash/length、幂等、missing、invalid UTF-8、snapshot failure、Rule ID duplicate、dangling Incident、零 Adapter/child-process surface。
- 全量、Electron E2E、packaged installer：`NOT RUN`，本波不涉及 renderer、窗口、真实 Adapter 或发布边界。

## 5. 停止线

R0a 只证明完整原文和结构化历史资产可以被可靠取证。它尚不证明 Profile、Current SSoT、Tool Capability、Compiled View、Spawn Gate、Typed Handle、Result Envelope 或任何真实 Agent 已落地；这些继续留在 R0b–R0e 与 R1–R6。
