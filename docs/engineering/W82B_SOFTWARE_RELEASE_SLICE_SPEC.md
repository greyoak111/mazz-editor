# W82b Software Release Organization Slice

> 状态：`LANDED — LOCAL NON-PRODUCTION SLICE`
> 版本：v1.0
> 日期：2026-08-19
> 前件：W82a Organizational Kernel、W73 Production Run Ledger / Runtime Convergence
> 真源：[`W82_ORGANIZATIONAL_COMPILER.md`](../plans/W82_ORGANIZATIONAL_COMPILER.md)

## 1. 本波结论

W82b 把 W82a 的软件发布纸面 fixture 推进为一个可验证的本地 vertical slice：同一份冻结 Workflow Package 编译出明确的 Seat、Artifact DAG、Gate、Authority、Routing 和 Recovery，再由类型化工具回执与人工决定推动状态跃迁，最后投影进 W73 Production Run Ledger。

它验证的是：

```text
Requirement
→ Change Set
→ Build Receipt
→ Independent Review
→ Test Receipt
→ Security Review
→ Local Release Specimen
```

它没有构建 IDE、CI、运维平台或发布服务，也没有执行任意命令。W82b 只接收已经由受控施工过程生成的类型化回执；真实运行状态仍由 W73 持有。

## 2. 冻结组织

| Team | Seat | Executor kind | Output | Authority |
|---|---|---|---|---|
| Delivery | Change Author | Human | Change Set | 无审查/发布权 |
| Delivery | Deterministic Builder | Script | Build Receipt | 无审查/发布权 |
| Assurance | Independent Code Reviewer | Human | Review Record | Change Review |
| Assurance | Deterministic Test Executor | Script | Test Receipt | 无审查/发布权 |
| Assurance | Security Reviewer | Human | Security Record | Security Review |
| Release | Local Specimen Release Owner | Human | Local Specimen | Local Release Approval |

硬约束：

- Change Author 不能取得 Change Review、Security Review 或 Release Authority；
- Release Owner 不能同时占据 Developer、Reviewer 或 Security Reviewer；
- 人工 Authority 必须与 Compile Request 中锁定的 actor 完全一致；
- Gate 全绿也不会自动取得 Authority；
- 所有发布决定只对 `local-specimen` 生效。

## 3. Artifact DAG 与局部恢复

```text
requirement
  → change-set
    → build-report
      → review-report
        → test-report
          → security-report
            → release-specimen
```

| Gate | Verification | Review | Evaluation | Human Authority | Failure recovery |
|---|---|---|---|---|---|
| Build Review | `check:build` | `review:independent` | `evaluation:diff-scope` | Change Reviewer | Change Author |
| Test Security | `check:test` | `review:security` | `evaluation:security-risk` | Security Reviewer | Test/Security Review |
| Release | `check:package` | `review:release-evidence` | `evaluation:release-risk` | Release Owner | Release Assembly |

恢复范围由 W82a `affectedArtifacts()` 从失败工件向下游计算。例如 Security 失败只失效 Security Report 和 Release Specimen，不回滚 Build、Review 或 Test。

## 4. 类型化回执

`mazz.software-release-tool-receipt/v0` 只允许四种 stage：

```text
build / test / security / package
```

每份回执必须固定：

- operation/tool/version；
- UTC 起止时间；
- status 与 exit code 的一致关系；
- 输入/输出 SHA-256；
- evidence refs；
- `nonProduction=true`；
- `pushed=false`；
- `published=false`；
- `externalMutation=false`。

回执不接受 shell command、环境变量、任意扩展字段或 secret。W82b 因而不能变成隐藏的命令执行器。

`mazz.software-release-authority-decision/v0` 只允许 `human:*` actor 和 `local-specimen` scope。决定与编译时 Authority Binding 不一致时，Gate 进入 `BLOCKED`，不能靠同为 Human 绕过身份绑定。

## 5. 状态闭集

| Slice state | 条件 | W73 projection |
|---|---|---|
| `COMPLETED` | Plan READY，三 Gate 均 APPROVED | `run-completed` |
| `UNKNOWN` | 缺回执、缺决定或证据为 unknown | `run-paused` |
| `RECOVERY_REQUIRED` | Plan BLOCKED、Gate failed/rejected 或 Authority 不匹配 | `run-recovery-required → blocked` |

`COMPLETED` 只代表本地 specimen 可封存。结果始终固定：

```json
{
  "nonProduction": true,
  "pushed": false,
  "published": false,
  "externalMutation": false,
  "productionReleaseAuthorized": false,
  "compilerOwner": "W82",
  "runtimeTruthOwner": "W73"
}
```

## 6. W73 所有权

`toW73ProductionRunEvents()` 只生成受 W73 schema 校验的事件草案：

1. `run-started`；
2. 每份回执对应 `artifact-recorded`；
3. 每项人工决定对应 `review-recorded`；
4. Gate 汇总对应 `audit-recorded`；
5. 完成、暂停或恢复三选一。

事件必须通过 `ProductionRunLedger.append()` 才成为运行事实。W82b 不持久化第二套 Runtime 状态，也不改写 W73 快照。

## 7. 安全边界

本模块是纯 CommonJS Foundation，只依赖 `crypto`、`plain-value` 和 W82a kernel，不依赖：

```text
child_process / fs / http / https / Electron / IPC / fetch / WebSocket
```

它不会：

- 运行 builder、测试或审计；
- 写文件或网络；
- 推送 Git；
- 构建生产安装包；
- 发布 GitHub Release；
- 触碰外部生产环境。

## 8. 本波未宣称

- W82c–W82h 未开始；
- W82 Sample E 仍未通过，因为 Research vertical slice 尚未落地；
- Organizational Compiler 的最终 DoD 未完成；
- 本地 specimen 不是正式 Windows 安装包发布验收；
- W82b 不授予任何生产发布权。
