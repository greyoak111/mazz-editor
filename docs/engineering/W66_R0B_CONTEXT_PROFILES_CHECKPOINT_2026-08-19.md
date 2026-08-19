# W66-R0b Host Context / Profiles 检查点

状态：`COMPLETE TO R0B FROZEN SCOPE`
基线：`main@9572d52`
前件：`W66-R0a COMPLETE`
后继：`W66-R0c Compiled View / Manifest / Rule Drift`

## 1. Predecessor Gate

R0a 已有不可变 Raw Source、Stable Rule Registry、Incident Lineage、`5/5` 合同和独立提交。本波只建设 R0b 上下文真值；没有进入 Compiled View、Spawn Gate、真实 Adapter、UI 或热切。

## 2. 已完成

- 冻结 `mazz.host-facts/v0`：OS、Shell、execution mode、workspace persistence、sandbox、packaged runtime、Electron、network 与 remote target 必须结构化且自洽。
- 冻结 `mazz.doctrine-profile-index/v0`：Profile 由 Host Facts 选择，不由 Agent 猜测。
- Windows Local/Electron、Cloud Sandbox、Remote VPS 三组 fixture 产生不同 active index；未激活规则仍标记 `inactiveRetainedInRawSource`，不从完整军规删除。
- 冻结 `mazz.current-ssot/v0`：task/wave/status/branch/HEAD/remote/open items/stop line/authority/source refs 缺一项即不能作为 Current Policy。
- 冻结 `mazz.tool-capability-snapshot/v0`：工具名称、args schema hash、limits、Result Envelope、Handle kind、continuation API 一起计算 `toolsetHash`。
- R0b 上下文和四类组件均以 hash 写入不可变目录；新 Context 显式 `supersedesContextHash`，Current 从 supersession 链派生，旧 Tool Capability 不继续冒充 CURRENT。

## 3. 验证

- `npm run build`：PASS。
- R0a `5/5` + R0b `5/5`，受影响合同合计 `10/10`。
- 验证 Host Facts 缺失/矛盾、SSoT 缺来源/坏 commit、伪造 Tool hash 均 fail closed。
- 验证 R0b 写入不会改写 R0a 的完整 Raw Source。
- 全量、Electron E2E、packaged installer：`NOT RUN`；本波无 renderer/窗口/真实进程面。

## 4. 停止线

R0b 只证明当前环境、当前波次和工具现实可被版本化。它尚未生成 Attempt 的完整 Compiled Rule Pack，也没有把这些事实接到 spawn；后者分别属于 R0c 与 R0e。R0d/e、R1–R6、W79、W82、W69、W64、W62e 等继续留表。
