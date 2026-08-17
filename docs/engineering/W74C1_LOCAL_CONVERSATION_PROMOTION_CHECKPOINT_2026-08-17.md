# W74c-1 Local Conversation Promotion 检查点

> 日期：2026-08-17
> 开工基线：`main@14ab4b3`
> 结论：`PASS — W74c-1 COMPLETE TO THIN-SLICE SPEC`
> 机器证据：[`W74C1_LOCAL_CONVERSATION_PROMOTION_IMPLEMENTATION.json`](./evidence/W74C1_LOCAL_CONVERSATION_PROMOTION_IMPLEMENTATION.json)

## 1. 本波关闭的真实缺口

W62f 已能采集、纠正、筛选、导出、加入文风素材和无损提炼对话，W74a 已能把明确选入的本地材料登记进项目；此前两者之间仍没有“用户明确把当前对话选择升格为长期本地资产”的 Authority 闸，也没有撤销、替代、幂等、冲突和恢复账。

W74c-1 把这条窄路径接通，同时把 Public/Hub/Canon 与自动语义升格挡在本波之外。

## 2. 实现事实

- `main/promotion-ledger.js`：新增严格 local Promotion ledger；candidate 只引用当前项目材料区内可读且身份/类型/版本一致的 W72 Asset Envelope，不保存正文。
- 状态支持 active/rejected/revoked/superseded；`approve/reject/revoke` 均要求 `human:*` Authority 与理由，新 approve 可显式 supersede active 旧项。
- `events.ndjson` 使用 sequence/hash chain；坏尾隔离、中段拒绝。command 幂等，异义 command/state 只落 conflict，catalog 由事件重放生成。
- `main/main.js` / `preload/bridge.js`：只新增 `promotion:promoteConversation` 一条 IPC；主进程先走 W74a Ingestion，再落 W74c Promotion，部分成功可安全重试。
- `harvest-runtime.js`：只把当前勾选消息、来源 URL、站点、采集时间和消息 ID 送入本地升格；身份由主进程确定性生成。
- 既有 `harvest.html` 增加“升格为本地资产”按钮；无新窗口/页面。状态反馈已去除内部长 ID，主题、滚动和窄窗布局沿用原面板。

## 3. 验证矩阵

| 要求 | 证据 | 结论 |
|---|---|---|
| W74c 新合同 | `w74c-conversation-promotion.test.mjs` `6/6` | PASS |
| W74a 兼容 | W74a `8/8` | PASS |
| W62f 兼容 | W62f `6/6` | PASS |
| W72 Envelope 兼容 | W72 Foundation `6/6` | PASS |
| 真实 Electron | `run87.mjs` 最终 `6/6`；真实材料/Promotion 目录、当前选择隔离、正式术语 | PASS |
| 主/渲染异常 | Human watcher 报告主进程零异常、无 renderer 异常 | PASS |
| UI 视觉 | `tests/e2e/shots/w74c-local-promotion.png` 人工回看；按钮/反馈/溢出正常 | PASS |
| 构建 | `npm run build` | PASS |
| 无关全量回归 | 按军规省算纪律未运行；上一已提交水位 `14ab4b3` 为 `173/173` | NOT RUN / SCOPED |

## 4. 故障与权限语义

- 系统只能提出 candidate；没有 `human:*` 决定不得 active。
- 本地 active 不授予 Publication、Hub、Canon 或 Factory Gate 权力。
- 对话正文只在 W74a 材料快照；Promotion event/catalog 只存 Envelope ref 与来源。
- 同选择、同来源的重试得到同 Asset/Promotion/Command 身份；决定时间变化不制造假决定。
- 已 superseded/revoked 项不能再次被当 active 目标；状态冲突留下证据，不自动修正。
- events 已提交但 catalog 更新失败时，重试从事件重建目录；损坏中段不猜测。

## 5. 停止线

本波没有实现 W74b Feed、W65 四站抓取、自动 Stage Summary/Decision/Method/Finding 识别、Promotion 管理中心、公共 evidence projection、Publication、Hub、Canon、W69/W82 接线、全工作区扫描、向量库或万能 Graph。

W74c 标记为 `PARTIAL — W74c-1 COMPLETE`，不是总波封板。后续仍需从完整未尽总表选择 W74c-2（结构化候选/人工审阅）与 W74c-3（管理、撤销和公共投影边界）是否值得施工。
