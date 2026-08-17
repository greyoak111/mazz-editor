# W74c-2 Structured Candidate Review 检查点

> 日期：2026-08-17
> 基线：`main@6a2e041`
> 结论：`COMPLETE TO W74c-2 THIN-SLICE SPEC`
> 总波状态：W74c 继续为 `PARTIAL`

## 1. 已落能力

W62f “AI 对话整理”现可把当前冻结选择整理成四类结构化候选：

- 阶段总结（`stage-summary`）；
- 正式决策（`decision`）；
- 可复用方法（`method`）；
- 事实发现（`finding`）。

用户必须打开内嵌审阅区，查看并可修改候选类型、标题和正文，再明确批准入库或驳回。候选来源绑定当前选择的消息 ID；审阅期间选择被锁定，避免候选正文与证据集合漂移。

## 2. 数据与权力闭环

- 新增严格 `mazz.structured-promotion-review-request/v0`，未知字段、secret、正文夹带引用、非法类型、`revoke` 和非 `human:*` 决定全部 fail closed。
- 批准与驳回都会把候选正文登记为 W74a `derived` 材料，并生成 W72 Asset Envelope；Promotion event/catalog 只保存 Envelope 引用，不复制正文。
- 批准形成 `active`，驳回形成 `rejected`。相同候选与决定重试幂等；决定时间变化不复制材料或事件。
- candidate 可由 `system:w62f-structured-draft` 提出，但只有 `human:interactive-local-user` 可作决定。
- 所有事件继续固定 `automaticPromotion=false`、`publicationGranted=false`。

## 3. UI 与加载链

审阅区复用既有面板，不新增窗口。新增控件沿用主题变量、组件圆角与字体，审阅区有独立可达滚动，按钮无 emoji；最终截图人工复核通过。

真机首轮发现主窗 `panel:action` 汇聚正则没有接纳新动作，导致请求被静默丢弃。修复后增加合同反钉；随后明确重新构建 `renderer/dist`，避免“源码已改但消费方仍跑旧 bundle”。重建后一次既有采集启动时序未进入 W74c-2 场景，按军规单套复跑；最终完整批次 `7/7` 通过。

## 4. 验证结果

| 验证 | 结果 |
|---|---:|
| `npm run build` | PASS |
| W74c-2 合同 | `5/5` |
| W74c-1 兼容 | `6/6` |
| W74a 兼容 | `8/8` |
| W62f 兼容 | `6/6` |
| W72 兼容 | `6/6` |
| 受影响合同合计 | `31/31` |
| 真 Electron `run87` | `7/7` |
| 主进程异常 | `0` |
| renderer 异常 | `0` |
| UI 截图人工复核 | PASS |

本波按军规 5b 没有重跑无关全量；最近已提交全量基线仍为 `173/173`。测试清单加入本合同后理论文件数为 175，但不得据此宣称 `175/175` 已跑。

## 5. 停止线与余项

本检查点不实现：

- 模型自动总结、自动分类或自动批准；
- W74c-3 Promotion 历史/管理/撤销/supersede 产品界面；
- Publication、公共 evidence projection、Hub、Canon 或 World；
- W74b Feed、W65 四站源、全工作区扫描、Universal Graph/DB；
- W73/W69/W82 事实所有权迁移。

因此 W74c-2 可关账，但 W74c 总波仍为 PARTIAL。下一波必须重新按总表依赖选择，不能把本地 active Promotion 冒充公共发布。

## 6. 证据

- 施工规格：[`W74C2_STRUCTURED_CANDIDATE_REVIEW_SPEC.md`](./W74C2_STRUCTURED_CANDIDATE_REVIEW_SPEC.md)
- 机器证据：[`W74C2_STRUCTURED_CANDIDATE_REVIEW_IMPLEMENTATION.json`](./evidence/W74C2_STRUCTURED_CANDIDATE_REVIEW_IMPLEMENTATION.json)
- UI 截图：[`w74c2-structured-review.png`](../../tests/e2e/shots/w74c2-structured-review.png)
