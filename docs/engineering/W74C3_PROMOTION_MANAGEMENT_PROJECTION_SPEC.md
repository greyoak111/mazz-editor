# W74c-3 Promotion Management & Evidence Projection 施工规格

> 状态：IMPLEMENTED TO FROZEN THIN-SLICE SPEC  
> 基线：`main@55b5579`  
> 日期：2026-08-18

## 1. 本波目标

在 W74c-1 append-only local Promotion 与 W74c-2 结构化候选人工审阅之上，关闭 W74c 最后一段产品化缺口：

```text
本地 Promotion catalog
→ 同一 AI 对话整理面板内可见、可选、可管理
→ human:* 明确撤销 / 同类批准替代
→ human:* 明确生成去敏证据投影
→ human:* 可撤回投影
→ W69 独立 Publication Gate（本波不实施）
```

W74c-3 完成后，W74c-1/2 已有状态机不再只停留在主进程能力；用户能看见历史状态并完成一条真实撤销、替代与安全投影闭环。

## 2. Promotion 管理合同

1. `mazz.promotion-management-query/v0` 只按明确项目读取由事件重放得到的 catalog；账本坏尾可隔离，中段损坏继续拒绝。
2. `mazz.promotion-revoke-request/v0` 只接受 `human:*` Authority、理由和 ISO 时间；只有 `active` Promotion 可撤销。
3. 新批准可通过已有 `supersedes` 机制替代一个同类 `active` Promotion；跨 kind 替代必须 fail closed。
4. `superseded`、`revoked`、`rejected` 均保留历史、Authority、理由、sequence 与 event hash，不删除、不覆盖旧决定。
5. 管理 UI 不显示内部长 ID；用户只看到专业类型、来源、决定时间和可读状态。

## 3. 公共证据投影边界

本波的“公共 evidence projection”只意味着：生成一个将来可提交给独立发布闸的公开安全形状，不意味着已经发布。

严格对象：

- 请求：`mazz.evidence-projection-request/v0`；
- 事件：`mazz.evidence-projection-event/v0`；
- 本地目录：`mazz.evidence-projection-catalog/v0`；
- 安全工件：`mazz.public-evidence-projection/v0`。

安全工件只允许包含：

- 确定性 projection / Promotion / Asset / Candidate 身份；
- Promotion kind、Asset type/version；
- 白名单化来源摘要（站点、Adapter、采集时间、候选类型）；
- Promotion sequence、event hash、catalog hash；
- 人类决定类别与投影时间；
- 明确的权限停止线。

安全工件禁止包含：

- 正文、Prompt、模型回复或推理；
- 本地文件路径、工作区名称明文；
- 来源 URL、消息 ID；
- secret、Cookie、令牌或原始 Authority 身份；
- `publicationGranted=true`、`published=true` 或自动发布权。

每个工件固定：

```text
contentIncluded=false
localPathIncluded=false
sourceUrlIncluded=false
messageIdsIncluded=false
publicationGranted=false
published=false
requiresIndependentPublicationGate=true
```

投影事件另立 append-only hash chain，支持坏尾恢复、幂等 command、状态冲突证据和显式 `withdraw`。撤回不删除历史安全工件；当前 catalog 状态才是消费者判断依据。

## 4. UI 合同

继续复用现有“AI 对话整理”面板，不新增窗口或管理中心：

- “管理升格记录”打开内嵌管理区；
- 列出所有 Promotion 与证据投影状态；
- active Promotion 可撤销、标记为下一次同类批准的替代目标或生成证据投影；
- active 投影可撤回；
- 撤销、投影、撤回均必须填写原因；
- asset 目标由下一次“升格为本地资产”替代，四类结构化目标由同类候选批准替代；
- 标题与操作区在滚动时吸附，主题、滚动、键盘焦点和零 emoji 纪律继续成立；
- UI 明示“本地投影不等于 Hub/公开网络发布”。

## 5. 失败与恢复语义

- 非 human、未知字段、secret、伪 projectionId、inactive 撤销/投影、跨类替代全部 fail closed；
- 状态冲突只写 conflict evidence，不改 current；
- Promotion/Projection catalog 均从 append-only events 重建；
- 投影写账后 artifact 写入失败时，同 command 重试会补写工件；
- 已撤销的 Promotion 不得新建投影；已有投影若来源随后失效，UI 明示“来源失效”，W69 不得消费为可发布证据；
- renderer 错误保持当前对话选择和管理现场，不清空用户工作。

## 6. 本波明确不做

- 不实现 Publication、Hub、Canon、World、账号、网络上传或公开 Seed；
- 不把 `active Promotion` 或本地投影冒充已发布内容；
- 不实现 W74b Feed、W65 四站爬取、W69、W77 或 W82；
- 不实现批量自动撤销、自动替代、语义自动分类或自动投影；
- 不建设 Universal Asset DB、Graph Bus 或第二套 Promotion 真相源；
- 不把正文复制进 Promotion/Projection 账。

## 7. Final Gate

W74c-3 只有在以下条件全部满足时可标为 COMPLETE：

1. 管理查询、同类替代、撤销、投影、撤回严格合同通过；
2. 非 human、跨类替代、inactive 状态、secret、伪 ID 均确定性拒绝；
3. 两类账本坏尾可恢复、中段损坏拒绝、current 不被冲突改写；
4. 安全投影逐字段证明不含正文、路径、URL、消息 ID 或发布权；
5. 真 Electron 中完成投影→撤回、替代→撤销，磁盘 catalog 与 UI 一致；
6. UI 截图人工复核通过，主/renderer 零异常；
7. W74c 标为 COMPLETE，但 W74 总波继续因 W74b 保持 PARTIAL；W69 Publication 仍为独立未授权 Gate。

