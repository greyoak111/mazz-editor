# W71 Wave 1 / Wave 2 Monaco 生命周期与打包 Worker 检查点

> 日期：2026-08-15
> 父坐标：`main@a7fbcf8`
> 范围：Code 宿主生命周期、Monaco TypeScript worker 的 packaged 真激活
> 结论：**子 Gate 通过；不代表完整 Wave 1 / Wave 2 退出**

## 1. 本轮为什么施工

W71 要求 packaged app 中 Monaco worker 真实可用，并要求 20 次打开/关闭不产生持续累积。施工前只有 worker 文件和“编辑器能挂载”的证据，Code 模块本身没有 `dispose(state)`：

- Monaco editor/model 没有随标签销毁；
- 主题 `MutationObserver`、内容待装载 interval 与拖拽全局 listener 没有统一 owner；
- TerminalPanel 的 `term:data` / `term:exit` 订阅不退；
- DebugService 的 DAP 事件、gutter timer 与 Monaco disposable 不退；
- `getMonaco()` 迟到后可能在已关闭宿主上重新创建 editor/model。

因此本轮不是补一个存在性测试，而是先消除真实生命周期根因。

## 2. 已落地改造

### 2.1 Code owner

- 新增幂等 `dispose(state)`；
- 关闭标签时统一销毁 editor、model、主题 observer、pending interval、短 timer、拖拽全局 listener、TerminalPanel、DebugService、DOM、实例表和活动锚点；
- `getMonaco()` 与内容装载的异步续段都重验 `disposed`，宿主先死时不再物化资源；
- Monaco model/editor 的事件返回值进入 disposable 清单。

### 2.2 Terminal / Debug 子 owner

- TerminalPanel 保存 preload `on()` 的退订函数，`dispose()` 逐个 kill PTY 并摘除事件；
- Terminal 创建过程中宿主死亡时，迟到创建的 PTY 立即 kill；
- DebugService 退役 DAP 事件、gutter timer、鼠标 disposable、装饰、面板；活动调试会话同时请求 `debug:stop`。

### 2.3 Worker 可观测性

`MonacoEnvironment.getWorker()` 记录 created / active / terminated / errors / byLabel，并包装真实 `Worker.terminate()`。这份计数只用于证明 runtime 行为，不把 Monaco 的有界共享缓存误报为泄漏。

## 3. 验证结果

| Gate | 结果 |
|---|---|
| 新增生命周期契约 | `5/5` |
| Code / Terminal 相关定向契约 | `13/13` |
| 全量测试 | `137/137` 文件通过 |
| `npm run dist:dir` | PASS，Electron `33.4.11` |
| app.asar 内容 | `editor.worker.js`、`ts.worker.js`、`codicon.ttf` 均存在 |
| 迟到初始化 | 创建 Code 后立即关签，等待 1.5 秒，无 editor/model/DOM/活动锚点复活 |
| packaged TypeScript worker | 20/20 轮返回真实 `TS2322` 语义诊断 |
| packaged Code 开关 | 20/20 轮关闭后 Monaco model=`0` |
| Worker 错误 | `0` |
| Worker 有界账 | 代表性末轮 `created=18, terminated=16, active=2`，满足 `created=terminated+active` |
| 主进程资源账 | 启动/最终 `2→2`，既有八类资源回归不退化 |

Worker 创建数会受 Monaco 内部闲置回收时序影响，因此 Gate 使用有界不变量：

```text
errors == 0
modelsAfterClose == 0
active <= 2
created == terminated + active
20 轮 created <= 22
```

不要求每次关编辑器都杀掉共享语言 worker；那会把正常缓存替换成性能抖动。

机器证据：[`evidence/W71_MONACO_LIFECYCLE.json`](./evidence/W71_MONACO_LIFECYCLE.json)。

## 4. 本轮关闭与未关闭

已关闭：

- packaged Monaco TypeScript worker 真激活；
- Code editor/model/observer/timer/全局拖拽监听关签收尸；
- TerminalPanel / DebugService 对宿主销毁的对称退役；
- Monaco 首次懒加载迟到复活风险；
- Code 20 次开关的 model 和 worker 有界性。

仍为 OPEN：

- 多窗格/子窗迁移中的 Code/Monaco owner 交接；
- DAP 真实 packaged adapter（本机仍缺 `debugpy`）；
- 真实设备 Recorder/media 与 packaged AudioContext/GIF/transcode；
- Factory 真实外网异常和 renderer crash 注入；
- 异机 clean-install ABI、签名、安装/升级/卸载与许可剩余项。

## 5. 范围纪律

本轮没有升级 Monaco/Electron，没有重构通用 worker runtime，没有实施完整 W67，也没有借 worker 证据扶正 W66 Agent 或任何 Post-W71 能力。
