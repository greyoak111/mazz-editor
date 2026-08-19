# W74b Feed Pipeline 冻结规格

状态：`FROZEN FOR IMPLEMENTATION`
父波：W74 资产进入、关系与跨媒介组织
前件：W65 四站 Adapter、W74a Ingestion Pipeline
承接但不冒充：W62e 完整通用投喂系统

## 1. 本波边界

W74b 只完成一条可独立验收的薄竖切：

```text
W65 外部检索结果
  -> Feed 观察账（首次 / 变化 / 未变）
  -> 跨来源去重与标题 SimHash 聚类
  -> 可解释热度
  -> 按工作维度生成投喂包
  -> 人工核准 / 驳回
  -> W74a derived Material
  -> Factory 材料篮
```

Ingestion 与 Feed 不合并：

- W74a 处理“用户已有材料怎样进入项目”。
- W74b 处理“外界新料怎样被发现、比较、聚类、路由和核准”。
- Feed Package 是派生材料，不得升格为 Source Fact，不得直接改写项目设定。
- Feed 自动化权限不等于 Factory 自动开工权限；本波任何模式都不得自动启动 Factory。

## 2. 真值、派生物与文件布局

领域来源仍是外部网页、RSS、官方 API 或 W65 Adapter。Mazz 只保存观察证据和派生解释：

```text
<project>/.mazz/feed/
├─ state.json                 # 当前观察游标，可由扫描结果重建
├─ catalog.json               # 派生读模型，可重建
├─ packages/<packageId>.json  # 不可变投喂包清单
├─ reports/<packageId>.md     # 可读报告
├─ decisions/<packageId>.json # 一包一个不可变人工裁决
└─ recovery/                  # 游标损坏原件；state 从不可变包重建
```

不得保存密钥、Cookie、Authorization 或整页正文。投喂包只收标题、URL、短摘要、来源、观察时间、变化类型和聚类解释。

## 3. 冻结协议

### Feed Scan Request

Schema：`mazz.feed-scan-request/v0`

必填：`projectId`、`projectPath`、`query`、`dimension`、`mode`、`observedAt`、`sourceBatches`。

模式：

- `approval`：默认；一律等待人工裁决。
- `semi`：只产生自动化建议；事件性热点仍要求人工裁决。
- `full`：可标记“具备自动入料资格”，但 W74b 仍不自动启动 Factory。

当前正式 UI 只开放 `approval`。

### Feed Decision Request

Schema：`mazz.feed-decision-request/v0`

必填：`projectPath`、`packageId`、`action`、`authority`、`reason`、`decidedAt`。`action` 只能为 `approve` 或 `reject`；正式裁决只接受 `human:*` authority。

核准后，报告通过 W74a 以 `derived` 层注册，并返回 Material Reference；驳回不产生 Material。

## 4. 变化、聚类、热度

- 身份优先级：来源稳定 ID / infoHash / 规范 URL / 来源与标题的稳定摘要。
- 同一观察身份内容哈希变化记为 `changed`；首次为 `new`；相同为 `unchanged`。
- 精确去重优先 canonical key；近似聚类采用规范标题、64-bit SimHash 和词元相似度。
- “热点”必须满足至少两个独立来源且观察跨度不超过窗口；不得用单来源数量冒充跨源热度。
- 每个热度结果必须公开 `sourceCount`、`itemCount`、`spanHours`、`changedCount`、公式与文字解释。

## 5. KPI 与降权

来源 KPI 只由不可变人工裁决派生：核准计 adoption，驳回计 rejection。至少三次裁决且采纳率低于 1/3 时，来源读模型标记 `downranked`。降权是可解释排序信号，不删除来源事实。

## 6. 失败与幂等

- 相同包的同向重复裁决幂等返回。
- 同一包先核准后驳回（或反向）是冲突，不静默覆盖。
- W74a 注册失败时不得先写“已核准”裁决。
- 无新增或变化时返回 `NO_CHANGES`，不得制造空投喂包。
- 四站全部失败时返回 `W74B_ALL_SOURCES_UNAVAILABLE`，不得把来源缺失伪装成“没有变化”；部分失败必须在 UI 明示。
- `packages/` 与 `reports/` 必须先于观察游标提交；写包失败不得推进游标吞掉新料。
- `state.json` 丢失或损坏时从不可变投喂包重建，并保留损坏原件到 `recovery/`。
- 所有 IPC 输入严格字段白名单；禁止任意对象透传。

## 7. Final Gate

W74b 只有在以下条件全部满足时可标记 `COMPLETE`：

1. mock 多来源首次、复扫和内容变化合同通过；
2. 跨源去重、热度解释和确定性投喂包合同通过；
3. 核准真实生成 W74a derived Material，驳回不生成；
4. 三次低质量裁决能派生来源降权；
5. W65 -> W74b -> W74a -> Factory 正式入口可操作，产品名使用“素材订阅（四站聚合）”，不暴露波次黑话；
6. 真 Electron E2E 同时验证磁盘证据、UI 状态和错误监听；
7. 总表明确保留 W62e 的泛化来源、调度器和全自动预算治理欠账。

## 8. Stop Line

本波不实施 RSS 通用订阅器、任意网站爬虫、SearXNG 定时调度、官方 API 市场、后台常驻 Scheduler、Factory 自动开工、万能关系数据库或 W67 全局资源治理。这些仍保留在历史欠账表，不能被 W74b 的薄竖切“顺手宣布完成”。
