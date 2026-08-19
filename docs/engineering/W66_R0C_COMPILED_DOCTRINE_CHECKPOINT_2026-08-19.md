# W66-R0c Compiled Doctrine / Rule Drift 检查点

状态：`COMPLETE TO R0C FROZEN SCOPE`
基线：`main@8cb8964`
前件：`W66-R0a + R0b COMPLETE`
后继：`W66-R0d Typed Handle / Result Envelope / Retry / CAS / Output Receipt`

## 1. Predecessor Gate

R0a `9572d52` 已冻结完整 Raw Source、Stable Rule Registry 与 Incident Lineage；R0b `8cb8964` 已冻结 Host Facts、Profiles、Current SSoT 与 Tool Capability。本波只编译每 Attempt 的规则环境，没有把未完成的 R0e Spawn Gate、R1 Supervisor 或三家 Adapter 提前激活。

## 2. 已完成

- 新增 `mazz.compiled-doctrine-view/v0` 与 `mazz.agent-rule-pack/v0`。
- 每个 Attempt 目录同时保存逐字节 `raw-rule-pack.md`、Host Facts、Profile Index、Current SSoT、Tool Capability、Applicable Rule Index、Project Doctrine、Gate Pack、Regression Pack、Compiled View 与 Manifest。
- Manifest 覆盖 canonical source、host/profile、registry/incident、project/current/tool、gate/regression/applicable index、compiled view 和整包 SHA-256。
- Injection load 逐项重算所有组件 hash；任一 JSON 或完整 Raw 被改写即在 Adapter 之前 fail closed。
- 适用索引由 Host Facts/Profile 计算；当前 Windows Local/Electron 不激活 Cloud Sandbox 处方，但完整 Raw 保留全部历史规则。
- 同 Attempt 相同输入幂等读取冻结工件；同 Attempt 任一输入漂移均 `DOCTRINE_IMMUTABLE_CONFLICT`。
- 已有 Attempt 时新 Attempt 必须显式连接当前链头。Canonical Raw hash 变化必须由 `human:*` 给出原因、时间和 supersedes Attempt；无接受或 `agent:auto` 代签均 `RULE_PACK_CHANGED_WITHOUT_ACCEPTANCE`。
- Rule drift 只生成新 Attempt；旧 Attempt 的 Manifest 与 Raw Source 原字节不变，满足在飞 Session 不暗更新纪律。

## 3. 验证

- `npm run build`：PASS。
- R0a `5/5`、R0b `5/5`、R0c `4/4`、W66 规划合同 `4/4`、Doctrine intake `4/4`、Harness Foundation `7/7`，关联合计 `29/29`。
- R0c RED/GREEN 覆盖：组件篡改、无人工接受 drift、Agent 代签、孤儿 Attempt、原地改写旧 Attempt。
- Electron E2E / UI screenshot：`NOT APPLICABLE`；本波没有 renderer、窗口或真实 Adapter。
- 全量 / packaged installer：`NOT RUN`；没有用关联合同冒充全量或发布 Gate。

## 4. 三波收口状态

```text
W66-R0a  COMPLETE · 9572d52
W66-R0b  COMPLETE · 8cb8964
W66-R0c  COMPLETE · 本检查点
W66-R0d  NOT STARTED
W66-R0e  NOT STARTED
W66-R1—R6 NOT STARTED
```

W66 总波仍为 `PARTIAL`，真实 Adapter 仍为 0。下一精确波次是 R0d；W62e、W79、W82、W69、W64、W63、W67 等历史欠账继续留在权威总表。
