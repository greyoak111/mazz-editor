# W74c-3 Promotion Management & Evidence Projection 检查点

> 日期：2026-08-18  
> 基线：`main@55b5579`  
> 结论：`COMPLETE TO W74c-3 THIN-SLICE SPEC`  
> 子波状态：W74c-1、W74c-2、W74c-3 均 `COMPLETE`  
> 总波状态：W74 因 W74b 仍为 `PARTIAL`

## 1. Predecessor Gate

开工前逐项核验：

| 前件 | 规格 | 合同 | 真机 | 提交 | 总表状态 |
|---|---:|---:|---:|---:|---:|
| W74c-1 | PASS | `6/6` | `run87` 历史 PASS | `6a2e041` | COMPLETE |
| W74c-2 | PASS | `5/5` | `run87 7/7` | `0f7dd58` | COMPLETE |

权威总表在开工时明确写明 `W74c-3 NOT STARTED`。本波没有越到 W66，也没有把 W74b/W65 前置约束抹掉。

## 2. 已落能力

- 主进程新增严格管理查询与人工撤销请求，catalog 继续只由 Promotion event 重放生成。
- `supersedes` 产品接线完成：普通资产由下一次明确资产升格替代；阶段总结、正式决策、可复用方法、事实发现由下一次同类人工批准替代。跨类替代拒绝。
- 同一“AI 对话整理”面板新增本地升格管理区，可读显示 active/rejected/revoked/superseded 与 active/withdrawn 投影。
- 新增独立 Evidence Projection append-only ledger、catalog、conflict、recovery 与安全 artifact；生成和撤回均要求 `human:*` Authority 与理由。
- 公共安全工件不含正文、本地路径、来源 URL、消息 ID、原始 Authority 或 secret，并固定没有 Publication 权力。
- Promotion 后续失效时，管理 UI 将仍 active 的投影标为“来源失效”；消费者必须经过独立 W69 Gate 和当前 catalog 校验。

## 3. UI 与真实磁盘闭环

真 Electron `run87` 在真实临时工作区完成：

1. 当前选择升格为普通本地资产；
2. 正式决策候选人工批准；
3. 从 active 决策生成安全证据投影并核验 artifact 脱敏；
4. 人工撤回投影，catalog 变为 `withdrawn`；
5. 标记旧决策为同类替代目标，人工批准修订决策；
6. 旧决策变为 `superseded`，新决策为 `active`；
7. 人工撤销新决策，catalog 变为 `revoked`。

主进程和 renderer 异常均为 0。首次截图复核发现管理区滚动后标题被顶边截住，随后将标题和操作区改为吸附布局并重新构建、重跑真机；最终截图复核通过。

## 4. 验证结果

| 验证 | 结果 |
|---|---:|
| `npm run build` | PASS |
| W74c-3 合同 | `7/7` |
| W74c-2 兼容 | `5/5` |
| W74c-1 兼容 | `6/6` |
| W74a 兼容 | `8/8` |
| W62f 兼容 | `6/6` |
| W72 兼容 | `6/6` |
| 受影响合同合计 | `38/38` |
| 真 Electron `run87` | `9/9` |
| 主进程异常 | `0` |
| renderer 异常 | `0` |
| UI 截图人工复核 | PASS |

本波按军规 5b 不把无关全量当每次迭代默认税；最近已提交全量基线仍为 `173/173`。测试清单加入本合同后理论文件数为 178，不冒充已跑全量。

## 5. W74c 封波与仍存欠账

W74c 三个精确子波现分别为：

```text
W74c-1 Conversation → Asset → explicit local Promotion        COMPLETE
W74c-2 Structured Candidate editable human review             COMPLETE
W74c-3 Management / revoke / supersede / safe projection      COMPLETE
```

因此 W74c 可按冻结薄竖切规格封波。以下仍未实现且继续留在权威总表：

- W74b Feed Pipeline；
- W65 四站爬取及其对 W74b 的前置；
- W69 Publication / Hub / Canon / World；
- W66-R0—R6、W79、W82、W64 及其他历史欠账；
- 批量管理、网络发布、自动 Promotion、自动证据公开与 Universal DB/Graph。

W74 总波仍为 `PARTIAL`，不得把 W74c 完成写成 W74 全部完成。

## 6. 证据

- 施工规格：[`W74C3_PROMOTION_MANAGEMENT_PROJECTION_SPEC.md`](./W74C3_PROMOTION_MANAGEMENT_PROJECTION_SPEC.md)
- 机器证据：[`W74C3_PROMOTION_MANAGEMENT_PROJECTION_IMPLEMENTATION.json`](./evidence/W74C3_PROMOTION_MANAGEMENT_PROJECTION_IMPLEMENTATION.json)
- 管理 UI：[`w74c3-promotion-management.png`](../../tests/e2e/shots/w74c3-promotion-management.png)
- 真机脚本：[`run87.mjs`](../../tests/e2e/run87.mjs)

