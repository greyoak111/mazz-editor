# W76–W78 Context / Shadow Relation / Multimodal Evidence 规格

> 日期：2026-08-19  
> 前件：W63 Markdown Product Slice、W75 Retrieval Foundation  
> 状态：`LOCAL-FIRST PRODUCT SLICES LANDED`

## W76 — Multi-parent Context

- `Node` 持有唯一语义身份，`Placement` 只表示它在某个 Navigation Context 中的出现位置；
- 同一 Node 可有多个 Placement，每处拥有独立 alias/note/order；删除 Placement 不删除 Node 或领域资产；
- Context 父子关系强制 DAG，缺父、自环、祖先闭环全部拒绝；
- 文件 Node 消费 W63 稳定 assetId，不用路径冒充 identity；URL 去 fragment、默认端口并规范主机名；
- 既有侧栏增加“上下文”页：当前工作区文件或 Browser 网页可加入任意上下文；
- Browser 收藏夹可投影为 Context，原收藏不删、不改、不自动生成 O(n²) 关系。

## W77 — Shadow Relation / Promotion

- 同一 Context 共置只生成 `observed / co-placed-with` 建议；显示 confidence 与 evidence；
- Deterministic / Observed / Inferred 均为可重建 Shadow；Relation Graph 允许有环；
- 用户可忽略 Shadow；只有 `human:* + reason + decidedAt` 能生成 Promoted Edge 与 Promotion Record；
- 近义、共置、模型高置信均不自动写成 `sameConcept`，正文不注入满屏链接。

## W78 — Multimodal Addressable Evidence

- EPUB：`spineItemId + CFI` 优先，唯一 text quote fallback；字号/页宽只改 physical location；
- PDF：page + text quote；Comic：page + panel；Image：bbox；Video/Audio：毫秒时间；
- Viewer 的图片/PDF/音视频和 Library 的 EPUB/CBZ/PDF 均有“证据定位”正式动作；
- 工作区身份扫描覆盖文档、电子书、漫画、图片、音视频；大媒体只采 size + 首尾采样 fingerprint，不整文件读入内存；
- OCR 为空时，视觉标签/alt/perceptual hash 仍可检索；Index Chunk 只有 anchorRef，不取得 asset 身份；索引 lazy、可重建。

## 安全边界

- 所有 Context/Evidence IPC 显式白名单；根目录由主进程持有；
- 未知字段、secret、伪 ID、重复 ID、路径越界、Navigation 环和自动 Authority fail closed；
- Context/Relation 服务不执行工具、不连接网络、不发布；Browser 收藏只是兼容投影。

## 后续消费

W81 用 Event Ledger 形成 Episode 与 observed evidence；W85 将 Context/Episode/Anchor 编译为可审计 Context Bundle。W70 只能只读消费已升格证据，不能倒灌 Authority。
