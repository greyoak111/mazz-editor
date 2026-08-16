# W71 C3 发布与许可封口检查点

> 日期：2026-08-16
>
> 结论：**PASS — C3 COMPLETE**
>
> 决策：推荐封板按可证明边界收敛；完整主义能力以 Activation Gate 保留到 Post-W71。

## 1. 跨版本策略：不伪造旧版本证据

仓库虽然存在 `0.1.0` 开发历史，但不存在与当前发布纪律同等级冻结的旧 installer、hash、用户数据样本和验收记录。把当前代码临时改成旧版本号再安装，不能证明真实升级。

因此 `0.2.0` 被定义为第一个封板升级基线：

| 路径 | 当前结论 |
|---|---|
| `0.2.0` 同版本修复安装 | `SUPPORTED / PROVEN` |
| `0.1.0`、WIP 或历史 patch → `0.2.0` | `NOT CLAIMED` |
| `0.2.0` → 后续封板版本 | 必须通过真实旧/新 specimen、数据迁移、失败保持和回滚 Gate |
| 自动更新 | `HIDDEN` |
| 降级/回滚 | `NOT CLAIMED` |

边界已经进入 [`W71_UPGRADE_SUPPORT_POLICY.md`](./W71_UPGRADE_SUPPORT_POLICY.md) 和发行物内 [`KNOWN_LIMITATIONS.md`](../../KNOWN_LIMITATIONS.md)。NSIS 合同与 schema v5 真安装循环继续证明卸载器不删除工作区或应用 userData，且 Windows UserChoice 在安装、同版本覆盖、冷启动、真运行和卸载后逐阶段不变。

## 2. FFmpeg：当前发行闭门，未来能力留门

历史 core 的运行身份和真转码证据并不能替代完整 corresponding source。上游构建脚本包含 `x264#4-cores`、`lame#master` 等可变 ref，当前没有足以证明所分发 GPL 二进制的完整精确源码集合。

C3 没有用另一个猜测性 workaround 取代这个缺口，而是采取可证明的范围缩减：

- 从当前分支与 Windows 发行物移除 `ffmpeg-core.js` 和 `ffmpeg-core.wasm`；
- `package.json` 和 `.gitignore` 同时阻止 core 被误打包、误重新纳入；
- Viewer 本地 fallback 转码、Player GIF 导出和 Recorder MP4 转换统一为 `Hidden`；
- 原生音视频播放、WebM 录制、系统默认程序打开继续可用；
- wrapper、集成代码、GPL/MIT 文本、来源档案、复现状态和历史证据继续保留；
- 日后只有“完整 corresponding source + 可持续源码交付 + 重新完成运行/生命周期测试”全部满足，才允许重新启用。

机器证据 [`W71_FFMPEG_DISTRIBUTION_DECISION.json`](./evidence/W71_FFMPEG_DISTRIBUTION_DECISION.json) 同时证明：源码树与 `app.asar` 均无 core；直接调用转码模块会给出明确封板提示；ResourceLedger `2→2`，没有加载 worker 或遗留资源。当前许可 Gate 为 `CLOSED_BY_NON_DISTRIBUTION`，未来激活 Gate 仍为 `OPEN`。

该判断遵循 GPLv2 对完整对应源代码及构建/安装脚本的要求，并与 FFmpeg 官方 legal checklist 的“随二进制提供精确对应源码和构建信息”口径一致：

- [GNU GPLv2 §3](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html#section3)
- [GNU GPL FAQ — Corresponding Source](https://www.gnu.org/licenses/gpl-faq.en.html)
- [FFmpeg Legal Considerations](https://ffmpeg.org/legal.html)

这是一项发布工程判断，不是法律意见。

## 3. 发布、许可与密钥审计

- 全量自动测试：`153/153`；
- 当前树高置信 secret 扫描：253 个产品/配置文件，0 个候选；历史已吊销凭据只保留为 Git history hygiene，不在报告中重印；
- 根 `LICENSE`、`NOTICE`、`THIRD_PARTY_NOTICES.md` 与 `KNOWN_LIMITATIONS.md` 均进入 `app.asar`；
- FFmpeg 的 GPLv2、wrapper MIT、NOTICE、PROVENANCE、SOURCE_REPRODUCIBILITY 五份材料仍在包内，负责说明历史、未来 Gate 和未分发事实；
- `app.asar` 内 source map 为 0；
- unpacked native 为 10 个 Windows x64 文件、合计 `2,625,024` bytes；
- 当前无代码签名证书，构建明确跳过签名，因此只属于 unsigned internal RC。

## 4. 冻结前 specimen

| 产物 | 数值 |
|---|---:|
| installer | `133,676,213` bytes |
| installer SHA-256 | `69940814475FCF2C294EB280BC1A6AFF2755DFB2F28DDCCCA422BBA3D41A41FA` |
| win-unpacked | `565,148,574` bytes / 438 files |
| app.asar | `257,845,274` bytes / 9,483 entries |
| packaged source map | `0` |
| packaged FFmpeg core | `0` |
| unpacked native | `10` files / `2,625,024` bytes |

与 C2 specimen 相比，installer 减少 `7,363,166` bytes，win-unpacked 与 app.asar 均减少约 `32.3 MiB`；这来自删除不具备对应源码闭环的真实运行时，不是为了数字好看而删除开发目录。

## 5. 真安装与运行结果

schema v5 门禁在隔离目录执行并通过：

- clean install；
- 同一 `0.2.0` specimen 覆盖安装，EXE hash 不变；
- `mazz://home`、`.md`、`.markdown`、`.txt`、`.mazz` 五类冷启动可见；
- Windows UserChoice 全阶段不改写；
- 安装态 packaged smoke 覆盖 PTY、Panel、WebContentsView、watcher、P2P、Python、Viewer、Factory request 和 Monaco；
- 各 20 轮生命周期后 ResourceLedger 回到 `2→2`；
- 正常退出后 EXE 一次释放；
- silent uninstall 后主 EXE、卸载注册、自有协议/ProgID/backup、快捷方式和隔离安装目录零产品残留。

## 6. C3 之后的边界

C3 已关闭两个原 RC BLOCKER：

1. 跨版本不再模糊宣称，`0.2.0` 成为首个可冻结基线；
2. FFmpeg 当前分发责任以“不分发 core + 隐藏依赖入口”闭环。

仍然保留：

- 代码签名、SmartScreen、异机 ABI、多 Windows 版本/CPU 为 `CONDITIONAL GATE`；
- FFmpeg 转码/GIF/MP4 为 `ACTIVATION GATE`；
- 真跨版本升级/失败升级/回滚从下一个版本开始建立；
- 全设备、DPI/RDP/GPU、完整 Session、全组合和长时 soak 为 Post-W71 完整主义。

推荐封板现在只剩 **C4：对同一冻结 hash 做三次相互独立的完整复跑、汇总最终矩阵并决定 SEAL**。C4 不得加入新功能。
