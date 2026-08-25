# W93G Library Resource Convergence / 书库资源收敛规格

> 状态：PASS / W93 COMPLETE
> 日期：2026-08-25
> 前置：W93A–F PASS
> 用户授权：继续推进；每波必须独立检查
> 冻结边界：Factory、Player Torrent 与既有来源适配器不动；默认离线；不增加字数、token、目录页数、书籍大小或缓存容量业务门限

## 1. 本波裁决

W93G 只完成 W93 的可移植与发布收敛，不再扩来源。交付四项：

1. Workspace 内持久化一份可重建书架的 portable catalog；只保存 Workspace 相对路径、完整内容哈希与阅读账，不写用户绝对路径。
2. Workspace 复制/改名后，空的新路径书架可从 catalog 重建；资产改名时按完整 SHA-256 唯一重绑，零命中标缺档，多命中保持冲突而不猜。
3. 用户重新导入与缺档记录相同的完整内容时，原书目、bookId、进度和书签原位修复，不创建第二本。
4. PDF 在 Electron 中继续通过主进程流式 Range 读取；补严格单 Range、416、HEAD/全流与 Workspace containment 合同。缓存治理只删除可重建的孤立派生物。

## 2. 非目标

- 不迁移或改写仍在运行的 Acquisition Job，不伪造旧 Workspace 的传输历史。
- 不把外部绝对路径、远端签名 URL、cookie、header、Key 写入 portable catalog。
- 不实现 EPUB/CBZ 边下边读；两者仍在完整取得和现有容器安全校验后打开。
- 不引入自动联网换源。缺档换源仍由用户从已有 Candidate/Offer 或本地文件明确选择。
- 不以 GC 删除正式书籍、pending Inbox、Job、quarantine、Candidate 或 Rights 证据。

## 3. Portable catalog 合同

权威文件：`<Workspace>/书库/.mazz-library-catalog.json`。

```text
mazz.library-portable-catalog/v1
  catalogId              内容派生 SHA-256
  revision               单调正整数
  updatedAt              ISO 时间
  books[]                bookId、相对路径、完整 sha256、格式与安全元数据
  categories[]
  progress{}             仍按 bookId 绑定
  bookmarks{}            仍按 bookId 绑定
```

硬不变量：

- `relativePath` 必须是规范 POSIX 相对路径，禁止绝对路径、`..`、NUL、ADS、设备名与尾点/尾空格。
- `sha256` 必须是完整 64 位小写摘要；移动重建必须重新流式计算全文件摘要。
- catalog 不含 `sourcePath`、Workspace 绝对路径、外部书籍路径、远端 acquisitionRef 或 secret。
- 写入使用同目录临时文件、文件 fsync、原子 replace 与目录 fsync；读取损坏时保留原件并 fail-closed。
- 保存操作捕获同一 repository 快照；新路径恢复只允许写入实际为空的目标书架，避免覆盖现有事实。

## 4. 重建与重新定位

```text
读取并校验 catalog
  -> 扫描 catalog 记录的相对路径
  -> 命中则核完整 SHA
  -> 缺失则流式扫描书库支持格式并按完整 SHA 建索引
     -> 唯一命中：重绑新相对路径
     -> 零命中：保留记录并 missing=true
     -> 多命中：ambiguous=true，禁止猜测
  -> Renderer 仅在空书架上用一次 CAS 写回 books/progress/bookmarks/categories
  -> 立即重新保存新 revision catalog
```

外部书籍不进入可移植资产清单；其现有全局 repository 记录保持原语义。重新导入相同完整哈希时，若原书目缺档，更新该记录的 `path/sourcePath/missing/repositoryScope`，保留 bookId 及所有 bookId 关联账。

## 5. PDF Range

书库 PDF URL 必须由 Workspace 绑定的主进程服务签发，不接受 Renderer 任意路径。服务支持：

- 无 Range：流式 `200`，不整本读入内存。
- `bytes=start-end`、开放尾端和 suffix：精确 `206`、`Content-Range`、`Content-Length`。
- 越界：`416 bytes */size`。
- 多 Range、非法单位、负数/溢出：`416`，不得降级成全文件。
- 读取前后路径必须仍在当前 Workspace、为物理 regular file，且 owner identity 未被替换。

## 6. 缓存治理

允许治理的仅有 `.cache` 与 `.covers` 中可重建、且不再被当前 catalog/bookId 引用的派生文件。执行分两步：`plan` 返回相对路径和理由，`commit(planId)` 在重新扫描及 owner 复核后删除。任何 ledger 损坏、路径替换、未知文件类型或当前引用变化都 fail-closed。没有按容量、年龄或条数自动淘汰。

## 7. 最小 API

主进程：

```text
savePortableCatalog(workspace, snapshot)
rebuildPortableCatalog(workspace)
planDerivedCacheGc(workspace, liveBookIds)
commitDerivedCacheGc(workspace, planId)
createReadableAsset(workspace, relativePath).stat/readRange/createResponse
```

Renderer IPC 仅暴露 current-Workspace scoped 的 `catalogSave`、`catalogRebuild`、`cachePlan`、`cacheCommit`。事件只能作为 wake hint，不能携带路径或书架事实。

## 8. 必查矩阵

1. 合同：schema、相对路径、完整 SHA、secret/绝对路径拒绝、确定性 catalogId。
2. Roundtrip：保存、重开、复制到新 Workspace、空书架 CAS 恢复、进度/书签保留。
3. Repair：原位、唯一改名、零命中、多命中、相同哈希重新导入、并发恢复冲突。
4. Fault：临时写/rename/fsync/close、损坏 catalog、文件在 hash 前后替换、取消。
5. PDF：200/206/suffix/416、非法/多 Range、owner 替换、Source 与 Packaged。
6. GC：只删孤立派生物；正式资产、引用封面、Job/Inbox/Candidate/quarantine 零删除；plan 后漂移拒绝。
7. 资源：文件句柄、stream、listener、timer、temp 与进程回基线。
8. 回归：W93A–F、Library atomic/security/repository、`node tests/run.js`、build、dist、release/provenance。

任一 RED：W93G 保持 PARTIAL，不写 W93 PASS，不推进最终提交。

## 9. Definition of Done

- 复制 Workspace 后可从 portable catalog 重建基本书架并按 bookId 恢复进度/书签。
- 缺档唯一重绑和相同内容重新导入修复均不改变 bookId；冲突不猜。
- PDF 的真实 Electron 请求证明 Range 流式消费，Renderer 不产生整本 Base64 副本。
- GC 证明只回收孤立派生物，零正式事实损失。
- Source + Packaged、全量、build、release/provenance、隐私与资源审计全部 PASS，随后生成 W93G 与 W93 总检查点。

## 10. 最终裁决

W93G 已于 2026-08-25 按本规格完成。Source 与 Packaged 均证明 Workspace 复制后书架、进度和书签恢复，唯一 SHA-256 改名重绑、严格 PDF Range、派生缓存两阶段回收及 owner 归零；定向合同、W93A–F 相邻回归、默认全量、build、dist、release/provenance、隐私与资源检查全部通过。权威结论见 [W93G 检查点](./W93G_LIBRARY_RESOURCE_CONVERGENCE_CHECKPOINT_2026-08-25.md) 与 [W93 总检查点](./W93_LIBRARY_RESOURCE_FREEDOM_FINAL_CHECKPOINT_2026-08-25.md)。
