# W71 Wave 0 生命周期 / 发布安全检查点

> 日期：2026-08-15
>
> 承接坐标：`main@20e2b03`
> 状态：完成生命周期扩账、20 次 packaged 循环、原生二进制裁剪和搜索/更新链安全收口；**没有宣称 Wave 0 结案**

## 1. 生命周期闭环

`FileWatcher` 与 `TorrentDaemon` 已进入同一个 ResourceLedger：

- watcher 创建、增减根、挂起、恢复、无根关闭和应用退出均有幂等记录；
- WebTorrent client、127.0.0.1 range server 与每个活动 torrent 分层登记；
- 元数据获取失败会销毁刚加入的 torrent，不再留下 client 内幽灵任务；
- remove 和 app quit 都等待 torrent/server/client 收尸，并有超时兜底；
- 测试环境提供只读 runtime probe/reset，用于验证 packaged WebTorrent 动态导入和销毁，不注册假 torrent。

## 2. 20 次真实循环

重建 `release/win-unpacked` 后，packaged smoke 连续执行 20 次：

```text
PTY create / kill
Settings PanelWindow open / close
WebContentsView create / destroy
FileWatcher watch / unwatch
WebTorrent client + range server start / destroy
```

结果：活动资源每轮均回到启动基线，累计释放历史达到 100 条；应用退出后无残留 Mazz 进程。FileWatcher 另有 20 次独立 unit 循环，避免 packaged 启动时已有工作区 watcher 导致假开关。

本检查点尚未覆盖 Viewer MediaStream/AudioContext/Object URL、Factory stream、Monaco worker、Python/DAP process 和真实 Agent Adapter 的 20 次循环。

## 3. 原生二进制发布边界

新增：

```text
npm.cmd run audit:w71:native
npm.cmd run test:w71:native-stage
```

37 个 packaged `.node` 被分为 7 个明确 win32-x64、27 个明确外平台和 3 个通用 `build/Release`。先临时移出 27 个外平台文件并通过 packaged probe，完整恢复校验后才写入正式 builder 排除规则。正式重建现为 10 个 `.node`、外平台 0，PTY 与 WebTorrent 再次完成 20 次循环。

详见 [`W71_NATIVE_BINARY_STAGING.md`](./W71_NATIVE_BINARY_STAGING.md)。

## 4. 搜索、翻译与更新链安全

已完成：

- 删除源码内固定 SearXNG 公网 IP、用户名和密码；
- 启动时识别旧泄露默认配置并清空，不继续把公开凭据复制到用户数据；
- 既有明文自定义密码一次性迁移为 safeStorage/DPAPI 密文；
- 渲染层不再通过 `settings:get(searx)` 回读密码；
- SearXNG 默认走系统 CA 严格 TLS；自签实例必须显式填写 SHA-256 证书指纹并逐连接校验；
- Browser 的证书异常选择不再自动信任 SearXNG 主机；
- Updater 只接受 HTTPS 且严格验证证书；
- Translate 不再无条件 `rejectUnauthorized:false`。

真 packaged 设置页 E2E 证明 TLS 指纹控件可见、密码字段为 password、凭据落盘没有明文；截图已人工目检。Updater 仍保持 Hidden，因为下载、签名、安装和回滚链没有实现。

## 5. 许可证据：发现更强阻塞，不冒充闭环

### `buffers@0.1.1`

运行依赖链是：

```text
exceljs → unzipper → binary → buffers@0.1.1
```

npm 发布包没有 license 字段和许可文件，登记的上游仓库在审计时不可访问。因此不能凭作者或相邻项目猜成 MIT，Gate 保持 OPEN。

### vendored ffmpeg WASM

从 npm 固定取得的 `@ffmpeg/core@0.12.6` tarball与当前 vendored JS/WASM 逐字节不一致；`esm/const.js` 中的版本常量不能作为来源证明。FFmpeg 的最终 LGPL/GPL 边界取决于构建选项和外部库，当前 exact source/configure flags 仍缺，Gate 保持 OPEN。机器证据见 [`W71_LICENSE_AUDIT.json`](./evidence/W71_LICENSE_AUDIT.json)，上游规则参见 [FFmpeg LICENSE](https://github.com/FFmpeg/FFmpeg/blob/master/LICENSE.md) 与 [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)。

## 6. 验证水位

```text
新增 contract：8 / 8
相关历史 contract：45 / 45
全量 Node test files：133 / 133
Windows app-unpacked build：PASS
packaged lifecycle smoke：20 次 × 5 族，PASS
foreign native staging：27 移出 / 27 哈希恢复，PASS
正式 native allowlist：37 → 10，外平台 0，PASS
SearXNG security UI + safeStorage：PASS，截图目检通过
```

本轮最终 NSIS specimen：

| 指标 | 当前值 |
|---|---:|
| installer | 150,803,071 bytes / 143.82 MiB |
| installer SHA-256 | `853FFF6DDC99A7FB11BED2F7B458BE27629CADB4565B15495E5FD4E4AEAC4903` |
| win-unpacked | 668,000,617 bytes / 637.06 MiB |
| app.asar | 360,631,801 bytes / 343.93 MiB |
| app.asar entries | 9,910 |
| unpacked native | 10 files / 2,625,024 bytes |

## 7. Wave 0 继续保留的未尽项

| 未尽项 | 状态 |
|---|---|
| worker / media / Object URL / Factory stream / Python / DAP 资源账本 | OPEN |
| Viewer、Factory、Agent 等剩余 20 次循环 | OPEN |
| 3 个 node-pty `build/Release` 来源与异机 clean-install ABI | PARTIAL |
| `buffers@0.1.1` 可证明许可或依赖替代 | OPEN |
| ffmpeg exact source/build/license/source-offer | OPEN |
| 代码签名、安装/升级/卸载、文件关联与 DPI 矩阵 | OPEN |
| UI 运行态宽度/DPI/对比度与全模块状态矩阵 | OPEN |
| Kimi Code + Codex 两个真实 Adapter | OPEN；仍为 0 |

## 8. 2026-08-16 许可与 ffmpeg 增量

本节是对 2026-08-15 初始判断的增量修订，保留上文作为历史审计轨迹。

### `buffers@0.1.1`：CLOSED（从运行图移除）

没有猜测旧包的许可证。`package.json` 仅对 `exceljs` 的解压依赖施加 `unzipper@0.12.3` override；新版解压包为 MIT、随包包含 LICENSE，且不再依赖 `binary/buffers`。`npm ls`、锁文件检查、10 份 XLSX 往返和 XLSX 导出契约均通过。

### vendored ffmpeg：身份/分类已恢复，分发合规仍 OPEN

- 当前 WASM SHA-256 与官方 `@ffmpeg/core@0.12.10` 完全一致；JS 在统一换行和去除外层空白后完全一致。
- 真 `win-unpacked` 运行时自报 FFmpeg 5.1.4、`--enable-gpl` 以及 x264/x265/mp3lame/libass 等编译项，许可证分类明确为 GPL-2.0-or-later。
- 已真实完成 WAV→MP3、worker/WASM dispose、重新 load 和再次 `ffmpeg -version`。
- 转码入口现已串行化；每任务使用唯一文件名，并在成功/失败路径统一注销 progress listener、删除输入/输出/调色板临时文件；提供显式 worker/WASM dispose。
- 仍需把完整 GPL 文本、组件 notices 和持久 corresponding-source 交付机制带入最终安装包，因此不能关闭发布 Gate。

机器证据：[`W71_FFMPEG_RUNTIME.json`](./evidence/W71_FFMPEG_RUNTIME.json)、[`W71_LICENSE_AUDIT.json`](./evidence/W71_LICENSE_AUDIT.json)。

| 原未尽项 | 修订状态 |
|---|---|
| `buffers@0.1.1` 可证明许可或依赖替代 | **CLOSED_REMOVED_FROM_RUNTIME** |
| ffmpeg exact identity / GPL classification | **CLOSED** |
| ffmpeg license/notices/corresponding-source delivery | **OPEN** |
| ffmpeg packaged load/transcode/dispose/reload | **PASS**；真实设备、GIF 与长时 soak 仍未覆盖 |

W62e、W63、W64、W65、W67、W69、W70 与 W72–W81 的历史欠账没有被本检查点删除或改写，继续以交付区《Mazz 当前未落地全景-W71归并版》为唯一总表。
