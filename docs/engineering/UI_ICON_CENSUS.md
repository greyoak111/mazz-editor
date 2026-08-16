# W71 Icon Census

> 状态：C2 更新；模块页签稳定 IconRegistry 已落地，整应用控件迁移保留为 Post-W71 完整主义
> 机器证据：[`../../.mazz/audit/ui-census.json`](../../.mazz/audit/ui-census.json)

## 事实基线

| 观察项 | 命中行 |
|---|---:|
| emoji / Unicode symbol 候选 | 780 |
| `icon:` 元数据写入 | 297 |
| `iconHtml(...)` 适配调用 | 195 |
| `currentColor` | 42 |
| inline SVG | 37 |
| SVG 硬编码黑白色 | 1 |
| 正式 `IconRegistry/iconId` | 1 个中心注册表；所有注册模块具有稳定 `module.*` 身份 |

Wave 0 的结论仍成立：780 条候选包含帮助文字、示例和真实内容，不能全仓替换。C2 新增了稳定 `iconId → SVG` 注册表，并让模块页签、恢复和跨窗交接只保存图标身份；这关闭了 Library/Shell 已知 P1，但不能表述为整应用 Icon System 已完成。

## 风险与 owner

| 优先级 | 范围 | 原因 | owner |
|---|---|---|---|
| CLOSED | Library create → item → back → reopen → restore | packaged 路径保持 `module.library` 与同一 SVG | Library + Shell |
| CLOSED / scoped | Shell module tab / restore / handoff | 模块页签持久化稳定 `iconId`，标题不再夹带图标 | Shell / Icon Registry |
| P2 | Factory、Viewer/Player、Browser、Markdown | 控件符号密度高，主题与可访问性差异明显 | 对应模块 owner |
| P3 | Help、用户内容、Emoji Picker | 必须进入允许清单，避免误杀 | Docs / Content |

## 目标契约

业务状态最终只保存稳定 `iconId`；tab、sidebar、toolbar、command、menu、panel title、empty state、navigation 与 restore metadata 统一从注册表解析到批准的 SVG。无特殊语义的 SVG 使用 `currentColor` 或 semantic icon token。

## C2 Gate（已通过）

- 所有注册模块页签具有稳定 `module.*` 身份；
- Library 创建、开书、返回、关闭和恢复均得到同一 `iconId → SVG`；
- Paper/Ink 主题中 SVG 由 `currentColor` 跟随正式前景色；
- 标题变化、恢复和交接不改变图标身份。

证据见 [`W71_FORMAL_MAIN_PATHS_CHECKPOINT_2026-08-16.md`](./W71_FORMAL_MAIN_PATHS_CHECKPOINT_2026-08-16.md)。

## Post-W71 完整 Gate

- 正式产品控件 `emoji-as-icon = 0`；
- 允许清单只包含用户内容、Emoji Picker、帮助/示例等非控件文本；
- Dark/Light/Constructivist 下关键图标对比度不低于 3:1；
- 不通过全仓字符串替换达成 Gate。
