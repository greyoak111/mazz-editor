# W71 C1 产品入口成熟度检查点

> 日期：2026-08-16
>
> 结论：**PASS — C1 COMPLETE**
>
> 原则：封板优先保证当前承诺真实；完整主义实现与激活条件保留，但后移到 Post-W71。

## 1. 已实施的单一事实源

`renderer/core/product-maturity.js` 定义三态：

| 状态 | 产品规则 |
|---|---|
| Formal | 可作为当前正式能力承诺 |
| Preview | 入口保留，命令、面板、帮助与数据源必须显式标识“预览” |
| Hidden | 不注册正式命令、不出现在工具坞或帮助等入口；代码和后端保留给未来 Activation Gate |

当前定级：

- Hidden：Mobile、Updater、W62e Feed、Agent 通用 UI/Adapter；
- Internal：W66 Harness Foundation；
- Preview：DMHY、Recorder、Plugins、OCR、Archive。

## 2. 实包验收覆盖

从 `release/win-unpacked/Mazz Editor.exe` 启动隔离 userData/workspace 后，自动核对：

- `update.check` 不存在于运行时命令注册表；
- 工具坞不再显示 Updater，OCR/录制/压缩包显式标识 Preview；
- Electron 原生帮助窗不再列出 Mobile 章节；
- 插件、压缩包、录制三个原生面板标题均含“（预览）”；
- 同步面板不再暴露更新页签；
- DMHY 主进程数据源名称显式标识 Preview；
- 上述过程无 renderer error。

实包检查中发现并修复了一处真边界：DOM 帮助已过滤 Hidden 章节，但 Electron 原生帮助窗原先仍直接消费原始章节。现两条路径共用 `visibleHelpSections()`。

## 3. 证据

- 全量回归：`151/151`；
- 产品成熟度 contract：`4/4`；
- packaged 产品入口 E2E：PASS；
- installer：`141,039,379` bytes；
- SHA-256：`C42DA6BF08CEBFDB1AE5623B999A5FEAC93A7C07F361F2CBCEDA48196A7509A8`；
- win-unpacked：`597,470,288` bytes；
- app.asar：`290,166,988` bytes；
- packaged source map：`0`；
- unpacked native：`10` files / `2,625,024` bytes；
- 自动证据：[`W71_PRODUCT_MATURITY.json`](./evidence/W71_PRODUCT_MATURITY.json)；
- UI 快照：[`W71_PRODUCT_MATURITY_DOCK.png`](./evidence/W71_PRODUCT_MATURITY_DOCK.png)、[`W71_PRODUCT_MATURITY_HELP.png`](./evidence/W71_PRODUCT_MATURITY_HELP.png)。

## 4. 不在 C1 内实施的内容

- 不删除 Updater、Mobile、Feed 或 Agent 基础实现；
- 不把 DMHY Preview 外推成“W65 四站完成”；
- 不因现有插件信任门已通过就将整个插件生态升为 Formal；
- 不用隐藏入口冒充功能删除；
- 不实施 W63–W86、SurfaceManager、完整 W67 或 Universal Asset Loader。

## 5. 后续距离

C1 已关闭，还剩：

1. C2 正式主路径产品完整性；
2. C3 发布与许可封口；
3. C4 RC 汇总与三次独立复跑。

完整主义扩展继续保留在完整未尽波次总表，不阻塞这三轮推荐封板。
