# W71 Icon Census

> 状态：Wave 0 候选清单；正式 IconRegistry 尚未落地
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
| 正式 `IconRegistry/iconId` | 0 |

结论是“已有 SVG 适配层，但业务仍同时持有符号字面量、icon metadata 和零散 SVG”，不能表述为 Icon System 已完成。780 条候选包含帮助文字、示例和真实内容，不能全仓替换。

## 风险与 owner

| 优先级 | 范围 | 原因 | owner |
|---|---|---|---|
| P1 | Library create → item → back → reopen → restore | 已知存在多条 icon 写入真源 | Library + Shell |
| P1 | Shell tab/sidebar/command/restore | 状态转换和会话恢复会重放历史 metadata | Shell / Icon System |
| P2 | Factory、Viewer/Player、Browser、Markdown | 控件符号密度高，主题与可访问性差异明显 | 对应模块 owner |
| P3 | Help、用户内容、Emoji Picker | 必须进入允许清单，避免误杀 | Docs / Content |

## 目标契约

业务状态最终只保存稳定 `iconId`；tab、sidebar、toolbar、command、menu、panel title、empty state、navigation 与 restore metadata 统一从注册表解析到批准的 SVG。无特殊语义的 SVG 使用 `currentColor` 或 semantic icon token。

## Final Gate

- 正式产品控件 `emoji-as-icon = 0`；
- 允许清单只包含用户内容、Emoji Picker、帮助/示例等非控件文本；
- Library 八路径测试全部得到同一 `iconId → SVG`；
- Dark/Light/Constructivist 下关键图标对比度不低于 3:1；
- 不通过全仓字符串替换达成 Gate。
