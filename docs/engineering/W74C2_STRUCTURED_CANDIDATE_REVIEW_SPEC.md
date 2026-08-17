# W74c-2 Structured Candidate Review 施工规格

> 状态：FROZEN FOR IMPLEMENTATION
> 基线：`main@6a2e041`
> 日期：2026-08-17

## 1. 本波目标

在既有 W62f AI 对话整理、W74a Ingestion 与 W74c-1 local Promotion 之上，完成一条可验证薄竖切：

```text
当前勾选对话
→ 系统生成可编辑草稿
→ 人工选择候选类型并审阅正文
→ 明确批准或驳回
→ W74a 派生材料 + W74c Promotion 事实账
```

支持四类结构化候选：

- `stage-summary`：阶段总结；
- `decision`：正式决策；
- `method`：可复用方法；
- `finding`：事实发现。

## 2. 权力与数据边界

1. 系统只可提出草稿，不得根据语义自动批准、自动选择权威类型或绕过审阅。
2. 用户必须看到可编辑标题与正文，并明确点击“批准入库”或“驳回候选”。
3. 批准与驳回均要求 `human:*` Authority、理由与时间；候选来源继续精确绑定当前选择的消息 ID。
4. 候选正文进入 W74a `derived` 材料；Promotion event/catalog 只引用经校验的 W72 Asset Envelope，不复制正文。
5. 驳回保留材料与决定证据，但 Promotion 状态为 `rejected`，不得被消费者当成 active。
6. 每条事件继续固定 `automaticPromotion=false`、`publicationGranted=false`。

## 3. 身份、幂等与失败语义

- Asset/Candidate/Promotion 身份由项目、类型、标题、正文与来源的稳定指纹生成，不由文件路径或调用时间生成。
- 同一候选、同一决定重试必须幂等；同一身份异正文或异来源继续由 W74a/W74c 冲突机制阻断。
- W74a 登记成功、Promotion 写入前失败时，重试必须复用既有 Asset，不得复制材料。
- reject 是终态决定；被驳回内容若经人工修改，应形成新指纹与新候选，而不是改写旧决定。

## 4. UI 合同

在现有“AI 对话整理”面板内增加内嵌审阅区，不新建窗口：

- “提炼结构化候选”只冻结当前选择并打开审阅区；
- 类型使用专业术语：阶段总结、正式决策、可复用方法、事实发现；
- 标题和候选正文可编辑；
- 明确提供“驳回候选”“批准入库”“取消审阅”；
- 审阅期间禁止悄悄改变选择或重复提交；
- 继续满足实时主题、同组件族、滚动可达、零 emoji。

## 5. 本波明确不做

- 不调用模型自动总结、自动分类或自动批准；
- 不实现 W74c-3 Promotion 管理中心、历史列表、批量撤销或 supersede UI；
- 不产生 Publication、公共 evidence projection、Hub/Canon/World 对象；
- 不实现 W74b Feed、W65 爬取、全工作区扫描、Graph Bus 或万能数据库；
- 不迁移 W73 Factory、W69、W82 的事实所有权。

## 6. Final Gate

W74c-2 只有在以下条件全部满足时可标为 COMPLETE：

1. 四类候选和 approve/reject 严格合同通过；
2. 同候选重试幂等，正文不进入 Promotion 账；
3. W74c-1 现有资产升格路径不回归；
4. 真 Electron 中可编辑并批准一条结构化候选，磁盘材料与 Promotion 状态相符；
5. UI 截图人工复核通过，主/渲染进程零异常；
6. W74c 总波继续保持 PARTIAL，W74c-3 与公共投影仍留表。
