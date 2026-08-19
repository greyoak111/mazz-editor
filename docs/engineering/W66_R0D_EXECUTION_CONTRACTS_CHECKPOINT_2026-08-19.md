# W66-R0d Execution Contracts 检查点

状态：`COMPLETE TO FROZEN R0d SCOPE`

前件：W66-R0c `7624216`，合同复跑 `4/4`。

后继：W66-R0e Spawn / Completion / Secret / Incident Gate。

## 落地范围

- 新增 `main/agent-execution-contracts.js`，冻结五类 Typed Handle 及本地 continuation 校验。错误 kind/owner/continuation 在副作用前返回确定性错误。
- 新增 `mazz.result-envelope/v0` 与 SUCCESS/ERROR/PARTIAL/TRUNCATED/EMPTY/BLOCKED Tagged Union。`outer success + inner exit nonzero` 默认 `ok=false`，仅 RED_EXPECTED 可显式保留测试语义。
- 新增 Failure Signature 与 Retry Budget。相同签名且前置条件未变时返回 `UNCHANGED_RETRY_FORBIDDEN`，预算耗尽返回 `RETRY_BUDGET_EXHAUSTED`。
- 新增 Patch Base CAS。写前 hash/byteLength/mtime 任一变化返回 `STALE_PATCH`，要求重读与重算。
- 新增 Output Completeness Receipt；截断、未收齐或无 hash/totalItems/lineCount 边界的输出不能关闭 Gate。

## 验证

- `node tests/contract/w66-r0d-execution-contracts.test.mjs`：`5/5`。
- R0a/b/c、Doctrine intake、Adapter plan、Harness Foundation 关联合同：总计 `34/34`。
- `npm run build`：PASS。
- UI/Electron/packaged/真实 CLI：本波不涉及，明确 `NOT RUN`。

机器证据：`docs/engineering/evidence/W66_R0D_EXECUTION_CONTRACTS_IMPLEMENTATION.json`。

## 停止线

R0d 是纯执行合同，不创建 child process、不注册 Adapter、不接 IPC/UI，也不把 Result Envelope 冒充 Completion Evidence。Spawn、Secret、Incident、Completion Gate 留在 R0e。
