# W65a 四站 Adapter Foundation 检查点

状态：`COMPLETE TO SPEC / PARENT W65 PARTIAL`

日期：2026-08-18

## 1. 已完成

- 新增纯解析核心 `main/torrent-site-core.js`：13 字段统一行、BTIH 归一、四站三类解析器、infoHash 聚合。
- 新增礼貌访问层 `main/torrent-site-network.js`：每站串行、2 秒间隔、5/30 分钟缓存、2/8/20 秒退避、交互验证码熔断。
- 重写 `main/torrent-sites.js` 为 DMHY / Mikan / KissSub / ComiCat 四站注册；保留 `sites:list/search/home/magnet` 消费合同。
- 更新播放器：显示 `sourceSite/subgroup`，已知 magnet/infoHash 零详情请求，所有站点文本 HTML 转义。
- 旧 W23/W25 架构断言已按当前 W65 结构更新，并反钉 `dongmanhuayuan.com` / `dmhy-sync` 回魂。
- `tests/run.js` 已登记 W65a 合同。

## 2. 证据

### 2.1 确定性合同与构建

| 批次 | 结果 |
|---|---|
| `w65a-four-site-adapters` | 12 / 12 PASS |
| `player-w23` | 5 / 5 PASS |
| `player-w25` | 5 / 5 PASS |
| `w71-product-maturity` | 5 / 5 PASS |
| renderer build | PASS |

波及面仅为四站 Adapter、网络纪律、Player 网络资源面板及其 Preview 成熟度；未运行无关全仓 E2E。

### 2.2 实站结构探针

| 站点 | HTTP | 解析结果 |
|---|---:|---|
| DMHY | 200 | 当前资源表行 → 1 条有效统一行 |
| Mikan | 200 | 当前 Episode/Download 行 → 1 条有效统一行 |
| KissSub | 200 | 固定 visitor gate 后 show-hash 行 → 1 条有效统一行 |
| ComiCat | 200 | 固定 visitor gate 后 show-hash 行 → 1 条有效统一行 |

DMHY 搜索后端在早期探针中曾返回站内错误，故 W65a 不把“DMHY 搜索当日可用”写为完成条件；首页结构合同和软失败边界仍成立。

### 2.3 真 Electron

`tests/e2e/run11.mjs` 最终复跑：`5 / 5 PASS`。

- 四站选项顺序：`dmhy / mikan / kisssub / comicat`；
- 四站名称全部带 `（预览）`；
- Mikan 真实搜索：465 行；
- 首行恰为 13 字段，infoHash 合法；
- infoHash 直转 magnet，不访问详情；
- P2P daemon、range、媒体库扫描、留存/删除相邻链通过；
- renderer 零异常、main 零异常。

截图：[`evidence/W65A_FOUR_SITE_PREVIEW.png`](./evidence/W65A_FOUR_SITE_PREVIEW.png)，SHA-256=`DD48FCE45D2016C6D59ADF0253F71B8A689DA606B107D02943EB9E292C2CC271`，已人工回看。

## 3. 本轮发现并关闭的测试事故

1. 验证码合同首次虽显示 9/9，但队列 `finally` 派生出未消费拒绝。已改为显式成功/失败双分支收口；同批复跑无二次异常。
2. 旧 `player-w23` 仍钉已淘汰的 clone URL、私有 `resource-row` 和 `dmhy-sync`。已按当前架构更新并增加旧路线反断言。
3. 真机首跑的媒体库场景硬依赖系统 PATH 中的 ffmpeg，机器未安装导致 4/5。已改用 `seedFixtures` 自带合法 WAV，复跑 5/5。
4. PowerShell 探针一度误用保留变量 `$HOME`（大小写不敏感），命令在赋值处即失败、无文件改动。已改用任务专用变量；军规新增禁止复用保留/自动变量的明确条款。

以上失败均保留在检查点中，不用后续成功覆盖首失败事实。

## 4. 未完成 / 下一 Gate

W65 父波继续为 `PARTIAL`，至少还需：

- W65b：四站 live session、分页/增量、RSS/目录 fallback、站点健康与可恢复错误状态；
- W65c：多站复选、跨站 infoHash 聚合 UI、下载五态与取消/恢复；
- 通过 W65b/c 所需最小 Gate 后，才允许启动 W74b Feed；
- W74b 完成前，W74 父波继续为 `PARTIAL`。

W66-R0—R6、W79、W82、W69、W64、W62e 及总表其他历史欠账均未被本波替代或删除。
