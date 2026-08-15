# W71 Wave 0 Census / Native Surface Ledger 检查点

> 日期：2026-08-15
> 承接坐标：`main@f2d708a`
> 授权：维护者在首轮三小时提交后要求“继续推进”
> 结论：完成 Wave 0 的 Census 与 Native Surface 账本微波；**没有宣称 Wave 0 结案**

## 1. 本检查点做了什么

### 微波 D：可重复 Census

新增 `npm run audit:w71:census`，从一方源码生成：

```text
.mazz/audit/ui-census.json
.mazz/audit/layout-debt.json
.mazz/audit/surface-census.json
.mazz/audit/agent-runtime-census.json
```

并形成六份人工解释层：

- [`UI_VISUAL_CENSUS.md`](./UI_VISUAL_CENSUS.md)
- [`UI_ICON_CENSUS.md`](./UI_ICON_CENSUS.md)
- [`UI_THEME_CENSUS.md`](./UI_THEME_CENSUS.md)
- [`UI_LAYOUT_CENSUS.md`](./UI_LAYOUT_CENSUS.md)
- [`W71_SURFACE_PROTOCOL_CENSUS.md`](./W71_SURFACE_PROTOCOL_CENSUS.md)
- [`W71_AGENT_RUNTIME_CENSUS.md`](./W71_AGENT_RUNTIME_CENSUS.md)

### 微波 E：Native Surface ResourceLedger

同一个 ResourceLedger 现在观测：

```text
main / child / quick-note BrowserWindow
print-worker BrowserWindow
25 类 PanelWindow
Browser WebContentsView
PTY
Agent Session
```

账本不持有资源，局部 owner 仍是 WindowManager、PanelWindows、BrowserViews、TerminalService 与 AgentHarness。所有释放路径幂等，未引入 SurfaceManager。

## 2. Census 事实

扫描一方 UI：209 文件、55,782 行；排除 `renderer/dist` 与 `renderer/vendor`。

| Census | 结果 | 解释 |
|---|---:|---|
| Visual | 1,635 命中行 | 控件、inline style 与状态语义候选，不是缺陷数 |
| Icon | 1,352 命中行 | 780 条 emoji/symbol 候选；正式 IconRegistry 仍为 0 |
| Theme | 3,137 命中行 | 1,575 条 token 使用；仍有 596 hex、124 rgb/hsl 候选 |
| Layout | 587 候选 | A 166 / B 75 / C 29 / D 279 / E 38，待 owner 复核 |
| Surface | 25 条主进程证据 | 主/分/快记/打印/Panel/WebContentsView 现实路径 |
| workaround | 10 条 | 全部 `KEEP`，没有一条满足删除 Gate |

重要限制：计数单位是命中源码行。帮助文本/用户内容里的 emoji、内容色、图标固有尺寸、合理 min/max 都可能是允许项；禁止用这些数字指导全仓机械替换。

## 3. Agent 现实

```text
Codex   FOUND at WindowsApps；--version probe = EPERM
Kimi    NOT FOUND
Claude  NOT FOUND
Gemini  NOT FOUND
```

没有启动交互登录，也没有读取任何厂商凭据。生产 Harness 仍注册 0 个真实 Adapter，W66 状态保持 `PARTIAL / Foundation only`。

## 4. 验证证据

### Node / contract / roundtrip

```text
node tests/run.js
131 / 131 测试文件通过
```

### Windows 构建

```text
npm run dist
PASS
```

当前 specimen：

```text
installer: 145.64 MiB
SHA-256: 0C37BE6E4A62156B53AD7F3DF66904246ECC31E0105BFAD22DB21579E69F93DC
win-unpacked: 643.53 MiB
app.asar: 345.70 MiB
unpacked .node: 37 / 4.97 MiB
```

### Packaged lifecycle smoke

```json
{
  "baselineResources": 1,
  "activeResources": 1,
  "mainWindowObserved": true,
  "ptyObserved": true,
  "panelObserved": true,
  "webContentsViewObserved": true,
  "adapters": 0,
  "sessions": 0
}
```

基线 1 是主 BrowserWindow。PTY、Settings Panel 和 WebContentsView 分别打开后进入账本，关闭后活动资源返回同一基线；测试结束后没有残留 Mazz 进程。

## 5. 明确没有做的事情

- 没有实施或迁移 SurfaceManager；
- 没有删除 invalidate、±1px 振荡、drag cloak、reload convergence 等 workaround；
- 没有开始 UI/Icon/Theme/Layout 大改；
- 没有把源码命中行当作产品评分；
- 没有注册假 Agent Adapter；
- 没有动 W62e、W63–W70、W72–W81 的未来功能范围。

## 6. Wave 0 仍未关闭

| 未尽项 | 状态 |
|---|---|
| Torrent / watcher / worker / media / Object URL / Factory stream 等资源账本 | PARTIAL；Torrent/FileWatcher 已接账，其余 OPEN |
| 20 次 Surface/Panel/PTY/Torrent/Agent 循环 | PARTIAL；PTY/Panel/WebContentsView/FileWatcher/WebTorrent 已完成 20 次，Viewer/Factory/Agent 等仍 OPEN |
| 37 个 `.node` 的 win32-x64 裁剪与 ABI/WebTorrent 验证 | PARTIAL；已收敛为 10 个且外平台为 0，异机 clean install 仍 OPEN |
| `buffers@0.1.1` 许可元数据 | OPEN |
| ffmpeg 对应源码、构建配置与许可证闭环 | OPEN |
| 代码签名、真实安装/升级/卸载 | OPEN |
| UI 运行态截图/对比度/宽度/DPI 矩阵 | OPEN；源码范围已知 |
| 两种真实 Agent Adapter | OPEN；当前 0 |

## 7. 下一合理施工顺序

1. 将 TorrentDaemon、FileWatcher 和长期 process/worker 接入 ResourceLedger；
2. 建 20 次可重复 Surface/Panel/PTY 循环，先找真实累积器；
3. 做 win32-x64 native binary staging 裁剪试验，不先修改正式发布配置；
4. 单独关闭 `buffers` 与 ffmpeg 许可证据；
5. 再进入 Wave 1 数据状态机或 Layout runtime helper。

历史欠账与 Post-W71 依赖继续以交付区《Mazz 当前未落地全景-W71归并版》为唯一总表。

> 后续结果：上述第 1～3 项的当前闭环与安全修复见 [`W71_WAVE0_LIFECYCLE_SECURITY_CHECKPOINT_2026-08-15.md`](./W71_WAVE0_LIFECYCLE_SECURITY_CHECKPOINT_2026-08-15.md)。
