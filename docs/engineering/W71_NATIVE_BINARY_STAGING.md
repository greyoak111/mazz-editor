# W71 Windows 原生二进制 Staging 证据

> 日期：2026-08-15
>
> 目标：`win32-x64`
> 机器真源：[`.mazz/audit/native-binary-census.json`](../../.mazz/audit/native-binary-census.json)

## 结论

打包 specimen 原有 37 个 `.node`。分类后只有 7 个明确 `win32-x64` prebuild、3 个当前 `build/Release` 产物，另有 27 个明确属于 Darwin、Linux、Android、Windows ia32 或 Windows arm64。

先执行临时 staging：把 27 个明确外平台文件移动到 `release/.w71-native-stage-backup`，运行 packaged 20 次生命周期/ABI 探针，再逐项恢复并核对原 SHA-256。试验通过后，才把相同排除规则写入 electron-builder。

正式重建结果：

| 包 | 原数量 | 当前数量 | 当前构成 |
|---|---:|---:|---|
| bufferutil | 5 | 1 | win32-x64 |
| fs-native-extensions | 10 | 1 | win32-x64 |
| node-pty | 11 | 6 | win32-x64 ×3 + build/Release ×3 |
| utf-8-validate | 6 | 1 | win32-x64 |
| utp-native | 5 | 1 | win32-x64 |
| 合计 | 37 | 10 | 外平台 0；人工复核 3 |

原生二进制体积由 `5,214,980` bytes 降至 `2,625,024` bytes，减少 `2,589,956` bytes。三个 `node-pty/build/Release` 文件没有按路径猜测平台，继续保留；当前 packaged PTY 真创建/kill 已证明它们不会阻塞 x64 运行，后续仍需干净安装机验证其 ABI 来源。

## 可重复命令

```text
npm.cmd run audit:w71:native
npm.cmd run test:w71:native-stage
```

`test:w71:native-stage` 只移动审计器判定为 `foreign-prebuild` 的文件；路径必须位于 `release/win-unpacked/resources/app.asar.unpacked` 内。无论探针通过或失败，脚本都会恢复文件并逐字节复核；发现旧备份目录时拒绝继续。

## 本次 packaged Gate

在临时 staging 和正式 builder 排除后各运行一轮：

```text
PTY × 20
Settings PanelWindow × 20
WebContentsView × 20
FileWatcher × 20（unit；packaged 观察现有 watcher 基线）
WebTorrent client + range server × 20
```

每轮关闭后 ResourceLedger 回到启动基线；WebTorrent 在正式 packaged Electron 中完成真实动态导入、server listen 和 destroy。此结果关闭“外平台 `.node` 是否可剔除”的不确定性，不替代异机 clean install、签名、升级和卸载 Gate。
