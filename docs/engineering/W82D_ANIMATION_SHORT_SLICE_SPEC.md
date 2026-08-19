# W82d Animation Short Vertical Slice

> 状态：`LANDED — LOCAL MASTER MANIFEST SLICE`
> 版本：v1.0
> 日期：2026-08-19
> 前件：W82a Organizational Kernel、W82c Evidence Slice Runtime、W73 Production Run Ledger

## 1. 目标与边界

W82d 用 30–180 秒动画短片验证媒体生产组织的最小闭环：

```text
Brief → Script → Storyboard
                  ├─ Visual Shot 01
                  ├─ Visual Shot 02
Script ───────────└─ Audio
Visual + Audio → Timeline → Independent QC → Local Master Manifest
```

本波只编译并评估本地 fixture。它不调用 Blender、FFmpeg、生成模型或外部服务，不写出视频二进制，不发布作品，也不通过 Sample D。最终 `artifact:master` 是带证据边界的 manifest，不是 `master.mp4`。

## 2. Seat、Executor 与权限

| Seat | Executor kind | 责任 | 权限边界 |
|---|---|---|---|
| Scriptwriter | Agent | 时长约束下的脚本 | 不审批自己 |
| Storyboard Artist | Agent | 镜头覆盖与连续性 | 不签发资产 Gate |
| Visual Producer | Tool | Shot 01 / 02 | Primary/Backup 可替换，不取得 Master Authority |
| Audio Producer | Tool | 独立音频分支 | 不影响无关视觉分支 |
| Timeline Editor | Script | 确定性组装 | 不兼任独立 QC |
| QC Reviewer | Human | 时长、同步、连续性复核 | 只持有 QC Authority |
| Master Owner | Human | 签发本地 manifest | 不授予 Publication |

同一 `seat:visual-producer` 有 `tool:visual-primary` 和 `tool:visual-backup` 两个合格候选。切换 Executor 不改变 Artifact/Gate/Authority 契约。

## 3. Artifact DAG 与局部恢复

九工件为 Brief、Script、Storyboard、Visual Shot 01、Visual Shot 02、Audio Track、Timeline、QC Report 和 Local Master Manifest。

- Shot 01 失败只失效 Shot 01、Timeline、QC 和 Master；Shot 02、Audio、Storyboard 保留；
- Audio 失败只失效 Audio 及其下游，不重做视觉镜头；
- QC 失败只回退 QC 和 Master；
- Master manifest 失败只回退 Master；
- 缺 receipt 保持 `UNKNOWN`，不得把缺证据写成成功。

## 4. 四道 Gate

| Gate | Verification | Human review / evaluation | Authority |
|---|---|---|---|
| Preproduction | Storyboard coverage receipt | Script/storyboard 与 brief 评审 | Creative Director |
| Asset Production | Audio + 两镜头 receipts | 资产一致性与连续性判断 | Creative Director |
| Timeline & QC | Timeline assembly + deterministic QC receipts | 独立 QC 与风险判断 | QC Owner |
| Master | Master manifest receipt | 证据完整性与本地交付判断 | Master Owner |

Verification、Review、Evaluation 和 Authority 不合并；全绿不会自动授予 Authority，decision actor 必须与 Compile Request 的人工绑定一致。

## 5. 严格证据与 W73 投影

`mazz.animation-short-tool-receipt/v0` 只接受七个固定 stage、SHA-256 输入输出摘要、显式 exit code 和本地 scope，并强制 `published=false / externalMutation=false`。未知字段、command、secret、伪 exit code 或越界发布都被拒绝。

完成、未知、失败分别投影到 W73 的 `completed`、`paused`、`blocked/recovery-required`。只有事件 append 到 W73 后才是运行事实；W82d 不持久化第二套媒体 Runtime。

## 6. 停止线

- W82d 只落地本地 master manifest vertical slice；
- 未产生视频二进制，未真实调用外部媒体工具，未验证素材许可证和成片质量；
- Sample D 仍需真实 World/Idea、混合执行、镜头失败后替换 Executor、`master.mp4`、完整成本/许可/provenance、Promotion/Publication 与另一用户 Fork；
- W82e–W82h 和完整 Organizational Compiler DoD 仍未完成。
