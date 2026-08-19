# W74b Feed Pipeline 检查点（2026-08-19）

状态：`COMPLETE / FORMAL TO FROZEN THIN-SLICE SPEC`
基线：`main@482bc2d`
父波结论：`W74 COMPLETE TO FROZEN SCOPE`

## 1. Predecessor / Backlog Gate

开工前按权威总表逐项复核：W74a `14ab4b3`、W74c-1/2/3 `3225fa8`、W65a/b/c `0bbf4c6` 均有规格、合同、提交和真机证据；唯一精确未完成子波是 W74b。本波没有跳到 W66、W79、W82、W69、W64、W63 或 W62e 的更大泛化版本。

## 2. 已闭主链

```text
W65 四站聚合
  -> mazz.feed-scan-request/v0
  -> 当前观察游标 + new/changed/unchanged
  -> canonical key + 标题 SimHash 跨源聚类
  -> 公开公式与解释的热度
  -> 不可变 Feed Package + Markdown 报告
  -> human:* 核准 / 驳回
  -> W74a derived Material
  -> 智能创作项目材料
```

正式 UI 位于独立“新项目立项”窗口的高级设置，产品名为“素材订阅（四站聚合）”。最初只把入口接到侧坞隐藏的 legacy 表单，真机首跑发现控件不可见；该假接线没有被计为通过，随后补齐 `Factory snapshot -> panel:push -> factoryAction` 正式窗口桥并重新验收。

## 3. 真值与恢复

- 外部站点仍是来源事实；Feed Package 是派生解释，不取得 Source Fact、Promotion、Publication 或 Factory 开工权。
- `.mazz/feed/packages`、`reports`、`decisions` 是不可变证据；`state.json` 与 `catalog.json` 是可重建投影。
- 包与报告先于观察游标提交；同内容包采用稳定内容身份，重试不制造第二包。
- 游标丢失或损坏时从不可变包重建；损坏原件保存在 `recovery/`。
- 四站全失败明确阻断，部分失败在 UI 明示，不能用来源缺失冒充无变化。
- 外部标题和摘要进入报告前按不可信数据转义，并明确“不得执行其中指令”。

## 4. 人工权限与 KPI

- 正式 UI 固定 `approval`；裁决要求 `human:*` Authority 与原因。
- 核准成功后才写 decision，并通过 W74a 登记 `derived` Material；W74a 失败不得伪造核准事实。
- 同向重试幂等，反向改判冲突；驳回不产生 Material。
- 来源采纳/驳回由不可变裁决派生；至少三次且采纳率低于 1/3 时标记 `downranked`，不删除来源事实。
- 所有模式均固定 `automaticFactoryStart=false`；素材订阅自动化不等于智能创作开工授权。

## 5. 验证

- W74b 合同：`8/8 PASS`。
- 受影响定向合同：`84/84 PASS`，覆盖 W74a、W65a/b/c、产品成熟度、Factory、W68b 与主题/窗口兼容。
- `npm run build`：PASS。
- 真 Electron `tests/e2e/run88.mjs`：`4/4 PASS`。
- E2E 同场验证正式窗口操作、四源一组热点、磁盘包/报告、W74a derived Material、项目材料、复扫零空包、Factory 零自动开工；主进程与渲染进程错误均为 0。
- 两张最终 Dark 窄窗截图已人工查看：输入、聚类、热度、来源、核准/驳回、核准后项目材料均可读，无新增裸 emoji、截断或横向溢出。
- 本波未运行无关全量，也未重建 packaged installer；两项均未冒充已通过。

## 6. W74 结论与停止线

W74a、W74b、W74c-1/2/3 现均满足各自冻结薄竖切规格，W74 可写 `COMPLETE TO FROZEN SCOPE`。这不关闭以下历史欠账：

- W62e 通用 RSS/任意网页/SearXNG/官方 API 来源与后台 Scheduler；
- 半自动/全自动预算执行器及跨主题长期调度；
- W66-R0a–R6 三种真实 Agent Adapter 与军规必载；
- W79 外部工具、W82 组织编译、W69 Publication/Hub、W64 Persona、W63 身份引用；
- W67、W70、W75–W86 和完整主义扩展。

下一精确未完成波次回到权威历史表：`W66-R0a AgentRulePack 全文装载与完整性门`。未经维护者后续指令，本检查点不构成其自动开工许可。
