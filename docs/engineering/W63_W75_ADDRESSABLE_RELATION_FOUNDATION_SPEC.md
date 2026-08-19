# W63 / W75 Addressable Evidence 与关系检索规格

> 日期：2026-08-19  
> 前件：W72 Asset Envelope Foundation  
> 状态：W63 `MARKDOWN PRODUCT SLICE LANDED`；W75 `EXPLAINABLE RETRIEVAL FOUNDATION LANDED`

## 1. 不变量

1. `Asset` 是领域事实，`Content Anchor` 是可解析地址，`Relation` 是可重建解释；不得把所有正文塞进万能图数据库。
2. Anchor ID 只绑定 `assetId + mediaType + logicalLocation`。路径、页码缓存、字符偏移和布局坐标只属于可更新的 `physicalLocation`。
3. 解析只能返回 `RESOLVED / AMBIGUOUS / MISSING`；歧义和失联不得静默跳到“最像的内容”。
4. Deterministic / Observed / Inferred 均为 Shadow Relation；只有 `human:*` 能把关系升格为 Promoted。
5. 检索结果必须携带评分理由；用户驳回的候选从下一轮结果排除。
6. 文件仍是真值；引用索引、Episode 与 Shadow Relation 都可重建。

## 2. 已落地契约

- Markdown：显式 `^block-id`、Heading Path、Text Quote fallback；
- Sheet：`sheetId + cellRange`；Mindmap：`nodeId`；Code：symbol / line；
- PDF、EPUB、Comic、Image：页/CFI/DOM/区域选择器；
- Video / Audio：毫秒时间段；Conversation：turn/message；Browser：canonical URL + DOM/quote；
- 活引用语法：`{{ref:文件!锚}}`；
- 工作区扫描：最多 10,000 个、单文件 5 MiB，忽略隐藏目录和 `node_modules`；
- 文件身份：同路径编辑保留 ID；同内容重命名可凭 fingerprint 重接；身份表写入应用设置，不污染领域文件；
- 侧栏既有“反链”页增加“活引用 · 我引用 / 引用我”，展示已解析、有歧义、已失联，点击可直达文件；
- `file:changed` 使索引失效并按需重建；工作区切换清空缓存；
- 关系检索按 Episode、speaker、item type、semantic hint、relation、current context 与时间方向给出稳定排序和解释。

## 3. 安全与边界

- IPC 只有 `scanWorkspace / fileRelations / invalidate` 三个白名单通道；renderer 不能向服务注入根目录。
- `fileRelations` 拒绝当前工作区外路径。
- schema 严格拒绝未知字段、secret、伪造稳定 ID、自环和重复身份。
- 内核不持有文件、网络、Electron 或进程执行权限；文件扫描由独立主进程服务持有。

## 4. 后续消费

W76 使用 Anchor/Relation 建立 `Node != Placement` 的多父上下文；W77 在 Shadow Relation 上增加观察、推断、人工升格和撤销；W78 复用多媒体 selector；W81 以 Workspace Event Ledger 生产 observed evidence；W85 Context Compiler 消费可解释候选，但不得自动取得 Authority。

## 5. 诚实停止线

本波不声称所有格式已有“创建锚点”UI：当前正式创建/阅读入口是 Markdown 活引用与统一侧栏；其他媒体已冻结可解析契约，需由 W78 各领域入口消费。W75 已有纯数据可解释检索内核，面向历史事件的完整产品 UI 由 W81/W85 接入后关闭。
