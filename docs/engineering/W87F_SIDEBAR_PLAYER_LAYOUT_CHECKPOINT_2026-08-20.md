# W87f Sidebar / Player Layout 检查点

> 日期：2026-08-20
> 状态：**SOURCE + PACKAGED ELECTRON SEALED**
> 协议：`mazz.w87f-sidebar-player-layout/v1`
> 约束：本轮未调用 Computer Use；验证只使用源码、Playwright Electron E2E、截图与发布审计

## 1. 结论

用户点名的两个确定性布局缺陷已经关闭：

1. Workspace Sidebar 将 8 个 icon + label 页签强塞进单行 flex；在 `180–232px` 合法栏宽内，中文标签被挤成竖排或越界。
2. 空 Player 的 `.mz-empty` 把 `right:var(--mz-side-w)` 写进 inline style；即使侧栏关闭，画面仍永久保留旧侧栏宽度，而底栏已经恢复全宽。

修复后，Sidebar 在合法宽度内固定为 `4 × 2`；窄于等于 `260px` 时只收起装饰图标，完整文字仍保留。Player 空画面、真实媒体面与底栏共用同一 `side-open / side-overlay` 状态：收栏全部铺满，推挤侧栏展开时共享同一右边界，极窄 overlay 不压缩内容位。

## 2. 落地边界

- `.sidebar` 成为命名 inline-size container；`.sb-tabbar` 使用四列网格，不缩小点击目标、不横滚、不允许标签换行。
- 页签图标进入显式 `.sb-tab-icon` wrapper，container query 可同时隐藏 SVG 和历史 glyph fallback；`title` 继续提供图标省略后的辅助说明。
- `.mz-empty` 的永久 inline geometry 已退役；关闭态由 `inset:0` 铺满，只有 `.side-open:not(.side-overlay)` 才写入 `right:var(--mz-side-w)`。
- W47 的旧“永远右偏移”合同已被反钉；`scenes36` 改为实际测量开栏、收栏、再收栏矩形。
- 本轮不引入全局 Surface kind，也不改 Player 的媒体状态或侧栏 owner。

## 3. Electron E2E

| 门 | Source | Packaged |
|---|---:|---:|
| Sidebar `180 / 232 / 320px` | PASS | PASS |
| 8 页签严格两行 | PASS | PASS |
| 标签 nowrap / unclipped / inside tabbar | PASS | PASS |
| `≤260px` 隐图标、`320px` 恢复图标 | PASS | PASS |
| 空 Player 初始收栏铺满 | PASS | PASS |
| 展开侧栏时空画面/底栏共享边界 | PASS | PASS |
| 再收栏恢复铺满 | PASS | PASS |
| 开/关侧栏 20 轮几何 soak | PASS | PASS |
| main fatal / renderer error | 0 / 0 | 0 / 0 |

机器证据：

- [`W87F_SIDEBAR_PLAYER_LAYOUT_SOURCE.json`](./evidence/W87F_SIDEBAR_PLAYER_LAYOUT_SOURCE.json)
- [`W87F_SIDEBAR_PLAYER_LAYOUT_PACKAGED.json`](./evidence/W87F_SIDEBAR_PLAYER_LAYOUT_PACKAGED.json)
- [`SOURCE 232px Sidebar`](./evidence/W87F_SIDEBAR_PLAYER_LAYOUT_SOURCE_SIDEBAR_232.png)
- [`PACKAGED 232px Sidebar`](./evidence/W87F_SIDEBAR_PLAYER_LAYOUT_PACKAGED_SIDEBAR_232.png)
- [`SOURCE Player closed`](./evidence/W87F_SIDEBAR_PLAYER_LAYOUT_SOURCE_CLOSED.png)
- [`PACKAGED Player closed`](./evidence/W87F_SIDEBAR_PLAYER_LAYOUT_PACKAGED_CLOSED.png)

截图已回看：`232px` 下八个文字页签为规整两行，无竖排、重叠或省略；空 Player 收栏后黑色内容面与底栏均到达舞台右缘，没有遗留侧栏色块。

## 4. 回归与边界

- 全量 Node/contract/roundtrip：`222/222` 个测试文件 PASS。
- `npm run dist:dir`：Windows unpacked 重新构建 PASS。
- `npm run audit:release`：PASS。
- `npm run audit:provenance`：CURRENT。

W87f 的 20 轮是侧栏开关与几何收敛，不是视频解码、真实媒体播放、内存回落或长时间媒体 soak。真实视频的媒体面开栏/收栏仍由既有 Player E2E 负责；本检查点专门补上此前遗漏的空 Player 分支。W87f 关闭的是两个已复现缺陷，不代表 W71 Wave 5A 已推广到所有复杂工具栏。
