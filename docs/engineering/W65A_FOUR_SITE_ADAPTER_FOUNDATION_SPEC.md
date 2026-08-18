# W65a 四站 Adapter Foundation 规格

状态：`COMPLETE TO SPEC`

日期：2026-08-18

父波：W65 四站爬取

直接消费者：W74b Feed（仍未开工）

## 1. Predecessor / Backlog Gate

本波开工时当前权威总表为《Mazz 当前未落地全景-W71归并版》v1.59：

| 核对项 | 结论 |
|---|---|
| 当前父波 | W74 `PARTIAL` |
| 精确未完成子波 | W74b Feed |
| W74c-1 / c-2 / c-3 | 均 `COMPLETE` |
| W74b 前件 | W65 四站数据源能力 |
| Human override | 无改波授权；“继续”仍指向 W74 依赖链 |
| 本波资格 | W65a 是解除 W74b 阻塞所必需的前件施工，不是另选新波 |
| 仍保留的历史欠账 | W65b/c、W74b、W66-R0—R6、W79、W82、W69、W64、W62e 及权威总表其余 OPEN/PARTIAL 项 |

因此只允许落四站公共底座，禁止借机把 W65 或 W74 宣称完成。

## 2. 本波范围

### 2.1 落地内容

1. 四个主站严格 Adapter：DMHY、Mikan、KissSub、ComiCat。
2. 统一资源行 `mazz.torrent-resource-row/v0` 的 13 个冻结字段：

```text
title / date / size
seeders / leechers / completed
magnet / torrentUrl
sourceSite / sourceUrl
subgroup / resolution / infoHash
```

3. 32 位 base32 / 40 位 hex BTIH 归一为 40 位小写 hex。
4. 只按 infoHash 的多源聚合 `mazz.torrent-resource-aggregate/v0`；同名不同 hash 永不合并。
5. 每站串行、起点间隔至少 2 秒、列表缓存 5 分钟、详情缓存 30 分钟。
6. 429、5xx 和明确网络断连按 `2s → 8s → 20s` 有界退避；结构错误不重试。
7. 交互验证码触发站点熔断，后续零请求；KissSub/ComiCat 当前固定 visitor gate 只提交已公开的 `visitor_test=human`，失败即停止。
8. 主进程四站注册、旧 `sites:list/search/home/magnet` IPC 兼容和播放器统一行消费。
9. 站点文本进入 renderer 前按文本语义转义；已知 magnet/infoHash 时不再请求详情页。

### 2.2 明确停止线

以下不属于 W65a，仍不得报完成：

- 多站复选、跨站并行检索和聚合结果 UI；
- 分页/增量加载、RSS fallback、番组/季度/星期目录；
- 失败/排队/下载中/完成/取消五态下载队列；
- 站点健康页、用户端刷新熔断、镜像切换；
- W74b Feed、Episode Detection 或任何万能 Graph；
- 以在线探针通过替代离线解析合同；
- 去掉四站 `（预览）` 标识。

## 3. 当前站点证据与解析策略

| 站点 | 2026-08-18 现场结构 | W65a 策略 |
|---|---|---|
| DMHY | `share.dmhy.org` 首页资源表，行内已有 magnet、大小、三项活跃度和详情链 | 列表即形成完整统一行；旧 `dongmanhuayuan.com/resource-row` 路线淘汰 |
| Mikan | `/Home/Search?searchstr=`；`/Home/Episode/<hash>`、`/Download/<date>/<hash>.torrent` 与 `data-magnet` 同行 | 列表即形成完整统一行 |
| KissSub | 固定 visitor gate；搜索行为 `show-<40hex>.html` 五列结构 | 从详情文件名取得 infoHash，并生成最小 magnet；visitor gate 仅走固定值 |
| ComiCat | 与 KissSub 同源结构、独立域名和会话 | 使用同一纯解析函数、独立 siteId/sourceUrl 和访问队列 |

2026-08-18 实站抽样结果：四站 HTTP 均为 200；四个当前 HTML 行均被各自纯解析器解析为 1 条有效 13 字段资源行。Mikan 真实 Electron 搜索“魔法少女奈叶”得到 465 行；其首行与 KissSub/ComiCat 现场样本的 infoHash 同为 `5c2cf2a47fdc6c6389975d7ebdd5bd8ca0f436e2`。

在线站点可用性只是当日观测，不进入确定性完成定义。长期正确性以离线 fixture、结构漂移错误和 Preview 状态为准。

## 4. 组件边界

```text
main/torrent-site-core.js
  ├─ 13 字段归一与验证
  ├─ DMHY / Mikan / UploadBT 纯解析
  ├─ infoHash 归一
  └─ 多源聚合

main/torrent-site-network.js
  ├─ 每站串行与间隔
  ├─ TTL 缓存
  ├─ 有界退避
  └─ visitor gate / captcha stop

main/torrent-sites.js
  ├─ 四站注册
  ├─ Electron net transport
  ├─ IPC 兼容
  └─ Adapter 调度

renderer/modules/viewer/player.js
  └─ 统一字段显示与 magnet 直达
```

纯解析层和网络纪律层都不依赖 Electron，允许用冻结 fixture 做确定性合同；只有装配层接触 Electron `net` 和 IPC。

## 5. W65a Final Gate

以下各项必须同时成立才能写 `COMPLETE TO SPEC`：

- 四个主站均有注册项且全部为 Preview；
- 每个解析器至少一个离线真实形态 fixture 通过；
- 统一行恰为 13 字段且 infoHash 为 40 位小写 hex；
- 相同 hash 可多源聚合，同名不同 hash 不合并；
- 缓存、串行、最小间隔、有界退避、验证码熔断均有合同；
- 旧 DMHY clone / `dmhy-sync` 不得重新成为主路线；
- 主进程与 renderer 相邻合同通过；
- 真 Electron 至少验证四站列表、一个真实搜索、统一行和主/渲染零异常；
- UI 截图人工回看；
- W65 父波保持 `PARTIAL`，W74b 仍保持未完成。
