# W79 Blender Headless 第四阶段检查点（2026-08-19）

## 结论

W79 的 Runtime、Blender Adapter 与 packaged 条件门已经闭合；当前主机未安装 Blender，真实 Blender 激活保持 `BLOCKED_TOOL_NOT_INSTALLED`。本阶段没有擅自下载或安装外部 GPL 软件，也没有用 fixture 冒充真实出图。

诚实状态：

```text
RUNTIME LANDED
PACKAGED CONDITIONAL GATE PASS
REAL BLENDER ACTIVATION BLOCKED_TOOL_NOT_INSTALLED
```

## 已落地

- 独立 External Tool Service 与 preload 白名单；
- 独立 `external-tool-process` ResourceLedger 类型和 `external-tool-supervisor` Typed Handle owner；
- Blender `scene.render.frame/v0` 固定资产契约和固定 argv；
- 当前 Workspace 根、相对路径、reparse、已存在输出和类型 Gate；
- stdout/stderr/exit/duration/provenance、PNG magic、SHA-256 Asset identity；
- timeout、Windows 整树强杀、1 秒 settle fallback、幂等 cancel/dispose；
- partial output 证据保留；
- packaged Python 脚本 `app.asar.unpacked` 边界；
- 应用退出联合收尸。

## 验收结果

| Gate | 结果 |
|---|---|
| 全量合同 / 单测 | `194/194` 个测试文件 PASS |
| W72d / W79 / W66 Supervisor 定向合同 | PASS |
| Blender fixture 成功输出及 SHA-256 | PASS |
| 任意 operation/command/env/越界/覆盖 Gate | PASS，零 spawn |
| 失败与 partial 保留 | PASS，exit 9，`.partial-failure` |
| 同 renderer 并发取消 | `accepted → cancelled → already-terminal` |
| 20 轮合同 soak | PASS，逐轮 `external-tool-process=0` |
| packaged 20 轮 | PASS，`external-tool-process 0→0` |
| packaged 主/渲染错误 | `0 / 0` |
| 本机真实探测 | PASS，明确 `BLENDER_NOT_INSTALLED` |
| 本机未安装运行 | 结构化 `failed / BLENDER_NOT_INSTALLED`，不创建 outputs |
| 真实 Blender 出图 | BLOCKED，未执行 |

机器证据见 `docs/engineering/evidence/W79_PACKAGED_BLENDER_GATE_2026-08-19.json`。

本次 `win-unpacked`：

- `Mazz Editor.exe`：188,784,128 bytes，SHA-256 `2F6CA4B6B90095B3EB41DF500E6D5946C228DE8E9445DA2A646702AC99146EF1`；
- `resources/app.asar`：258,853,973 bytes，SHA-256 `7B55666003BDE20DE3E857BE2C70BDDB7A4EC3E76DE58337F509D7EC57F9F8D1`；
- unpacked Adapter script：611 bytes，SHA-256 `145C1EC42A95CC8EC767DC68176E88287F38FC37B85F1150DF43B815CFFFA82F`。

## 回归中抓到并关闭的问题

1. 全应用 ResourceLedger 会被 W66 后台健康探测改变，W79 门禁改为按资源 owner/type 证明 `external-tool-process 0→0`，同时保留宿主总数供审计。
2. packaged 取消不能依赖另一条 Playwright evaluate 排队模拟，改为同 renderer 事件循环并发发 run/cancel，等价于真实 UI 点击取消。
3. Windows 强杀后极端情况下 close event 可迟到，External Tool Supervisor 增加 `taskkill /T /F` 和 1 秒有界 settle fallback；W66 默认 Supervisor 行为不变。

## 未完成与停止线

- 当前机器没有 Blender；未经用户明确授权不得安装。
- 真实 `.blend` 成功/失败/取消/20 轮及应用退出 Gate 尚未运行。
- W79 不得写 COMPLETE 或 REAL ACTIVATED；W82 动画竖切不能消费 fixture 作为真实工具证据。
- 下一步只有两种合法路线：用户自行准备 Blender 后补 W79d 真工具 Gate，或回到完整未尽总表选择不依赖真实 Blender 的波次。
