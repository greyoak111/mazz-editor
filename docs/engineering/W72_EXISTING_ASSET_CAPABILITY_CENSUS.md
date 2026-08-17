# W72 现有资产与第一方能力盘点

> 日期：2026-08-17
>
> 状态：**CENSUS COMPLETE / NOT A GLOBAL REGISTRY**
>
> 用途：为 W72b 选择最小真实样本；不构成批量迁移、公开 schema 或产品入口授权

## 1. 盘点原则

- 文件和各模块领域文档仍是真源；Asset Envelope 只是投影。
- 可打开/可导出不等于相同资产身份；转换产物默认是新版本还是派生资产，必须由具体模块说明。
- Capability 是“能做什么”的描述，不等于命令、AI Provider、Agent Harness 布尔权限或进程所有权。
- 只有存在可定位实现和诚实运行边界的能力才进入候选；本表不自动调用或注册它们。

## 2. 资产候选

| 资产族 | 当前真源/入口 | 身份与往返风险 | W72b 决定 |
|---|---|---|---|
| Markdown / Text / Code | `.md/.markdown/.txt` 与代码文件 | 文本文件路径不是永久 semantic id；编码与外部修改另有 W71 Gate | 只盘点，不包络化 |
| Mazz Sheet | `.mazzsheet`；可进出 XLSX/CSV/TSV | Office/分隔格式是转换边界，不默认同一版本链 | 后续按消费者接入 |
| Mazz Slide | `.mazzslide`；可进出 PPTX | PPTX 子集与丢失提示必须保留 | 后续按消费者接入 |
| Mazz Mindmap | `.mindmap`；模型 v4；可导入大纲/XMind 等 | `sourceRef` 已真实保存；嫁接图可含多个节点级来源，不能压成单一万能来源 | **W72b 仅适配带文档级 W62d sourceRef 的保存态样本** |
| Mazz Draw | `.mazzdraw`；可导出 PNG/PDF 等 | 渲染产物与可编辑原稿不是同一类型 | 后续按消费者接入 |
| Notes / Library | Markdown 文件、书库记录、阅读进度 | 文件资产、集合记录与运行进度是三种对象 | 暂不投影 |
| Viewer / Media | 图片、PDF、音视频、字幕、电子书 | 文件资产与播放器/P2P/转码会话必须分离 | 暂不投影 |
| Factory | Markdown 工件、任务/裁决/预算状态 | 生产事实已有 W68 真源；不得由 W72 另造第二套 Artifact DB | 留给 W73/W74 消费 |
| Browser / Terminal / DAP / P2P | URL、会话、进程与运行状态 | 主要是 Runtime/Event，不应为了统一而伪装成文件资产 | 排除出 W72b |

`SAVE_FORMATS` 和模块注册只证明入口存在，不证明无损往返或统一身份语义。W72b 因而不生成全项目 Asset 列表，也不扫描工作区。

## 3. 第一方能力候选

| 候选 capability | 已有实现证据 | 依赖/风险 | 本轮决定 |
|---|---|---|---|
| `mindmap.outline.import` | `renderer/modules/mindmap/model.js#parseOutline` | 本地确定性；当前没有统一 Runtime Adapter | **登记一个描述态样本** |
| Markdown parse/serialize | `renderer/modules/markdown/schema.js` | ProseMirror 依赖与浏览器运行环境 | 仅盘点 |
| Mindmap codec | `parseDoc/serializeDoc` | 兼容旧格式，但能力粒度需由消费者反推 | 仅盘点 |
| Sheet/Slide/Draw codec/export | 各模块现有模型与 IO | 格式损失、取消、写盘失败和 provenance 要逐项声明 | 仅盘点 |
| DOCX/XLSX/PPTX import/export | 已有 IO 模块与 W71 错误态验证 | 第三方库、格式子集和 roundtrip 不可冒充无损 | 仅盘点 |
| OCR / Vision / Archive / Recorder / Media | 已有正式模块或主路径 | 权限、下载、原生依赖、资源生命周期与许可 | 不进入首样本 |
| Factory / AI Provider | W68 主链与 Provider 注册 | 是生产编排/模型供应，不等于通用 Capability Registry | 明确分离 |
| Agent Harness capability booleans | `main/agent-harness.js` | 表达执行器会话权限，不是生产能力供给 | 明确分离 |

## 4. W72b 样本决策

资产样本选择保存态 W62d Mindmap，因为它同时满足：真实产品主路径、已有 E2E、`sourceRef` 跨保存守恒、无需改动领域格式。适配器只读取调用方传入的已解析文档，不读文件、不复制 roots；只有显式 `sourceAssetId` 才增加 `derivedFrom`。

能力样本选择 `mindmap.outline.import`，因为 `parseOutline` 是现存、确定性、本地、无账号/网络/模型依赖的实现。Descriptor 刻意保持 `agentUsable=false` 与 `health=unknown`：前者避免把“有函数”冒充 Agent 已可调用，后者避免把静态登记冒充运行时健康检查。

## 5. 后续纪律

后续模块只能在真实消费者出现时增量适配，并必须补上身份、版本、来源、错误、取消、资源释放与许可证据。不得以本盘点为理由一次性包络全部文件、建立 Universal Asset DB、把所有命令改写成 Capability，或让 Registry 接管 Factory/Agent Harness/Tool Adapter。
