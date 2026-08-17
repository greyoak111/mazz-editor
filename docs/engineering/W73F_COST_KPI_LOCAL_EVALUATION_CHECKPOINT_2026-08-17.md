# W73f Cost / KPI / Local Evaluation — 检查点

> 状态：`COMPLETE`
> 开工基线：`main@3b924c2`
> 日期：2026-08-17
> 下一波：`W73g Director / Process Protocol Assets — NOT APPROVED`

## 1. 本波结论

W73f 已在 W73b–e 的同一条 W68 单次 Production Run 上补齐版本化成本、Metric、Formula、本地评价与 Pareto 事实。它没有重写 W68 的预算硬闸或审理语义，也没有把字符折算 token 冒充供应商实报、把缺失金额补成零、把局部指标揉成总分，或让 KPI 自动处罚 Seat、修改 Gate/方法。

本波关闭三个协议缺口：

1. 成本事实明确区分 estimate、provider-reported、settled-actual 与 unknown；
2. 九条评价轴、三张业务成绩单和七项系统健康 KPI 都有版本化定义、公式、样本窗、适用上下文与归因字段；
3. 任一已记录评价可从 Sample 钻回 Run、Task、Artifact、Finding/Gate 与当时存在的 Human Decision 引用，旧评价不会因新公式重算而被覆盖。

真实样本水位仍必须如实说明：当前 W68 `ReviewBudgetLedger` 只有字符折算估算，Provider chat 路径没有可验证 usage，仓库也没有已确认价格表或结算账单。因此协议已完成，但 provider-reported / settled-actual 覆盖和跨模型排名仍无资格宣称有效。

## 2. 冻结协议

新增：

```text
mazz.economics-evaluation-record/v0
mazz.cost-record/v0
mazz.price-table/v0
mazz.metric-definition/v0
mazz.metric-formula/v0
mazz.local-evaluation/v0
mazz.cost-summary/v0
mazz.pareto-frontier/v0
```

单 Run 存储继续使用：

```text
<factory-project>/.mazz/runs/<runId>/economics.ndjson
```

`ProductionRun v0` 只新增：

```text
economics-recorded
evaluation-recorded
economicsRefs[]
evaluationRefs[]
```

Prompt、模型回复、正文、API key、Authorization、原始环境变量和不可解释推理不进入该账本。

## 3. 成本真值纪律

| kind | 允许的数据 | 硬条件 |
|---|---|---|
| `estimate` | 本地估算 usage / amount | 必须写估算版本与 sourceRef |
| `provider-reported` | Provider 返回的 usage / amount | 必须写 provider、usage version 与 evidence |
| `settled-actual` | 已结算金额 | 必须写 currency、settled value 与账单 evidence |
| `unknown` | 缺失事实 | usage/amount 都保持 unknown，并写 reason |

W68 当前适配固定为：

```text
kind = estimate
usage.version = w68.review-budget-char-estimate/v0
amount.status = unknown
```

Price table 独立版本化，字段包含 provider/model、currency、effective-from/to、input/output per million 与 sourceRef。非结算金额若没有价格表引用会被拒绝；不存在默认价格或按模型名猜价格。汇总按四类分别出桶，`combinedTotal = null`。

## 4. Metric / Formula / Scorecard

九轴：

```text
Raw Ability
Governance Uplift
Final Quality
Governance Dependency
Reliability
Cost
Latency
Revision Cost
Canon Compliance
```

业务成绩单保持分离：

```text
Production
Author
Audience
```

MetricDefinition 保存 axis、direction、unit、scorecard、样本窗、适用上下文与 effective date；Formula 保存独立 id/version、operation、missing policy、precision 与 effective date。Evaluation context 可归因到 workflow/version、governance profile、artifact type、seat、executor、provider、model 与 defect class。

样本未知时 `fail-closed`；不适用写 `not-applicable`；未到最小样本窗写 `insufficient-sample`。当前 Raw Ability / Governance Uplift / Governance Dependency 因缺同任务匹配对照保持 unknown；Author/Audience 因缺显式反馈保持 unknown；Reliability 单样本不足，不会被一个成功 Run 冒充稳定性结论。

## 5. KPI 防 Goodhart

既有七项 `FACTORY_HEALTH_METRICS` 获得 system-health 版本定义：

```text
机检打回率
审理打回率
开庭率
修订一次通过率
质询有效率
撤回引据率
人类介入频次
```

所有 system-health 定义均钉死 `systemHealthOnly=true`，只作为趋势观察。没有任何代码把 KPI 自动用于：

- Seat 奖惩、证书签发或撤销；
- Gate 开关或方法修改；
- 调度最终决定；
- Promotion、Publication 或 Canon。

## 6. 透明本地评价与 Pareto

每个 Sample 都保存：

```text
sampleId → runId → taskRef
artifactRefs[]
findingRefs[] / gateRefs[]
humanDecisionRefs[]
evidenceRefs[] / observedAt
status / value / reason
```

公式升级通过新 Formula version 与新 Evaluation 记录完成；`supersedesEvaluationId` 连接新旧输出，旧值保持不可覆盖。`computeParetoFrontier()` 只输出非支配前沿、被谁支配和缺失哪些实测维度；不排序同一前沿，不生成隐藏总分，`overallScore` 固定为 null。

## 7. 同 Run 集成与恢复

W68 单次路径顺序为：

```text
旧 W68 工件落盘
→ W73c Finding/Rework 记账
→ W73f Cost/Evaluation 记账
→ Production Run review-recorded
→ 旧 W68 seal/block 逻辑继续
```

成本引用指向项目真实 `成本台账.json`；评价使用 W73c 返回的真实 Finding/Rework refs。max/legacy 不迁移。

账本具备：

- sequence 严格递增；
- recordId 精确幂等，同键异义拒绝；
- 同 Run 写串行；
- 尾损坏隔离为 `economics.ndjson.corrupt-tail.txt` 并阻断 Run；
- 中段损坏硬拒绝；
- 恢复只接受 `human:* + evidence`；
- dispose 等待在飞写并回到 `activeWrites=0`。

## 8. 验证水位

- W73f 新增合同：`9/9`；
- W73a–f 关联断言：`77/77`；
- renderer build：`PASS`；
- 全量 `node tests/run.js`：`168/168` 个测试文件通过（退出码 0）。

本波没有新增 UI，因此没有伪造截图验收。验证集中在 schema、重算、证据链、故障注入、资源释放和旧主链兼容。

## 9. 明确未做

- 伪造 Provider usage、默认价格、结算金额、Quota 或排名有效性；
- W68 max/legacy 迁移；
- W73g Director / Process Protocol Assets；
- W73h Electron/packaged/20-cycle soak；
- W69 Hub/Market/公开榜单或 W74 Promotion；
- W79 外部工具运行时、W82 Compiler、W64 人格呈现；
- 新 KPI UI、排行榜、One Overall Score、hidden AUTO 或第二 Factory。

下一建议薄波为 W73g，仍需维护者单独批准。
