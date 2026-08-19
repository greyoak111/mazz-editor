# W67 内存治理封波检查点（2026-08-19）

## 结论

W67 按历史总表规定的四个合同和真 Electron 泄漏门完成，状态为 `COMPLETE / FORMAL`。本波没有实现自动杀任务的“内存优化器”，而是把资源预算、累积器上限、可选监控、真实 Surface 回收证据和诊断纪律落成同一条可复验链。

## 已落地

1. 主进程 `MemoryGovernor` 每 5 秒采集 `process.memoryUsage()`、`app.getAppMetrics()`、event-loop lag 与 ResourceLedger，形成 Snapshot、Delta、12 点趋势和 120 点有界历史。
2. 预算覆盖总工作集、主进程 RSS、单进程工作集及 WebContentsView、PanelWindow、PTY、Torrent、Agent、外部工具、Archive、Feed 等原生资源。越界只发 `WARN/CRITICAL` 诊断，不擅杀用户任务。
3. 状态栏新增默认关闭的内存监控；命令 `view.toggleMemoryMonitor` 开关，点击读数可重置基线。
4. 启用 `--enable-precise-memory-info`；军规登记 Heap Snapshot 三点取样及“堆平/RSS 涨”原生泄漏判定法。
5. 累积器复核与补盖：图片 15、Draw 40、Browser 历史 200、ResourceLedger 200、Memory 120、Factory Agent 120、终端 scrollback 5000、Search 10,000 文件、Calc 128 结果/256 KiB 单结果、Python 16 MiB 输出/64 队列、SSE 2 MiB 单行、Agent JSONL 4 MiB 单行、Torrent 内联 32 MiB、下载任务 50、站点缓存 1000 + TTL。
6. `.audcache` 被明确为可重建派生缓存，执行 64 文件、2 GiB、30 天轮转；只允许删除该目录内普通文件。Torrent `download/` 是用户可见资产，不冒充缓存自动删除；内存任务表固定 50，用户显式“移除并删除”才删文件。
7. WebTorrent store 持续落盘而非吃内存；字幕等内联读取改为 32 MiB fail-closed。JSZip Archive 已在 Formal Gate 做 2 GiB 总量/512 MiB 单件和 staging；ffmpeg 转码临时文件、Blob URL、worker 均沿既有 destroy/terminate 路径释放。

## 真机数据

证据：[`W67_MEMORY_RUNTIME.json`](./evidence/W67_MEMORY_RUNTIME.json)

| 压力段 | 基线 | 峰值 | 全关后 | 回落率 | 资源结果 |
|---|---:|---:|---:|---:|---|
| 20 WebContentsView | 358.2 MiB | 2030.3 MiB | 353.7 MiB | 100% | `web-contents-view=0` |
| 20 PanelWindow | 353.7 MiB | 3039.7 MiB | 424.7 MiB | 97.36% | `panel-window=0` |

最终 ResourceLedger 活动数 `2 <= 基线 3`；两类目标资源均归零。峰值期间观测到 `CRITICAL`，说明预算告警确实工作；最大 event-loop lag 15 ms。

## 验证

- `npm run build`
- `node tests/unit/memory-governor.test.mjs`：3/3
- `node tests/unit/w67-accumulator-budgets.test.mjs`：4/4
- `node tests/unit/factory-sse.test.mjs`：6/6
- `node tests/contract/w65a-four-site-adapters.test.mjs`：12/12
- `node tests/contract/w71-lifecycle-security.test.mjs`：10/10
- `npm run test:w67:memory-runtime`：PASS；20 + 20 真 Electron Surface，回落率均 ≥90%

## 诚实边界

- 未执行 8 小时 soak、异机/低内存机、多 DPI/RDP/GPU/睡眠恢复矩阵；这些需要持续时间和外部机器，不以短测冒充。
- 工作集预算是本机初始诊断线，不是跨硬件 SLA；后续只能依据更多 profile 调整。
- 用户下载、源文件和工作区事实不是缓存，不自动轮转；本波只轮转可重建 `.audcache`。
