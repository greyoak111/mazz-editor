# W71 首轮三小时施工检查点

> 日期：2026-08-15
> 起始坐标：`main@7eb3338`
> 授权：维护者要求按合理施工逻辑推进三小时，并且不得遗忘完整未尽波次总表中的历史欠账
> 总表真源：[`Mazz 当前未落地全景-W71归并版.md`](<C:/Users/Administrator/Downloads/交付区/Mazz 当前未落地全景-W71归并版.md>)
> 结论：完成三个可验收微波；没有宣称 W71 Wave 0、W66 或任何历史大波次整体结案。

---

## 1. 为什么是三个微波

三小时不足以诚实完成 W63、W64、W65、W66、W67、W69、W70 中任一完整大型能力，因此本检查点选择三个共同解锁后续工作的基础微波：

```text
微波 A：ResourceLedger v1 与 PTY 生命周期接入
微波 B：W66 Agent Harness Foundation 后端
微波 C：Windows 发布、许可与真实 specimen 基线
```

这样既推进 W71，也直接减少 W66 的真实欠账；其他历史欠账继续保留在总表，不以时间盒为理由删除或降级。

---

## 2. 微波 A：ResourceLedger v1

落地内容：

- 新增 `main/resource-ledger.js`；
- 支持资源登记、状态更新、幂等释放、按类型统计和有限释放历史；
- 元数据自动裁剪，并对 password/token/secret/API key/cookie 等字段脱敏；
- `main/terminal.js` 中 PTY 创建、进程退出、用户终止和应用退出全部进入资源账本；
- 增加只读 `resources:snapshot` IPC，为后续 BrowserWindow/WebContentsView/Torrent/watcher 等资源接入提供共同基线。

当前边界：只接入 PTY 与 Agent Session；这不是 W71 完整资源账本。

---

## 3. 微波 B：W66 Agent Harness Foundation

新增 `main/agent-harness.js`，完成：

```text
N-Adapter Registry
HarnessAdapter v1 形状校验
detect / probe / capabilities
idle → starting → running → waiting → completed|failed|cancelled → disposed
started/stdout/stderr/message/progress/tool/warning/error/completed/state
统一 send / interrupt / dispose / disposeAll
统一错误信封与 vendor raw 隔离
半途创建失败收尸
应用退出等待异步清理（5 秒硬上限）
主进程 IPC + preload 白名单
Agent Session 进入 ResourceLedger
```

本实现没有 `if kimi / else if codex`，Provider、Seat、Gate、Terminal 也没有冒充 Harness。

未完成项：

```text
Kimi Code Adapter：当前机器未安装 CLI
Codex Adapter：可发现 WindowsApps executable，但当前 shell 执行被拒绝
通用 Agent UI
安装/认证/健康状态界面
两个真实 Adapter 的运行、取消、恢复与 orphan-process Gate
```

因此 W66 当前只能标记为 `PARTIAL LANDED / Foundation backend`，不能标记 Formal 或结案。

---

## 4. 微波 C：Windows 发布与许可基线

### 4.1 发布配置

- electron-builder 输出目录从 Linux 绝对路径改为仓库内 `release/`；
- renderer source map 明确排除于发布物；
- `.node` 原生模块明确进入 `app.asar.unpacked`；
- `LICENSE`、`NOTICE`、`THIRD_PARTY_NOTICES.md` 进入发布物；
- 示例 `.maz` ZIP 改为固定时间戳和固定排序，连续构建哈希一致；
- 新增 `npm run audit:release` 和 `npm run dist:dir`。

### 4.2 许可证据

新增：

```text
LICENSE
NOTICE
THIRD_PARTY_NOTICES.md
renderer/vendor/ffmpeg/PROVENANCE.md
```

ffmpeg.wasm 已固定文件哈希和 `CORE_VERSION=0.12.6` 证据，但上游源码包、构建参数、完整对应源码和许可证选择仍缺。因此许可 Gate 仍是 OPEN，不因增加文档而冒充闭环。

### 4.3 真实 specimen

最终构建事实来自 `docs/engineering/evidence/W71_RELEASE_BASELINE.json`：

| 指标 | 结果 |
|---|---:|
| NSIS installer | 145.64 MiB |
| installer SHA-256 | `95FCD546F9B087799A9D1D2A45487E529F02AA0345E2D973E8242F34400FB3BB` |
| win-unpacked | 643.53 MiB |
| app.asar | 345.70 MiB |
| app.asar entries | 10,031 |
| 开发目录 renderer source maps | 209 / 55.31 MiB，已从发布 renderer 排除 |
| app.asar 内 source maps | 388，均需在后续确认是否为依赖包地图 |
| app.asar.unpacked `.node` | 37，仍含多平台/多架构候选 |
| 根 NOTICE 文件 | 3/3 已进入 app.asar |
| 锁文件缺明确 license metadata | `buffers@0.1.1` |

安装包当前未签名；`npmRebuild:false` 保持不变。后续必须分别处理签名、异机安装、WebTorrent 原生链和多平台二进制裁剪，不能用本机启动成功替代完整 ABI Gate。

---

## 5. 验证结果

```text
node tests/run.js
→ 129 / 129 测试文件通过

W71 focused tests
→ ResourceLedger 2 / 2
→ Harness Foundation 7 / 7
→ Release Foundation 3 / 3
→ Reproducible Samples 1 / 1

npm run dist
→ Windows app-unpacked + NSIS + blockmap 成功

node tests/e2e/w71-packaged-smoke.mjs
→ 安全图形模式真实启动成功
→ Electron 33.4.11
→ packaged node-pty 创建成功
→ ResourceLedger 观察到 PTY，kill 后 activeResources=0
→ Harness IPC 可访问，adapters=0、sessions=0
→ 应用自行退出，无残留 Mazz Editor 进程
```

现有 jsdom canvas 缺实现和 `MODULE_TYPELESS_PACKAGE_JSON` 警告仍存在，但没有造成测试失败；它们继续作为测试噪声/性能债记录，不在本检查点扩大处理。

---

## 6. 历史欠账保留快照

以下状态没有被本检查点抹掉：

| 波次 | 检查点后状态 |
|---|---|
| W62e | 主链未落，Hidden / Post-W71 |
| W63 | 块级活引用仍冻结 |
| W64 | AI/人格陪看仍只有设计 |
| W65 | 四站方案已入库，完整适配未施工 |
| W66 | Foundation 后端 PARTIAL；真实 Adapter 与 UI 未落 |
| W67 | 完整内存治理仍冻结；W71 只做实测治理 |
| W68 | 主链已落；Factory 后半场台账继续保留 |
| W69 | Hub/模板市场仍冻结 |
| W70 | Cognition 协议未正式冻结、无运行时 |
| W72–W81 | Design Capsule / Post-W71，全部未获开工授权 |

详细状态、依赖与 Gate 只以完整未尽波次总表为准，本表不另建第二套路线真源。

---

## 7. 下一检查点建议

继续 W71 Wave 0，而不是跳到新功能：

1. 扩展 ResourceLedger 到 BrowserWindow、WebContentsView、Torrent、watcher、stream；
2. 生成 Surface inventory、protocol reality、workaround register 与 Surface v1 interface draft；
3. 生成 Visual/Icon/Theme/Layout 四项 Census；
4. 对 37 个 packaged `.node` 做平台/架构裁剪试验和 WebTorrent ABI 探针；
5. 查清 `buffers@0.1.1` 授权以及 ffmpeg 对应源码/构建链；
6. 在真实安装/卸载前补签名策略与隔离测试目录。

上述项目完成前，不宣称 Wave 0 退出 Gate 已通过。
