# W74c-1 Local Conversation Promotion 施工规格

> 冻结日期：2026-08-17
> 开工基线：`main@14ab4b3`
> 状态：`W74c-1 COMPLETE TO THIN-SLICE SPEC`

## 1. 目标

W74c-1 只关闭一条真实用户路径：用户在既有 W62f“AI 对话整理”面板明确选中消息并点击“升格为本地资产”后，系统把选中对话先登记为 W74a `derived` 材料，再由具名 `human:*` Authority 作出本地 Promotion 决定。

候选可以由系统组装，但系统不能替用户批准。Promotion 只改变本机工作区内的资产状态，不等于 Publication、Hub、Canon、Decision 或方法改写。

## 2. 冻结边界

本波进入：

- 复用 W62f 九站采集、角色纠正与当前选择；
- 复用 W74a Ingestion 与 W72 Asset Envelope；
- `asset / stage-summary / decision / method / finding` 五种候选类型的严格本地协议；
- `approve / reject / revoke` 三动作；新批准可显式 `supersedes` 既有 active Promotion；
- human Authority、理由、来源、版本、时间、撤销与替代链；
- append-only event ledger、派生 catalog、幂等 command、冲突证据和损坏尾隔离；
- 现有 W62f 面板增加一个明确按钮，不新增页面或独立资产中心。

本波不进入：

- 自动识别 Decision/Method/Finding、模型自动 Promotion 或批量静默升格；
- Public/Hub/Publication/Canon、排行榜、公开 evidence projection；
- W74b Feed、W65 站点抓取、变化检测、聚类、热度或自动路由；
- 全工作区扫描、后台 watcher、SQLite、向量库、Universal Asset DB 或 Graph Bus；
- Promotion 管理中心、撤销/替代 UI、跨设备 Authority 签名；
- Factory seal、W73 Run 或 W69/W82 权力改写。

## 3. 数据契约

### 3.1 Conversation Promotion Request

`mazz.conversation-promotion-request/v0` 只接当前用户选择的 Markdown、来源元数据、工作区落点、`human:*` Authority、理由和决定时间。正文只交给 W74a；Promotion event/catalog 不保存正文。

### 3.2 Local Promotion Command

`mazz.local-promotion-command/v0` 固定：

```text
commandId / promotionId / projectId / projectPath
action = approve | reject | revoke
candidate = kind + W72 Asset Envelope ref + sourceRef + proposedBy/proposedAt
authorityRef = human:*
reason / decidedAt
supersedes[] = 仅 approve 可用
```

未知字段、secret、引用中夹带正文、非 `human:*` 决定、非法动作、悬空/非 active supersedes 和项目外 Envelope 全部 fail closed。

## 4. 文件布局与恢复

```text
<workspace>/.mazz/promotions/
├─ events.ndjson
├─ catalog.json
├─ conflicts/*.json
└─ recovery/corrupt-tail-*.txt
```

- event 全局 sequence 与 hash chain 连续；中段损坏拒绝猜测。
- 末行损坏先隔离原始证据，再从有效事件收口并继续。
- event 成功、catalog 写失败时，重放同 command 可重建 catalog。
- 相同 `commandId + commandHash` 返回 `ALREADY_APPLIED`；同 commandId 异决定只写 conflict，不改状态。
- 新 approve 可把列明的 active Promotion 标为 superseded；revoke 只接受 active 前态。
- `automaticPromotion=false`、`publicationGranted=false` 是逐事件硬边界。

## 5. W62f 产品接线

1. 用户在原 AI 对话整理面板勾选消息并可人工纠正角色；
2. 点击“升格为本地资产”；
3. W62f 只提交当前选择、来源 URL、站点、采集时间与消息 ID；
4. 主进程以确定性内容/来源指纹生成 Asset/Promotion/Command 身份；
5. W74a 先登记 `derived` Markdown，W74c 再引用它的 W72 Envelope；
6. 任一步失败都不覆盖已有材料或 Promotion，重试保持幂等；
7. 界面只反馈“身份、来源与撤销链已登记”，不暴露长内部 ID。

## 6. Definition of Done

1. 严格 schema、secret、正文偷渡、Authority 与动作边界有合同证据；
2. 一次明确动作同时形成 W74a 材料与 W74c local Promotion；
3. Promotion event/catalog 不含对话正文；
4. 同一选择重试不生成第二资产或第二决定；
5. approve/reject/revoke/supersedes 状态前提可验证；
6. command 冲突不修改当前状态；
7. 损坏尾隔离、中段损坏拒绝、catalog 可重建；
8. 真实 Electron 面板只消费当前勾选消息，主/渲染进程零异常；
9. 新按钮遵守既有主题、布局、滚动和无 emoji 图标纪律，截图复核通过；
10. W74b、自动语义升格、公开发布、Hub/Canon 与万能数据库保持未启动。

W74c-1 完成不等于 W74c 全部完成。结构化 Stage Summary/Decision/Method/Finding 的人工审核体验、Promotion 管理/撤销 UI、公共 evidence projection 仍须独立薄波。
