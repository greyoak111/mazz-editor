# W71 Theme Census

> 状态：Wave 0 源码基线；硬编码候选尚未逐项判定
> 机器证据：[`../../.mazz/audit/ui-census.json`](../../.mazz/audit/ui-census.json)

## 事实基线

| 观察项 | 命中行 |
|---|---:|
| semantic token `var(--...)` | 1,575 |
| hex 色值 | 596 |
| rgb/hsl 色值 | 124 |
| `border-radius` | 473 |
| `box-shadow` | 100 |
| `font-family` | 155 |
| theme selector / event | 114 |

项目已经大量使用 token，但颜色、圆角、阴影、字体仍同时散落在主 CSS、模块模板和 25 类 Panel 中。因此当前是“主题前件较强、统一 Theme Contract 未闭合”，不能因为 token 数量高就判定产品质感已统一。

## 来源分层

- 主窗实际加载 `renderer/styles/themes.css`、`renderer/styles/base.css`、`renderer/styles/mobile.css`；
- 独立 Panel 共同加载 `renderer/panels/panel-shared.css`，同时仍有各自 inline/style block；
- `renderer/base.css` 未从主 `index.html` 直接加载，当前列为“可达性待证”的历史源，未获删除许可；
- Monaco、内容画布、幻灯片和用户内容色属于特殊 Surface，需先区分产品 chrome 与内容颜色。

## 已冻结阈值

- 普通正文：对比度 `>= 4.5:1`；
- 大字、关键图标、焦点边界：对比度 `>= 3:1`；
- disabled 不得只靠不可辨识的颜色；
- hover/active/selected 必须有足够颜色差或非颜色差异。

## Wave 5B 施工顺序

1. 冻结 color/text/icon/radius/border/typography/spacing/elevation/motion token；
2. 先让 Panel shared layer 与主窗消费同一 Contract；
3. 分离产品 chrome 色、内容色、语义色和不可 token 化资产；
4. 以运行态 computed style 和截图矩阵验收 Constructivist，而不是删除所有圆角；
5. 最后处理模块局部硬编码，不做机械色值替换。
