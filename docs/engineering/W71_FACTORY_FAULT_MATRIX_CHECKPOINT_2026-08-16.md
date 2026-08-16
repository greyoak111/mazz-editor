# W71 Factory 故障恢复矩阵检查点

> 日期：2026-08-16
>
> 范围：W68 已落地主链的慢响应、断网、半包 SSE 与 renderer crash 资源收尸
>
> 状态：**确定性故障注入 PASS；不宣称第三方 Provider、长任务 soak、Factory 或 W71 整体结案**

## 1. 本轮关闭的真实缺口

此前主进程对 SSE 的处理存在一个正确性漏洞：只要 HTTP body 到达 EOF，就会广播 `done` 并返回 `{ok:true}`。这意味着服务端在一段合法 delta 后断线、或者最后一行 JSON 被截断时，半稿可能被冒充为完整成稿。

同时，Factory request owner 只监听 `WebContents.destroyed`。Electron renderer 进程崩溃后，原 BrowserWindow/WebContents 可以原地 reload，未必触发 `destroyed`；此前文档中的“renderer crash/reload 按 owner 取消”因此只有静态契约，没有覆盖真实 crash 语义。

本检查点完成：

- 新增独立 `FactorySseDecoder`，按 UTF-8 字节流处理跨 chunk 中文、CRLF、注释行与 OpenAI-compatible `data:`；
- 只有收到 `[DONE]` 或非空 `finish_reason` 才允许完成；EOF 无完成标记、尾部半截 JSON、完整行损坏 JSON、Provider error event 均显式失败；
- 已发出的 delta 仍可作为半稿证据进入既有 checkpoint 逻辑，但主进程不再发送 `done`，也不再返回 `ok:true`；
- 非流式 timeout 返回明确的“AI 请求超时”，而不是把 AbortError 或用户取消混为一谈；
- Factory owner 同时监听 `render-process-gone` 与 `destroyed`，renderer 原地崩溃恢复时立即取消该 owner 的所有请求；
- 新增仅在 `NODE_ENV=test` 下存在的主进程只读探针，供 packaged E2E 核对 Factory 注册表和 ResourceLedger；不进入 renderer 白名单，不在生产环境暴露。

## 2. 确定性 packaged 故障矩阵

执行：

```text
npm.cmd run dist:dir
npm.cmd run test:w71:factory-faults
```

测试由独立 Node 进程在 `127.0.0.1` 随机端口建立真实 HTTP/SSE 服务，正式 `release/win-unpacked/Mazz Editor.exe` 通过 Electron `net.fetch` 访问。它不是函数 mock，也不使用 API Key 或公网 Provider。

| 场景 | 注入方式 | 预期 | 实测 |
|---|---|---|---|
| 慢响应 | 接收请求后不回响应头；测试 timeout 600ms | 主动 abort、连接关闭、错误明确、账本归零 | **PASS；612ms（最终 specimen）** |
| 断网 | 连接已释放的 loopback port | IPC 返回真实错误、账本归零 | **PASS** |
| 半包 SSE | 发送一个合法中文 delta 后 EOF，无完成标记 | 保留 delta；发 error；不得发 done/ok | **PASS** |
| 正常 SSE | 两段 delta + `finish_reason` + `[DONE]` | 文本完整；done 一次；ok | **PASS；“完整响应”** |
| renderer crash | 流保持中时调用 `forcefullyCrashRenderer()` | owner 取消、socket 关闭、注册表归零、窗口自愈、账本回基线 | **PASS；1→0；2→2** |

机器可读证据：[`W71_FACTORY_FAULT_MATRIX.json`](./evidence/W71_FACTORY_FAULT_MATRIX.json)。

## 3. 单元与契约覆盖

新增 [`factory-sse.test.mjs`](../../tests/unit/factory-sse.test.mjs)：

```text
UTF-8 中文跨字节/跨行分片
[DONE] 完成
finish_reason 兼容完成
损坏完整 JSON
合法半稿后无完成标记 EOF
尾部半截 JSON
Provider error event
```

既有 Factory 生命周期契约同步钉住：测试 timeout 仅在 `NODE_ENV=test` 可覆写、`render-process-gone` owner 收尸、SSE 必须执行 `finish()`、测试账本探针不得成为常规 IPC。

回归结果：

```text
npm.cmd test
143 / 143 个测试文件通过

node tests/e2e/w71-packaged-smoke.mjs
9 类运行时各 20 次；启动/结束活动资源 2 / 2；释放历史 160；强制清理 0

npm.cmd run test:w71:installer
schema v5 真安装/同版本覆盖/五入口/20 轮/卸载全通过；UserChoice 全程不变；强制清理 0
```

最终发布 specimen：

```text
Mazz Editor Setup 0.2.0.exe
141,033,491 bytes
SHA-256 9334DA2B2F5705903739ECC0084CC37FD925B931D2FE2D8E4EC5A25693427CCF

win-unpacked 597,418,165 bytes
app.asar     290,114,865 bytes
```

发布物审计见 [`W71_RELEASE_BASELINE.json`](./evidence/W71_RELEASE_BASELINE.json)，安装态复验见 schema v5 [`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json)。

## 4. 诚实边界

| 项目 | 当前结论 |
|---|---|
| 半包/损坏 SSE 不冒充完成 | **PASS：unit + packaged real-loopback** |
| 慢响应 timeout 与连接收尸 | **PASS：packaged real-loopback** |
| 连接拒绝错误与资源释放 | **PASS：packaged real-loopback** |
| renderer 真实崩溃 owner 收尸与主窗恢复 | **PASS：packaged force-crash** |
| 第三方 Provider 的 TLS、代理、限流、非标准 SSE 差异 | **OPEN：本轮没有把本机回环冒充公网实证** |
| Factory 长任务 RSS 斜率与数小时 soak | **OPEN** |
| 下一代 Factory / Task Capsule / Runtime / Seat / Harness Adapter | **DEFER：不在 W71 本检查点施工** |

## 5. Gate 结论

W71 中“Factory 外网慢响应/断网/半包 SSE 与 renderer crash 尚缺真注入”应拆成两层：

1. **产品自有故障处理与生命周期层：PASS。** 已通过真实 packaged Electron、真实 loopback HTTP/SSE 与真实 renderer force-crash。
2. **第三方网络生态兼容层：OPEN。** 后续若执行，应采用不落密钥、显式 opt-in 的 Provider smoke；不能把外网波动设成日常 Hard Gate。

本检查点没有新增 Factory 能力面，也没有实施 W62e、W63、W64、W65、W67、W69、W70 或 W72–W86。
