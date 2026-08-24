# W93B Streaming Acquisition 暂停检查点（2026-08-25）

> 结论：**PARTIAL / HOLD；2026-08-26 RESUME**
> 用户裁决：先提交并推送当前状态，明天继续。
> 准入边界：W93B 尚未 PASS；W93C 不得启动。
> 运行边界：默认离线，不访问真实书源、不读取 Provider Key、不修改 Factory。

## 1. 当前完成面

- 主进程 `LibraryAcquisitionService`、HTTP 流式取得、Range/恢复、Workspace 单飞恢复与持久 Job/Inbox 已落地。
- `LibraryImportService.materializePath()` 已形成不经 Renderer/Base64 的流式完整哈希与排他升格路径。
- Browser Download 预登记、真实 `DownloadItem` 完成事实、Chromium 临时文件到最终文件的身份交接及完成后身份锁定已接线。
- Renderer Inbox 只从主进程持久事实重放，书架 CAS、ack、重复消费、多窗口与 Workspace 切换按 receipt 收敛。
- 启动恢复、second-instance、provisional handoff、退出耐久门、路径/重定向/地址/哈希/目录 fsync 故障均已有定向合同。
- W93B 代码审计当前未留下已知 P0/P1；此前全量曾达到 `266/266`、build 曾通过。

上述事实只证明主体实现与定向收敛，不等于本波发布门已经完成。最新 Chromium DownloadItem 身份交接补丁之后，最终全量仍须重跑。

## 2. 尚未完成的发布门

1. Windows Playwright Electron 使用 shell/Node inspector 时，产品完成两阶段 `will-quit` 耐久门后，测试壳仍可能收不到 `close`；当前 child-side `taskkill` 临时方案不得作为最终证据。
2. Source runtime 尚未生成最终 PASS 证据；已跑通取得、校验、Inbox、书架与 owner 归零的主体坐标，但退出壳未封板。
3. 最新代码尚未执行最终 `dist:dir` 与 Packaged runtime。
4. 最新树必须重新执行 W93B 全套、`node tests/run.js`、`npm run build`、provenance 与 `git diff --check`。
5. `docs/engineering/evidence/W93B_STREAMING_ACQUISITION.json` 尚不存在；不得补写推测结果或提前生成 PASS checkpoint。

## 3. 2026-08-26 唯一续作入口

按以下顺序继续，不扩波、不微调其他模块：

1. 将 runtime E2E 改为“主进程写入第二阶段耐久 shutdown marker；父测试进程核验 marker 后只清理该隔离 Electron 测试树”。删除 child-side 退出/调试器绕行。
2. 跑 Source runtime，要求启动恢复、真实离线 `DownloadItem`、Inbox→书架、退出 marker、网络计数与 owner 终态全部 PASS。
3. 执行 `npm run dist:dir`，再跑同代 Packaged runtime。
4. 重跑 W93B 定向、默认全量、build、provenance、diff-check，并确认没有 W93B 进程或临时目录遗留。
5. 只有全部为绿，才生成 W93B JSON evidence、将本文件结论改为 PASS，并把总设计/README 推进到 `W93B PASS / W93C NEXT`。

## 4. 当前禁止声明

- 不得声明 W93B PASS、Source PASS、Packaged PASS 或 release clear。
- 不得把测试壳强杀冒充产品正常退出。
- 不得启动 W93C、真实来源 Adapter、真实网络、Torrent 或新 UI。
- 不得把此前某一旧快照的 `266/266` 与 build 结果冒充最新冻结树的最终全量。

## 5. 回滚与恢复

- 本次推送是可恢复的开发检查点，不是发布标签。
- 明天从该 Git 提交继续；若 runtime harness 修改失败，只回滚 harness 的未提交增量，不回滚已通过定向合同的 acquisition 主体。
- 任一 Source/Packaged、全量、build、provenance 或资源终态门为红，本波继续保持 **PARTIAL / HOLD**。
