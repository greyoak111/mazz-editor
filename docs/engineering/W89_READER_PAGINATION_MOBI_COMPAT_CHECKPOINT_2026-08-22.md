# W89 Reader Pagination / MOBI Compatibility Checkpoint

> 状态：**IMPLEMENTED / SOURCE + PACKAGED PASS**
> 日期：2026-08-22
> 范围：书库纸张/版心、稳定翻页与连续阅读、图片型 MOBI/AZW3 兼容回归、播放器控制面收口

## 结论

W89 不再把“页宽”直接当成正文裁剪宽度。分页现在明确分为阅读台面、实体纸张、页内留白与正文版心；页宽只控制纸张，紧凑/舒适/宽松独立控制版心。单页、双页与窄窗降级共用纯几何函数，双页的内容栏距同时包含前页右留白、实体中缝和后页左留白，步进始终落在精确网格。

翻页效果现在只有短淡化；旧 `slide` / `none` 偏好统一迁移到 `fade`，`prefers-reduced-motion` 下关闭非必要过渡。双页是重叠 spread：`N/N+1 → N+1/N+2`，一次命令只推进一个物理页，跨章也保留一页重叠；单页则一次命令直接进入相邻章。未完成且坐标模型错误的竖排模式已经退役，旧偏好安全迁移为单页横排。

底部进度条收起时保留固定 `43px` 布局槽，只改变透明度、可见性与位移，不再改变 iframe 高度。分页在任何字号、窗格或窗口重排前冻结 DOM/文本语义锚，重排后按新 pitch 恢复；双页跨章后会把章节状态和高章锚原子提交，避免下一次 resize 跳回书首。连续阅读同样保留 `sectionId + 章内比例`，并允许内容槽在窄→宽→窄时自然缩小和再增长，不留下旧 `min-height` 空洞。

滚动文本现在也使用实体纸张、页内边距与页宽；漫画/漫画文件夹在单页、双页、滚动三种模式都消费页宽。漫画分页把页宽同时映射到 inline/block fit 上限，竖长页的可见像素会真实缩放；滚动漫画在仅宽度、仅高度或宽高同时改变时，都按 `page + 页内比例` 固定当前页。漫画候选图会先 `decode`，旧页在新页就绪前保持可见。

截图中的 MOBI 不是损坏文件。样本 `60,429,040` bytes / SHA-256 `b22ca25867ded5bc09ae9395bcf9308e30544cfef1b68cdb73616d8c363f7d55`，含 336 张图，图片合计占源文件约 `99.812%`，声明正文仅 `45,911` bytes。W88 的回归来自先进入文本兼容解析器、命中 `32 MiB` 输入门后立即抛错，使原有图片书 fallback 永远不可达。

修复没有粗暴抬高文本解析上限。导入与打开现在共用一次有界 PDB/MOBI 结构探测；只有 `>=8` 张、图片占比 `>=70%` 且声明正文有限的高置信图片出版物，才在文本解析前进入现有有界漫画 pager。普通三插图小说仍走正文；记录数、偏移、EXTH、单图与累计图片预算继续 fail closed。

## 真实门禁

| 门 | Source | Packaged |
|---|---:|---:|
| 60% 实体纸张与可读版心 | PASS | PASS |
| 一次翻页精确跨一个 pitch，且仅有淡化反馈 | PASS | PASS |
| 底条自动/手动收起不改变 iframe 高度与语义页 | PASS | PASS |
| 双页一物理页步进、单双页双向跨章、跨章后 resize 不回退 | PASS | PASS |
| 分页在真实窗口 resize 后保持语义定位 | PASS | PASS |
| 连续文本页宽/纸张/边距与槽高双向重排保持 locator | PASS | PASS |
| 漫画页宽产生真实可见缩放；宽度/高度重排固定活动页 | PASS | PASS |
| 57.6 MiB 既有 MOBI 走 `image-dominant`，336 页，首屏 cache=1 | PASS | PASS |
| renderer runtime errors | 0 | 0 |

W89 主门 Source/Packaged 各 `6/6`，W89b 稳定性门 Source/Packaged 各 `8/8`。真机实测 viewport `1208px`、纸张 `724px`、正文 `634px`、左右页内留白各 `45px`；纸张与台面背景不同。连续文本窄→宽→窄的槽/内容高度分别约 `16850/16849.65 → 13106/13105.65 → 16850/16849.65`，章节定位保持在同一 `sectionId`，章内比例误差小于 `0.03`。全量合同为 `250/250`，`npm run build` 与 `npm run dist:dir` 均 PASS。

- [Source JSON](./evidence/W89_READER_PAGINATION_MOBI_SOURCE.json)
- [Packaged JSON](./evidence/W89_READER_PAGINATION_MOBI_PACKAGED.json)
- [Source 纸张截图](./evidence/W89_READER_PAPER_SOURCE.png)
- [Packaged 纸张截图](./evidence/W89_READER_PAPER_PACKAGED.png)
- [Source MOBI 截图](./evidence/W89_MOBI_COMPAT_SOURCE.png)
- [Packaged MOBI 截图](./evidence/W89_MOBI_COMPAT_PACKAGED.png)
- [Source 稳定性 JSON](./evidence/W89B_READER_STABILITY_SOURCE.json)
- [Packaged 稳定性 JSON](./evidence/W89B_READER_STABILITY_PACKAGED.json)

最终 Source bundle SHA-256 为 `fbb67dc70c1b773085af0dc9485c7cb0824adde4ec291a9850e0dd3add5484c4`。Packaged `app.asar` SHA-256 为 `5008a0975bd895e3a036cd9430eee032647af9b59d4f5614a8eb5a942b25cdc3`，其中内嵌 bundle 哈希与 Source 完全相同；launcher EXE SHA-256 为 `c8a1b8bd18f89449dc2515b9a4dea5afda63730b825389a4a5eba8695218cddb`。

## 播放器控制面

播放控制浮层改为固定 `20px` 图标槽 + 文案槽、统一 `36px` 行高；底栏图标命中框、播放键和时间基线固定，窄宽状态由控件容器收敛。无内容时的“导入视频”严格居中、透明且无外边框/卡片底；陪看发送改用现有 `currentColor` 回车 SVG，并保留 `aria-label`、快捷键和 IME composing 防误发。全屏播放时顶栏与底栏共同参与焦点守卫，键盘焦点停在关闭按钮上不会被自动淡出藏掉。播放器控制面合同 `17/17`、主题可读性 `5/5`，七档 Electron 宽度探针均为零 overflow/overlap。

## 研究来源与边界

实现只吸收公开行为与排版原则，没有新增第三方运行时依赖、vendor 代码或资产：

- [Readium CSS pagination](https://readium.org/css/docs/CSS03-injection_and_pagination.html)：容器、gutter、column gap、line length 分权。
- [Foliate paginator](https://github.com/johnfactotum/foliate-js#the-paginator)：有界版心、双栏、手势与定位模型。
- [Thorium Web typography](https://github.com/edrlab/thorium-web/blob/develop/docs/customization/Customization.md#typography)：页 gutter 与 optimal/max line length 分离。
- [W3C CJK line length](https://www.w3.org/TR/UNDERSTANDING-WCAG20/visual-audio-contrast-visual-presentation.html)：CJK 正文行宽不超过 40 glyph 的可读性基线。
- [W3C reduced motion](https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions)：交互动画遵守减少动态效果偏好。
- [NeeView](https://github.com/neelabo/NeeView)：facing、翻页输入与“页准备好再切换”的行为参考。

## 未扩大声明

高置信图片型 MOBI 的既有兼容能力已经恢复；真正正文型、且必须落入第三方兼容解析器的 `>32 MiB` 复杂 MOBI 仍受旧安全门约束。要安全消除该 cliff，后续需要可取消 worker/utility process、随机访问与分章资源 owner，不能继续提高一个整源常量。全局压缩源仍受 `128 MiB` 包络限制。本波也没有实现规范 EPUB CFI、完整 EPUB3 FXL/Media Overlay、CBR/7z，亦不宣称与 Neat Reader / NeeView 全功能等价。
