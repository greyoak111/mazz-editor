# W65 四站网络资源封波规格

状态：`COMPLETE / FORMAL`

日期：2026-08-18

基线：`main@bbda4b2`（W65a Foundation）

直接消费者：W74b Feed（仍未施工）

## 1. Predecessor / Backlog Gate

| 核对项 | 结论 |
|---|---|
| 当前父波 | W74 `PARTIAL` |
| 精确未完成子波 | W74b Feed |
| W74b 前件 | W65 四站数据源能力 |
| W65a | `COMPLETE TO SPEC`，提交 `bbda4b2` |
| Human override | 维护者明确要求“把 W65 推完” |
| 本波资格 | 完成 W65b/c，关闭 W74b 的数据源前件；不启动 W74b |
| 仍保留的历史欠账 | W74b、W66-R0—R6、W79、W82、W69、W64、W62e 及权威总表其余 OPEN/PARTIAL 项 |

## 2. 封波能力

### 2.1 四站真实数据与恢复边界

- DMHY 主站与镜像检索、分页和搜索后端失败识别；
- Mikan 搜索、当前周历和年/季度目录；
- KissSub、ComiCat 分页、固定 visitor session 与 RSS fallback；
- 单站串行、全局并发上限 2、5/30 分钟缓存、2/8/20 秒有界退避；
- 网络失败可用陈旧缓存降级，结构错误不伪装成缓存成功；
- `unknown / healthy / degraded / failed / challenge` 健康快照与人工重置；
- 真实验证码或行为验证继续开路停机，不尝试绕过。

### 2.2 聚合与目录

- 四站可复选并行检索，自动分页限制为 1–3 页；
- 继续加载只请求仍有游标的站点；
- 统一资源行继续冻结为 13 字段；
- 只按 40 位小写 infoHash 聚合，同名异 hash 永不合并；
- 多源结果保留每个来源的 source URL、magnet/torrent URL；
- Mikan 周历与季度目录作为独立目录入口，不伪造成普通搜索结果。

### 2.3 主进程下载队列

冻结五态：

```text
queued → downloading → completed
   │          │
   ├──────── paused
   └──────── failed → retry
```

- 队列归主进程所有，不依赖播放器标签或 renderer 轮询存活；
- 支持加入、暂停、继续、失败重试、取消删除、边下边播与文件访问；
- renderer 只投影队列状态，打开下载页后才轮询；
- 当前保证应用进程生命周期内跨标签继续，不把应用重启后的持久续传冒充已实现。

### 2.4 正式产品入口

- 四站全部移除 Preview 标识并进入 Formal 成熟度；
- Player 固定四个来源页签：播放列表、媒体库、网络资源、下载；
- 网络资源页具有多站选择、聚合搜索、直接 magnet、站点健康、人工重置、周历/季度目录；
- 下载页具有明确空态、五态标签、进度/速度/peer 和与状态相符的操作；
- 目录首字封面只使用本地文字表现，不向第三方封面域发起额外请求。

## 3. 组件边界

```text
main/torrent-site-core.js
  ├─ 统一行 / infoHash / 多源聚合
  ├─ 四站列表、RSS、分页解析
  └─ Mikan 周历与季度目录解析

main/torrent-site-network.js
  ├─ per-site serial + global concurrency 2
  ├─ cache / retry / stale fallback / challenge circuit
  └─ health snapshot + reset

main/torrent-sites.js
  ├─ persist:mazz-torrent-sites session
  ├─ searchPage / searchMany / catalog / health / reset
  └─ DMHY mirror + UploadBT RSS fallback

main/torrent-daemon.js
  └─ main-owned five-state download queue

renderer/modules/viewer/player.js
  └─ formal four-site/catalog/download projections
```

站点 Adapter 不拥有 W74 Feed、W62e 内容投喂、Library、Publication、Universal Graph 或用户画像。

## 4. Final Gate

W65 只有同时满足以下条件才可写 `COMPLETE / FORMAL`：

- W65a 的统一行、解析、礼貌访问和验证码停机合同继续通过；
- 分页、RSS/目录 fallback、健康状态、stale fallback 与 reset 有确定性合同；
- 四站复选聚合只按 infoHash 合并，并有同 hash 多源实证；
- Mikan 真实周历/季度目录能返回非空数据；
- 下载五态、暂停/继续/重试/取消及主进程 ownership 有合同；
- 真 Electron 验证四站正式入口、目录、真实多源聚合、下载队列和主/渲染零异常；
- 两张最终 UI 截图经人工回看；
- 构建通过；
- W74b 继续明确为 `NOT STARTED`，其余历史欠账不被删除。

## 5. 非阻塞后续增强

- 应用重启后的下载任务持久续传；
- 用户可配置站点镜像或自定义 Adapter；
- 更大规模站点漂移 fixture 与长时间外网 soak；
- W74b Feed 对 W65 资源的增量消费。

这些事项不得反向抹掉当前封波证据，也不得在没有独立授权时夹入 W65。
