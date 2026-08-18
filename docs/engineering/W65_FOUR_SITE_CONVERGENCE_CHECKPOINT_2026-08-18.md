# W65 四站网络资源封波检查点

> 日期：2026-08-18
> 基线：`main@bbda4b2`
> 结论：`W65 COMPLETE / FORMAL`
> 后继：W74b Feed 仍为 `NOT STARTED`，W74 总波继续 `PARTIAL`

## 1. Predecessor Gate

W65a 的规格、合同、真机和提交均已核对为完整。本轮由维护者明确授权“把 W65 推完”，因此只关闭 W65b/c；没有越界启动 W74b、W66 或其他新波。

## 2. 已落能力

- 四站真实 session、分页、DMHY 镜像、KissSub/ComiCat RSS fallback、Mikan 周历/季度目录；
- per-site 串行、全局并发上限 2、健康快照、可恢复错误、陈旧缓存降级和人工 reset；
- 四站复选检索、1–3 页有界增量、infoHash 聚合及多来源保留；
- 主进程持有 `queued/downloading/completed/failed/paused` 五态下载队列；
- 暂停、继续、重试、取消、边下边播与文件访问；
- 四站网络资源、Mikan 目录和下载队列进入 Player 正式四页签入口；
- 产品成熟度由 Preview 晋升为 Formal。

## 3. 验证结果

| 验证 | 结果 |
|---|---:|
| `w65bc-convergence` | `8/8 PASS` |
| `w65a-four-site-adapters` | `12/12 PASS` |
| `player-w23` | `5/5 PASS` |
| `player-w25` | `5/5 PASS` |
| `w71-product-maturity` | `5/5 PASS` |
| 受影响合同合计 | `35/35 PASS` |
| `npm run build` | PASS |
| 真 Electron `run11` | `5/5 PASS` |
| 主进程异常 | `0` |
| renderer 异常 | `0` |
| UI 截图人工复核 | PASS |

按省算纪律未运行无关全量。最近已提交全量基线仍为 `173/173`，不得把本轮曾误启动但已中断的全量 runner 冒充测试通过。

## 4. 真实外部证据

2026-08-18 最终 Electron 复跑观察到：

- Mikan 当前周历 `92` 条、可选季度 `53` 个；
- Mikan 搜索“魔法少女奈叶”形成 `465` 个 infoHash 聚合项；
- KissSub 与 ComiCat 搜索“海贼王”各返回 `50` 条，`50/50` 均按相同 infoHash 合并为双来源；
- Mikan、KissSub、ComiCat 当轮健康状态为 `healthy/network`；
- Big Buck Bunny 真实 swarm 完成 metadata、range 取流、入队、暂停、继续和队列 UI 投影；
- 全程主进程与 renderer 零异常。

外站的当日可达性不成为永久正确性的唯一依据；离线 fixture、失败分型和健康/熔断合同继续承担确定性门禁。

## 5. UI 证据

- 四站聚合与周历：[`evidence/W65_FOUR_SITE_CONVERGENCE.png`](./evidence/W65_FOUR_SITE_CONVERGENCE.png)，SHA-256=`66B76E25B6C7C7FD7AC2480484E6286263E8A7071D9F04E49FC77CD1632B4990`；
- 主进程下载队列：[`evidence/W65_DOWNLOAD_QUEUE.png`](./evidence/W65_DOWNLOAD_QUEUE.png)，SHA-256=`886103876414A13FB2ACB77F08FE01335B514CFEFD1A010FF2F12171778FA95B`。

两图均已人工回看：入口、页签、状态、进度与可用动作无截断或折行回归。

## 6. 本轮发现并关闭的事故

1. 初次真机复跑让目录请求第三方封面，触发 184 条 CSP 错误。目录改为本地首字封面，随后主/渲染零异常。
2. Electron `net` 在 visitor gate 后没有稳定带回 Cookie，KissSub/ComiCat 被迫落到空 RSS。现显式保留已验证的固定 `visitor_test` Cookie；最终两站均为 network 且 50/50 多源合并。
3. 曾把合同文件参数传给 `tests/run.js` 并误以为会筛选，runner 实际忽略参数启动全量；发现非涉及域后立即中断。本事故已写入长期军规，后续定向合同必须直接执行目标测试文件或先核验 runner 参数契约。

## 7. 封波与停止线

W65a、W65b、W65c 均满足当前冻结规格，故 W65 状态升为 `COMPLETE / FORMAL`。这只解除 W74b 的数据源前件：

- W74b Feed 仍未施工；
- W74 总波仍为 `PARTIAL`；
- W66-R0—R6、W79、W82、W69、W64、W62e 与权威总表其余历史欠账继续保留；
- 应用重启持久续传、自定义站点、长时间外网 soak 为非阻塞后续增强，不冒充本轮完成项。
