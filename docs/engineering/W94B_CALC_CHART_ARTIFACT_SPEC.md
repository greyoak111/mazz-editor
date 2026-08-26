# W94B Calc + Chart Artifact 施工与验收规格

> 状态：**PASS / CHECKPOINTED / W94C NEXT**
> 版本：v0.1
> 日期：2026-08-25
> 前置检查点：[W94A Capability Execution Spine](./W94A_CAPABILITY_EXECUTION_SPINE_CHECKPOINT_2026-08-25.md)
> 总施工参照：[W94 Unified Capability, Artifact & Public Plane](../plans/W94_UNIFIED_CAPABILITY_ARTIFACT_AND_PUBLIC_PLANE.md)
> 完成检查点：[W94B Calc + Chart Artifact](./W94B_CALC_CHART_ARTIFACT_CHECKPOINT_2026-08-26.md)
> 本波范围：把计算 REPL、Markdown `calc` 与 Sheet Chart 的执行真相接入 W94A Proposal/Lease/Receipt/Artifact；不施工通用 Canvas Agent、Blender、Player、World 或 Hub。

## 1. 当前真实断点

1. `main/python-kernel.js` 是共享全局 namespace 的持久 Python 进程；`py:exec` 直接执行 renderer 提交的任意代码，没有 Definition、Authority、Receipt 或 Artifact。
2. Markdown `calc` 直接调用 `py:exec`，按弱 32 位文本 hash 缓存，结果截到 256 KiB，缓存只留 128 项；这既不是耐久事实，也会静默丢结果。
3. 计算 REPL 的 Python 与 JS 后端各自持有短命输出；历史还固定只留 50 条，不能证明哪个环境产生了哪个结果。
4. Sheet Chart 在 Renderer 内从当前选区临时构造 ECharts option，`getDataURL()` 直接生成 base64 PNG；ChartSpec、字体、主题、DPI、输入 lineage 与环境差异均未入账。
5. W94A 只存 Artifact descriptor，没有正文 Blob Store；如果 W94B 把结果塞进 Receipt、Renderer 或 base64，就仍未形成资产链。

## 2. 本波裁决

```text
Calc Definition / Chart Spec
        ↓ strict normalize + stable definition hash
W94A Proposal → Lease → registered adapter
        ↓
isolated Python expression process / deterministic SVG renderer
        ↓ streaming bytes
Workspace Capability Artifact Store
        ↓ complete SHA-256 + fsync + exclusive publish
W94A Receipt + Artifact descriptor
        ↓ short-lived trusted-shell grant
mazz-res streaming response → Calc/Markdown/Sheet presentation
```

- W94A Store 继续只保存事实索引；正文落在独立 content-addressed Artifact Store。
- 计算默认是**隔离 Python 表达式**，不是共享 REPL、shell 或任意脚本。通用代码运行仍归代码模块/显式开发工具，不借 W94B 绕过安全边界。
- Chart 的权威输出先冻结为 deterministic SVG；旧 ECharts Canvas 可保留为兼容预览/旧 XLSX 导出，但不再拥有 Chart 真相。
- 不设置字数、token、行数、列数、输出字符或文件大小业务门限。安全边界只包括进程取消/超时、磁盘空间、路径 containment、格式和完整性。

## 3. 冻结合同

### 3.1 `mazz.calc-definition/v1`

```json
{
  "schema": "mazz.calc-definition/v1",
  "language": "python-expression",
  "expression": "sqrt(a ** 2 + b ** 2)",
  "bindings": { "a": 3, "b": 4 },
  "resultSchema": "mazz.calc-result/v1",
  "seed": null
}
```

- `language` 本波只允许 `python-expression`。
- expression 必须是单一 Python `eval` AST；禁止 import、assignment、attribute、subscript、lambda、comprehension、文件、环境、进程与网络访问。
- bindings 只允许可移植 JSON 数值、布尔、字符串、null、数组与普通对象；不得含 secret、URI 或私有绝对路径。
- 可调用函数只来自冻结数学白名单；Python builtins 不直接暴露。
- `definitionId = calc-sha256-<canonical definition SHA-256>`。

### 3.2 `mazz.calc-result/v1`

```json
{
  "schema": "mazz.calc-result/v1",
  "definitionId": "calc-sha256-…",
  "value": 5,
  "valueType": "number"
}
```

- 完整 UTF-8 JSON 作为 Artifact Blob；Receipt 只保存 hash、schema、环境、seed 与 lineage。
- NaN/Infinity 必须显式编码为 typed value 或 fail-closed，不得借 JSON 隐式变 null。

### 3.3 `mazz.chart-spec/v1`

```json
{
  "schema": "mazz.chart-spec/v1",
  "type": "bar",
  "title": "",
  "dataset": [["类别", "数值"], ["A", 3], ["B", 5]],
  "encoding": { "categoryColumn": 0, "seriesColumns": [1], "headerRow": true },
  "width": 960,
  "height": 540,
  "dpi": 96,
  "theme": { "background": "#ffffff", "foreground": "#2c2c2a", "muted": "#66645e", "border": "#e0ded8", "palette": ["#4f46e5"] },
  "locale": "zh-CN",
  "font": { "family": "Mazz Sans", "fallback": "sans-serif" },
  "seed": 0
}
```

- type 本波允许 `bar|line|area|scatter|pie|radar`。
- dataset 可来自内联选区或 Proposal input Artifact；不设固定行列门限。
- 颜色必须是规范实色；不把 CSS var、系统盘字体路径或 data URL 落入 Spec。
- `chartSpecId = chart-sha256-<canonical spec SHA-256>`。

### 3.4 Chart outputs

- `mazz.chart-spec/v1` JSON Artifact：保存规范 Spec。
- `mazz.chart-svg/v1` SVG Artifact：无 script、foreignObject、外部 URL、事件属性或不稳定时间字段。
- 同 Spec + 同 adapter/version/environment 必须得到相同 definition hash 与 SVG content hash。
- PNG/PDF 是后续 adapter 变体；W94B 不用 Canvas 截图冒充 deterministic SVG。

## 4. Capability Artifact Store

```text
<workspace>/.mazz/capability-artifacts/
  blobs/<sha256>
  staging/<owner-random>.part
  locks/publish-<sha256>.lock
  quarantine/
```

硬不变量：

1. Workspace canonical realpath 与 W94A identity 一致；每次 open/read/publish 复核 layout physical identity 和 containment。
2. 写入使用 Node stream，同时计算完整 SHA-256；不整本 base64，不调用 `Buffer.concat` 聚合任意大输出。
3. staging file `fsync` 后才可排他 hard-link publish；不支持原子 hard-link时 fail-closed，不用 copy fallback 冒充原子。
4. 已存在相同 hash 只复核 regular file、identity、size 与完整 hash后复用；相同 storageRef 不得指向不同字节。
5. producer 失败、取消、hash/identity漂移只清该 owner 的 staging；正式 Blob 不删除、不覆盖。
6. `.mazz/capability-artifacts` 内部写入不进入 sidebar file watcher 广播。

## 5. Python 计算 adapter

- Capability：`mazz.calc.python-expression@1.0.0`；adapter：`mazz.calc.python-isolated`。
- execution plane：`external-process`；safety：`isolated`；cancel：`process-tree`；resume：`restart`。
- 启动命令由产品固定为检测到的 Python 3，参数固定 `-I -S -u -c <bundled driver>`；Renderer/Proposal 不能提供 executable、argv、cwd、env 或模块路径。
- Definition 经 stdin JSON 传入；stdout 只有结果 Artifact 流，stderr 只用于内部枚举诊断，不把远端/本机路径原文落 Receipt。
- adapter 捕获 process ResourceLedger owner；Abort/timeout 必须杀完整进程 owner并等待 close。
- 进程退出成功、输出 stream 完整、staging `fsync` 和 hash 完成后才发布 Blob；任一 durable publish 失败不得生成完成 Receipt。

## 6. Chart adapter

- Capability：`mazz.chart.svg@1.0.0`；adapter：`mazz.chart.svg-deterministic`。
- execution plane：`main`；safety：`local-safe`；determinism：`deterministic`。
- 只消费规范 ChartSpec；确定性布局、转义、刻度和颜色；不访问 DOM、系统 Canvas、网络或外部字体文件。
- 同一执行同时发布规范 Spec JSON 与 SVG Blob，再由 W94A 单事务提交两个 Artifact descriptor 和 Receipt。

## 7. 产品接线

### 7.1 计算 REPL 与 Markdown calc

- Python 表达式经 W94A submit/execute；不再直接调用 `py:exec`。
- 界面按短命 Artifact grant 通过 `mazz-res` 流式读取结果；不把绝对 Blob path、Workspace path 或长期 bearer 放入文档。
- 旧 `.mazz-math-v1` 与 Markdown 原文不原地改写；首次新执行生成新 Proposal/Receipt/Artifact。
- 旧通用 Python REPL IPC 暂保留给代码/兼容路径，但不再是 W94B Calc 真相；退役另波处理。

### 7.2 Sheet Chart

- 选区、图型、主题与尺寸先冻结为 ChartSpec，再提交 Chart Proposal。
- 正常桌面路径以 SVG Artifact 展示；旧 ECharts 只作非 Electron fallback 与旧 XLSX PNG export compatibility。
- 图型切换产生新 Spec/Proposal，不覆盖旧 Artifact；文档保存 Artifact Ref 或 Spec，不保存 data URL。

## 8. Artifact grant / `mazz-res` 边界

- 新增 trusted-shell-only `capability:artifactGrant`，输入仅当前 Workspace + 已持久 Artifact ID。
- 主进程返回短命、随机、单次 token URL；URL 不含 path、hash 明文或 secret metadata。
- `mazz-res://artifact/<token>` 消费后立即失效，直接返回 `fs.createReadStream`；MIME 来自已持久 Artifact descriptor。
- 不向 BrowserView、subframe、provisional shell 或任意 Workspace开放；协议端只凭服务签发 token，不能从 URL猜 Blob path。

## 9. 必测矩阵

1. Calc/Chart schema：严格类型、未知字段、secret/URI/path、NaN/Infinity、非法颜色/列映射拒绝。
2. Identity：canonical 顺序不影响 ID；不同 expression/bindings/data/theme/size/seed 不误合。
3. Python：表达式正例、AST 攻击、import/attribute/文件/网络、异常、取消、timeout、进程退出与 owner 归零。
4. Chart：六图型、HTML/SVG 转义、无 script/foreignObject/URL/event、相同 spec 字节完全一致。
5. Artifact Store：多 chunk、完整 hash、exact reuse、并发 publish、hard-link unsupported、fsync、cleanup 双错、reparse/layout swap、正式文件替换。
6. W94A：同 Proposal exactly-once；adapter success 后 Artifact publish/Store commit failure不伪装成功。
7. Grant：trusted/current only、single use、过期、未知 artifact、Workspace A/B、stream error、退出时归零。
8. Product：Math/Markdown/Sheet 不再以 `py:exec`/data URL作为新执行真相；fallback 边界明确。
9. Source/Packaged：真实 Python expression + deterministic Chart SVG，restart exact replay，network `0`，runtime error `0`。
10. Regression：W94A、Python lifecycle、Sheet/Markdown、W72/W73/W79/W86/W93A、全量/build/dist/provenance。

## 10. Final Gate

W94B 只有同时满足以下条件才可 PASS：

- Calc 与 Chart 都通过 W94A registry/service执行并形成持久 Receipt/Artifact。
- Artifact 正文以流式、完整 hash、原子排他方式发布；Renderer 不接收 base64 或正式绝对路径。
- Python 任意代码/路径/网络旁路不能从 W94B Proposal 进入；取消/退出进程 owner 归零。
- Sheet/Markdown/Math 的新执行路径已接入，旧文件仍可打开且 fallback 不冒充完成。
- 定向、相邻、全量、build/dist、Source/Packaged、隐私/provenance 全绿并形成独立 checkpoint。
- 仅此时 README/总表推进到 `W94B PASS / W94C NEXT`；任何 RED 不越波。
