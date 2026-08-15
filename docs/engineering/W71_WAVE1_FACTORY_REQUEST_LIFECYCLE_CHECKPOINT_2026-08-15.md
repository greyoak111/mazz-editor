# W71 Wave 1 Factory 请求生命周期检查点

> 日期：2026-08-15
>
> 承接坐标：`main@43a1a3a`
>
> 状态：Factory AI 请求、任务取消与 W68 补遗回写路径已收敛；**没有宣称 W68、Factory、Wave 1 或 W71 整体结案**

## 1. 本轮关闭的真实问题

此前桌面端 `chatStream()` 只在下一枚 SSE delta 到达时检查 `shouldStop()`。用户停止、任务暂停或 renderer 关签后，渲染层可以摘掉 `factory:aiChunk` 监听，但主进程的 `net.fetch`、SSE reader 和最长 300 秒 timer 仍继续存活。

并发任务还有第二个错误：任一任务被外部改为 `paused` 时，代码会把全局 `stopRequested` 置真，误停同批其他任务。非流式 W68 审理、勘误与快照请求也没有 task signal，可能在停止后继续占用请求并迟到改写状态。

W68 封存正文的人工修改会正确另立补遗，但编辑窗收到新路径后没有切换自身 `filePath`，导致二次保存仍从原件继续另开补遗，旧 W61b 实证也错误地要求封存原件被覆盖。

## 2. 收敛实现

### 主进程 request owner

- 新增 `FactoryAiRequestRegistry`，每个 chat/stream 请求持有唯一 `requestId`、`AbortController`、timeout、reader、renderer owner 与 ResourceLedger 记录；
- `factory:aiCancel` 成为显式白名单 IPC，取消会同时 abort fetch、cancel reader，并把资源状态转为 cancelling/cancelled；
- 非流式请求 180 秒、流式请求 300 秒由主进程 owner 统一超时；正常、失败、取消和应用退出都在 `finally` 关签；
- 同一 renderer 的 `webContents` 销毁时按 owner 批量取消，不能误杀另一窗口的请求；
- 应用 `before-quit` 统一销毁仍活跃请求；重复 requestId 被拒绝，避免旧请求和新 owner 相互覆盖。

### renderer Provider

- `chat()` 与 `chatStream()` 均接受 caller-owned `AbortSignal`；
- 桌面流式停止通过 75ms 轮询主动发出 `factory:aiCancel`，不再依赖下一枚 SSE 分片；
- listener、abort listener 与 polling interval 在 resolve/reject/abort 三路对称清理；
- 停止时把已有部分返回给 Factory 断点逻辑；主进程 timeout 则继续作为错误，不伪装成用户暂停；
- 网页直连 fallback 同样合并 caller signal、timeout、stop polling，并在退出时 cancel/release reader。

### Factory task owner

- 每个运行任务独占一个 `AbortController`；单任务 `paused` 只 abort 自身；
- “停止”按钮保持批次级语义，显式 abort 当前全部运行任务并阻止 worker 继续取队列；
- 蓝图、正文、W68 双审、勘误、纠偏和快照请求都穿入 task signal；
- 单次流式任务停止后写 `stopped`，不把半稿冒充正式成稿；连写任务继续保留 checkpoint；
- 取消在任务状态上归类为 `paused`，不再伪报 `failed`；删除运行任务和 Factory dispose 都会触发 abort；
- `beforeunload` 移除全局 task update listener，并取消 Agent runtime。

### W68 补遗回写

- 封存正文仍保持只读，人工修改继续写入带时间戳的 `.补遗-YYYYMMDDhhmmss.md`；
- `factoryEditSaved` 返回新路径后，编辑窗同步更新 `filePath`、`data-path`、标题与路径栏，后续保存落在同一补遗；
- W61b 真机实证改为核验实际保存目标，并在路径改道时强制断言它是 W68 补遗。

## 3. 可复验证据

### Unit / contract

[`factory-ai-requests.test.mjs`](../../tests/unit/factory-ai-requests.test.mjs) 覆盖：

```text
主进程 request begin / cancel / reader.cancel / release × 20
timeout owner 与 timer 清理
duplicate requestId 拒绝
app destroy 全量取消
renderer owner 隔离与越权取消拒绝
```

[`w71-factory-request-lifecycle.test.mjs`](../../tests/contract/w71-factory-request-lifecycle.test.mjs) 覆盖：

```text
renderer stream abort / listener 清理 × 20
无新 SSE 分片时 shouldStop 仍可取消
已有半稿返回 checkpoint 路径
非流式 chat abort
preload / main / ResourceLedger / timeout / owner-destroy 契约
Factory taskId AbortController 隔离
W68 补遗后编辑窗路径切换
```

结果：新增 unit `4 / 4`、contract `6 / 6`；全量 `npm.cmd test` 为 `136 / 136` 个测试文件通过。

### Electron W61b 场景

`node tests/e2e/run76.mjs` 结果 `5 / 5`：默认串行、双路真并发、独立预览、W68 补遗实际回写、人工修订标和双编辑窗排列全部通过；渲染进程与主进程异常警察为零。

### Windows packaged app

重新执行 `npm.cmd run dist:dir` 后，`release/win-unpacked/Mazz Editor.exe`（Electron `33.4.11`）连续 20 次执行：

```text
factory:aiChatStream
→ ResourceLedger 出现 factory-ai-request
→ factory:aiCancel
→ invoke 返回 cancelled
→ 活动资源回到启动基线
```

同一个 packaged smoke 同时重跑 PTY、PanelWindow、WebContentsView、FileWatcher、WebTorrent、Python、Viewer 和 Factory request 八族各 20 次。结果：启动基线 `2`，最终活动资源 `2`；释放历史 `160`；Harness Session `0`。

机器可读证据：[`W71_FACTORY_REQUEST_LIFECYCLE.json`](./evidence/W71_FACTORY_REQUEST_LIFECYCLE.json)。

## 4. 诚实边界

| 项目 | 当前结论 |
|---|---|
| renderer→main 显式取消、timeout、reader 与账本关签 | **PASS：contract + packaged 20 次** |
| 并发任务 owner 隔离 | **PASS：contract + Electron 双路实证** |
| W68 补遗真实路径续存 | **PASS：Electron E2E** |
| renderer crash/reload 按 owner 取消 | **LANDED + UNIT/CONTRACT；尚未做 packaged crash 注入** |
| 真实公网 Provider 的慢响应、断网、半包 SSE | **OPEN：packaged 使用本地 mock，不冒充外网实证** |
| Factory 长任务 RSS 斜率与数小时 soak | **OPEN** |
| Monaco worker、真实 Agent Adapter、多窗迁移、真实媒体设备 | **OPEN** |

历史 W62e、W63、W64、W65、W67、W69、W70 与 W72–W81 仍以交付区《Mazz 当前未落地全景-W71归并版》为唯一总表。本轮没有实施下一代 Factory、Task Capsule、Runtime、Replica、Snapshot/Delta 或 8 小时 soak。
