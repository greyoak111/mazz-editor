# W87h 全页面巡检与语义控件图标封板检查点

> 日期：2026-08-21
> 起始坐标：`main@3fc8129`
> 结论：**W87h EXECUTED SCOPE SEALED；W71 COMPLETE WAVE 5A OPEN**
> 协议：`mazz.ui-page-sweep/v1`
> Computer Use：**DISABLED / NOT USED**

## 1. 为什么再次复开

W87g 已经用逐元素 computed style 关闭 Paper/Ink 下文字、placeholder、disabled 与交互 SVG 的对比度债，但它没有穷举所有可达 Shell 路由，也没有覆盖运行时注入、嵌套标签、伪按钮和 Browser WebContentsView 内的一方首页。历史的“已知字符映射 + 抽样页面”会漏掉嵌套 `span/i`、动态命令、独立 Panel、QuickNote 和原生 Surface。

W87h 因此把两件事合成同一封板门：

1. 把正式控件的图形语义收敛为 `currentColor` SVG，并让未知图标 fail-closed；
2. 用一条可重复的 Electron E2E 清单逐页打开、切换 Paper/Ink、截图并审计每个可达页面，源码态与 packaged specimen 都必须通过。

这不是新的全局 Surface kind。模块内普通控件仍由本地 owner 持有；Browser 网页正文仍由 W87d 的 WebContentsView / native capture 规则管辖。

## 2. 精确执行矩阵

每种运行态的页面身份为：

| 域 | 数量 |
|---|---:|
| 主模块 | 16 |
| Workspace Sidebar 页签 | 8 |
| Ribbon 页面 | 3 |
| Side Dock 页签 | 3 |
| 独立 Panel | 24 |
| QuickNote | 1 |
| **合计** | **55** |

每个身份在 Paper/Ink 各执行一次，所以 source 为 `55 × 2 = 110` 个 scene，packaged 亦为 `110` 个 scene；两种运行态合计是 `220` 次执行，不是 `220` 种页面。Browser 每个主题另取 WebContentsView 原生帧，并在一方 HOME 文档内部执行 SVG 与 placeholder 对比度门。

统一视口为 `1440×900`。截图画廊是本机可重建产物；仓库跟踪 JSON 结果，W87g 的接触表继续承担持久化视觉摘要。

## 3. 落地内容

- `renderer/lib/svg-icons.js`：语义 SVG 注册表；所有控制图标继承 `currentColor`，未知 token 返回中性 SVG并发出开发期警告，不再回落为裸字符。
- `renderer/lib/control-icons.js`：递归处理嵌套控件与运行时插入节点；MutationObserver 只作迁移兼容网，不作为新代码的图标来源。
- Shell、模块、Panel、QuickNote 与动态菜单中的 emoji/箭头/几何控制符改为显式 `iconHtml()`；纯图标控件补可读名称。
- tabs、列表、目录、菜单与伪按钮补齐 `button/tab/menuitem`、`aria-*`、roving focus、Enter/Space/Escape 和焦点恢复；禁止 nested interactive control。
- `menu-service` 与 `dom-menu` 统一保存/恢复触发焦点，并由 `close()` 显式解除外点监听；内部 disabled 项的按下不会消耗下一次外点关闭。
- 双主题 token 补齐 `--bg-soft` 及 danger/warn/ok 成对前景；Player、Factory、Library、Panel、QuickNote、Browser HOME 与 Canvas 图表使用实际 computed 颜色。
- Browser 一方 HOME 的 URL/搜索 placeholder 明确使用主题 muted token，原生抓帧缺失或空白成为硬失败。

## 4. Gate

逐页 runner 对当前可见的一方 UI 执行以下硬门：

```text
RAW_CONTROL_GLYPH
CONTROL_SVG_NOT_CURRENTCOLOR
CONTROL_ICON_SVG_MISSING
EMPTY_OR_ZERO_SVG
CONTROL_ACCESSIBLE_NAME_MISSING
NESTED_INTERACTIVE_CONTROL
CLIPPED_TEXT
DOCUMENT_HORIZONTAL_OVERFLOW
BROKEN_IMAGE
runtime error
Browser native capture missing / empty
Browser first-party HOME marker missing
Browser HOME placeholder contrast < 4.5:1
Browser HOME invalid currentColor SVG
```

可横向滚动的数据工作区与静默裁切分开判定。Sheet 的最右可见列头进入横向滚动边界不会冒充应用 Shell 溢出。

## 5. 最终结果

| 门 | Source | Packaged |
|---|---:|---:|
| 预期 / 捕获 / PASS | `110 / 110 / 110` | `110 / 110 / 110` |
| FAIL / E2E ERROR | `0 / 0` | `0 / 0` |
| 产品 issue | `0` | `0` |
| runtime error | `0` | `0` |
| Browser native capture | `2 / 2` | `2 / 2` |
| 非阻断 warning | `2` | `2` |

两条 warning 在两种运行态完全相同：Paper/Ink 的 Sheet `M` 列右缘为 `1448px`，视口为 `1440px`。人工复核确认该区域属于有明确横向滚动条的虚拟表格内容，不是控件遮挡、文字裁断或文档级溢出，登记为 `REVIEWED_NON_BLOCKING_SCROLL`。

Browser 一方 HOME 的 placeholder 对比度：

| 主题 | 地址栏 | 页面搜索框 |
|---|---:|---:|
| Paper | `5.47:1` | `4.96:1` |
| Ink | `7.01:1` | `5.67:1` |

其余最终账：

```text
W87h control icon contract              PASS 9 / 9
W87g source legibility matrix           PASS 82 / 82 scopes
W87g packaged legibility matrix         PASS 82 / 82 scopes
W87g contrast failures / renderer error 0 / 0
full suite                              PASS 224 / 224 test files
build / dist:dir                        PASS / PASS
release audit / OSS provenance          PASS / CURRENT
packaged source maps                    0
packaged native binaries                10
```

最终 `release/win-unpacked/Mazz Editor.exe` 为 `188,784,128` bytes，SHA-256：

```text
B0BF7873A915B8E872C7F31FEEC29A4EAE06BB97FF1FB4141B9C34A4EB8B0595
```

## 6. 证据

- [`UI_PAGE_SWEEP_SOURCE.json`](./evidence/UI_PAGE_SWEEP_SOURCE.json)：source `110/110`，issue `0`，runtime error `0`。
- [`UI_PAGE_SWEEP_PACKAGED.json`](./evidence/UI_PAGE_SWEEP_PACKAGED.json)：packaged `110/110`，issue `0`，runtime error `0`。
- [`W87G_THEME_LEGIBILITY_SOURCE.json`](./evidence/W87G_THEME_LEGIBILITY_SOURCE.json) / [`PACKAGED`](./evidence/W87G_THEME_LEGIBILITY_PACKAGED.json)：每种运行态 `82/82`，对比度失败 `0`。
- [`W71_RELEASE_BASELINE.json`](./evidence/W71_RELEASE_BASELINE.json)：schema v4，provenance current，locked packages `801`，asar source maps `0`，native binaries `10`，ffmpeg 为 `DEFERRED_NOT_BUNDLED`。

Paper 与 Ink 的 55 张场景图及 Browser 原生帧均已逐张人工回看：未发现仍可行动的 P0/P1、裸 emoji 控件、不可辨 SVG、主题错色、关键裁切、遮挡或重叠。Computer Use 未参与观察、输入或结论。

## 7. Supersession

- W87h 不替代 W87d；Browser 拖拽代理帧、拓扑、fresh-pixel restore 和 native Surface 连续性仍以 W87d 为权威。
- W87h 不替代 W87g；逐元素 computed contrast 仍以 W87g 为权威，W87h 扩大的是页面/控件清单与截图执行面。
- W87h 不替代 W87e/W87f；Player L/M/S/XS、Sidebar 窄宽与 20 轮几何门仍由各自检查点承担。
- W87h 只 supersede “已知图标映射与少量抽页足以证明全软件控件”这一旧口径，升级为语义注册表、unknown fail-closed、动态注入门和可重复页面 census。

## 8. 条件边界

本检查点证明的是 `1440×900`、Paper/Ink、默认与代表状态下当前可达的一方 UI。它不冒充所有 loading/error/success/permission/running 组合，不覆盖其余五套主题的全排列，也不扫描用户文档、第三方网页或第三方插件自绘内容。真实媒体解码、摄像头/麦克风、数据 roundtrip、内存回落、物理 Win32 输入、屏幕阅读器和完整 DPI/多显示器矩阵均不由 W87h 新增背书。

因此 W87h 的执行范围可以封板，但 W71 完整 Wave 5A 继续为 `OPEN`。
