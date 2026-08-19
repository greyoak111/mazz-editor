# W82c Research / Evidence Organization Slice

> 状态：`LANDED — LOCAL NON-PUBLISHED RESEARCH SLICE`
> 版本：v1.0
> 日期：2026-08-19
> 前件：W82a Organizational Kernel、W82b typed evidence pattern、W73 Production Run Ledger

## 1. 目标与边界

W82c 把 Research 从 W82a 纸面 fixture 推进为可验证的本地 vertical slice：

```text
Question → Literature → Method → Data
→ Deterministic Statistics → Interpretive Analysis
→ Adversarial Review → Replication → Local Report
```

本波只生成本地研究 specimen，不联网检索、不运行真实模型/统计程序、不提交期刊、不公开报告。受控执行过程先产生类型化 receipt，W82c 只校验 receipt、人工决定和状态跃迁；W73 继续持有唯一运行真相。

## 2. 三类认知劳动分权

| 类型 | Seat / Executor | 能做什么 | 不能做什么 |
|---|---|---|---|
| Evidence | Literature Researcher / Data Steward | 固定来源、引文、数据快照和完整性 | 不能推断缺失来源 |
| Deterministic calculation | Statistician / Script | 执行声明的统计与复现 | 不能用模型文字替代数值 |
| Model judgment | Interpretive Analyst / Agent | 解释证据、表达不确定性 | 不能自证、不能取得 Authority |
| Independent review | Adversarial Reviewer / Human | 反驳、查遗漏与反证 | 不能兼任分析作者 |
| Human Final | Research Lead / Human | 签发本地报告 | 不能自动取得 Publication |

## 3. Artifact DAG 与四道 Gate

九工件：Question、Literature、Method、Data、Statistics、Analysis、Adversarial Review、Replication、Report。

| Gate | Verification | Review / Evaluation | Authority | Recovery |
|---|---|---|---|---|
| Evidence Method | Citation receipt | Method / design decision | Method Owner | Literature / Method |
| Analysis Review | Data、Statistics、Analysis Trace receipts | Adversarial / claim-strength decision | Analysis Reviewer | Data / Statistics / Analysis |
| Replication | Replication receipt | Reproducibility decision | Replication Owner | Replication only |
| Report | Report audit receipt | Evidence/readiness decision | Research Lead | Report only |

缺证据保持 `UNKNOWN`。失败、拒绝、Authority actor 不匹配或作者自占最终权限进入 `RECOVERY_REQUIRED`。

局部恢复由 Artifact DAG 计算：

- Citation 失败不污染 Question；
- Statistics 失败不回滚 Literature、Method 或 Data；
- Replication 失败只失效 Replication 与 Report；
- Method 变更使 Data 及下游失效，但保留已验证 Literature。

## 4. 严格证据协议

`mazz.research-evidence-tool-receipt/v0` 只允许：

```text
citations / data-integrity / statistics /
analysis-trace / replication / report-audit
```

每份 receipt 固定 tool/executor/version、时间、exit code、输入输出 SHA-256、evidence refs 和 `local-research-specimen` scope，并强制 `published=false / externalMutation=false`。任意 command、env、secret、未知字段或伪 exit code 均拒绝。

`mazz.research-evidence-authority-decision/v0` 必须由 `human:*` actor 签发，且 actor 必须等于 Compile Request 的 Authority Binding。Gate 全绿不会自动赋权。

## 5. W73 投影

完成、未知、失败分别投影为：

```text
COMPLETED         → run-completed
UNKNOWN           → run-paused
RECOVERY_REQUIRED → run-recovery-required / blocked
```

只有事件实际 append 到 W73 Production Run Ledger 后才是运行事实。W82c 不持久化第二套研究运行数据库。

## 6. 停止线

- W82c 已落本地未发布 Research/Evidence Slice；
- 与 W82b 共同证明两个非相邻领域可复用同一 W82 kernel，但 Sample E 仍缺“失败后修复并完成”的双域完整实物链，不能宣称 Sample E 已通过；
- 不宣称研究结论真实、可发表或可复现于外部数据；
- W82d–W82h、Hub Publication、真实 Agent/Tool 执行和完整 Organizational Compiler DoD 仍未完成。
