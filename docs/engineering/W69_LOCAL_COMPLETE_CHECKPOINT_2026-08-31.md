# W69 MazzHub 本地闭环检查点（2026-08-31）

> 状态：**LOCAL COMPLETE / PUBLIC EFFECT DISABLED**
> 上位计划：[`W69_MAZZHUB_LOCAL_FIRST_CONTENT_NETWORK.md`](../plans/W69_MAZZHUB_LOCAL_FIRST_CONTENT_NETWORK.md)
> 复用运行时：[`W94G_WORLD_HUB_PUBLIC_PLANE_SPEC.md`](./W94G_WORLD_HUB_PUBLIC_PLANE_SPEC.md)

## 1. 本检查点的完成口径

“本地完成”表示一个人可在同一台机器上复验 MazzHub 的对象、页面、状态与 fake-Hub 发布闭环；
不表示真实账号、公共送达、远程审核、P2P 分发或生产 Public Effect 已完成。

本波直接复用：

- W94Ga `.mazz/world` 的 World / Branch / Proposal / Review / Merge 本地真相；
- W94Gb `WorldHubPublicationService` 的 envelope / manifest / grant / command / receipt / projection；
- 浏览器 `localStorage` 的收藏、关注、稍后、进度、历史、合集、本地评论、通知已读和治理队列。

网站没有另造 Publication 或 World 契约，也没有把 fixture 冒充公共送达。

## 2. 已完成的本地部分

| 计划关节 | 本地完成结果 | 真相位置 |
| --- | --- | --- |
| Creator / Profile | 稳定 Creator 页面、作品/系列聚合、关注和本地 Analytics 投影 | public fixture + browser state |
| Work / Publication Page | 详情、版本、标签、系列、manifest/grant/provenance 核验 | public fixture / fake-Hub snapshot |
| Search / Topic / Tag | 全局搜索、媒介筛选、标签入口、系列匹配 | 浏览器内确定性筛选 |
| Favorite / Later / Progress / History | 收藏、稍后、25–100% 进度、历史恢复 | `localStorage` |
| Series / Collection | 公开 Series 与用户本地 Collection 分离 | fixture + `localStorage` |
| Comment / Reply | 独立本地 Event，回复不修改 Publication blob | `localStorage` |
| Notification Inbox | 更新、回复、World 事件和已读状态 | fixture + `localStorage` |
| Creator Studio | 明确表单 → content hash/manifest → Grant/signature → prepare | W94Gb fake-Hub |
| Version / Receipt | prepared / published / withdrawn、sync、receipt 历史、刷新恢复；published 自动进入作品库，withdrawn 自动退出 | `.mazz/hub/fake-store.json` |
| Report / Block / Permission | 可逆本地屏蔽、举报队列、权限分层页 | `localStorage` |
| Following / For You / Charts / Explore | 四路分离；For You 只按本地收藏标签，Charts 单独排序 | 浏览器本地投影 |
| Explainable Charts | Attention / Creation 分轴、公式、窗口、衰减、反作弊与 Official 不加权 | versioned fixture |
| World public view | Authority/Audience 分离、Branch/Proposal、Fork 打开意图 | W94Ga public-safe projection 边界 |

## 3. 本地发布闭环

```text
人工填写公开字段并确认
→ 浏览器生成 content-addressed manifest
→ 复用 W94Gb preparePublication
→ 人工再次点击 Publish
→ published projection 进入本地作品库与详情
→ sync public-safe snapshot
→ Withdraw public projection
→ withdrawn projection 从发现面退出，本地 Work / Receipt 保留
→ reload 后 projection / receipt 仍可恢复
```

服务器只绑定 `127.0.0.1`。`/healthz` 始终返回：

```text
publicEffect=disabled
localHubEffect=fake-only
```

网页本地写入 API 只映射 W94Gb 已有四个动作：prepare、publish、withdraw、sync。
Store 不保存 Grant、`sourceArtifactRefs` 或公开样本文本，只保存公共包络、manifest、命令摘要和 receipt。

## 4. 每波必查结果

| 检查 | 结果 |
| --- | --- |
| `node --check`：网页、服务器、契约 | **PASS** |
| `npm run test:w69:local-hub` | **2/2 PASS** |
| API：prepare → publish → sync → withdraw | **PASS** |
| Public Effect / networkCalls / authorityGranted | **disabled / 0 / false** |
| Store 私有字段、正文、路径、URL 扫描 | **PASS** |
| 浏览器：发现、作品详情、进度、收藏、稍后、合集 | **PASS** |
| 浏览器：评论、通知、Creator/Profile、Series | **PASS** |
| 浏览器：World Governance、Charts 公式、治理页 | **PASS** |
| Creator Studio + receipt + reload 恢复 | **PASS** |
| 390×844 响应式断点 | **PASS** |
| 浏览器 console error / warning | **0** |

## 5. 还剩哪些

以下均不再是“本地网站页面没做”，而是需要真实外部系统或跨设备证据的后续工程。

### A. 公共服务与账号

- 真实 Creator/User/Device 身份、登录、会话、恢复与删除账号；
- 多用户 Follow、Comment/Reply、Notification、Report/Block/Moderation 持久服务；
- 公开 Creator Studio、远程版本管理、撤回传播、审计和限流；
- 数据库备份恢复、日志轮转、资源告警、incident drill 与双域/TLS 完整门；
- 人类另行授权后才可开启 VPS Public Effect。

### B. Content Fabric 与真实消费

- Manifest 对应的真实 Text/EPUB/Comic/Audio/Video 字节与 Renderer；
- HTTP range、P2P/Web Peer/Mazz Peer、LAN/NAS、缓存去重、Seed 和 Origin fallback；
- 冷启动、Seek、多清晰度、极冷内容和撤回传播；
- Encryption / Entitlement / Key Envelope / Runtime Permission 的真实权利路径。

### C. Mazz 桌面桥接

- Creator Studio 从真实 Local Asset / Factory Final / W74c Promotion 接收 manifest，而不是手填样本；
- 网页“在 Mazz 中打开 World”连接 W94Ga IPC，完成 public World acquire → local fork；
- 真实 Reader/Player 进度与网站历史双向同步；
- 本地 Comment/Danmaku Adapter 与公共 Event Feed 同步，但不混写媒体内容。

### D. 真实 Charts 与治理

- 真实公共事件采样、反作弊、窗口重算、公式版本迁移与公开导出；
- Creator Analytics 的真实完成率、收藏转化、讨论和衍生信号；
- 公共审核队列、申诉、权限角色和地区/许可策略。

### E. W69e–m 尚未施工的公共能力

- W69e/f Content Fabric 和跨媒介 Hard Sample A；
- W69g–i World 获取、Fork-to-Factory、Branch Publication 和社区闭环 Sample B；
- W69j–l Production Evidence / AI Market / Router / Team / Challenge Sample C；
- W69m Workflow Publication / Fork / migration / entitlement 及 Sample D/E 公共投影；
- Monetization、复杂实时 Room、联邦与支付仍后置。

## 6. 结论

本地网站与本地 fake-Hub 可以写 **LOCAL COMPLETE**。W69 全体仍不能写 PASS：真正剩余工作已经收敛为
公共服务、真实分发、桌面桥接和 W69e–m，而不是继续补本地占位页面。本波未操作 VPS。
