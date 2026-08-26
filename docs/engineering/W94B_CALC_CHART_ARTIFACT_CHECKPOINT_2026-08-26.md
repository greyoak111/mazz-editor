# W94B Calc + Chart Artifact 检查点

> 结论：**PASS / CHECKPOINTED / W94C NEXT**
> 日期：2026-08-26
> 代码基线：`main@0add39fce403`；本检查点对应其上的 W94A + W94B 实施工作树
> 总施工参照：[W94 Unified Capability, Artifact & Public Plane](../plans/W94_UNIFIED_CAPABILITY_ARTIFACT_AND_PUBLIC_PLANE.md)
> 施工规格：[W94B Calc + Chart Artifact](./W94B_CALC_CHART_ARTIFACT_SPEC.md)

## 1. 本波裁决

W94B 已把 Calc、Markdown `calc` 与 Sheet Chart 的新执行路径接入 W94A `Proposal → Lease → Receipt → Artifact` 脊柱，并建立 Workspace 内独立的 content-addressed Artifact Store。计算结果、规范 Chart Spec 与 deterministic SVG 不再由 Renderer 短命内存、base64 或临时 Canvas 自行宣布完成。

本波只完成 Calc + Chart 资产链，**没有**声称以下能力已经完成：

- 未施工通用 Canvas Agent、图层/蒙版/Operation/Revision/CAS；该项是 W94C。
- 未接已安装的 Blender 5.2；真实 Blender capability 是 W94D。
- 未施工 Relation/Branch、Player room、World、Hub 或服务器公共写入。
- 旧通用 Python REPL IPC 与 ECharts 导出兼容面仍保留；它们不再拥有 W94B 新执行的权威事实。
- 未修改只读历史语料 `docs/archaeology_v2/`。

## 2. 已落实现

### 2.1 合同、计算与绘图 adapter

- `main/calc-chart-contract.js`：严格冻结 `mazz.calc-definition/v1`、`mazz.calc-result/v1`、`mazz.chart-spec/v1` 与 `mazz.chart-svg/v1`；稳定身份、类型、颜色、列映射、secret/URI/path 与 SVG 安全门。
- `main/capabilities/calc-python-adapter.js`：产品固定的隔离 Python expression adapter；只接受受限 AST 与数学白名单，不接受 import、attribute、subscript、assignment、shell、路径、环境或网络参数。
- `main/capabilities/chart-svg-adapter.js`：DOM/Canvas/网络无关的 deterministic SVG adapter；支持 bar、line、area、scatter、pie、radar，并转义标题、系列与类别文本。

### 2.2 Artifact 真相层与消费边界

- `main/capability-artifact-store.js`：流式写入、完整 SHA-256、staging `fsync`、排他 hard-link publish、同 hash 复核复用、layout/reparse/identity fail-closed；正式读取绑定已打开 FD，防止 open 后 pathname 被替换。
- `main/capability-execution-service.js`：adapter 可在一次执行中发布一个或多个正文 Blob，再由 W94A 单事务持久 Receipt 与 Artifact descriptor；durability failure 不伪装成功。
- `main/capability-execution-ipc.js`、`preload/bridge.js`：新增 trusted/current main-frame 才可签发的单次 Artifact grant；Renderer 不获得正式绝对路径或长期 token。
- `main/main.js`：生产启动注册 Calc/Chart adapters，并通过 `mazz-res://artifact/<grant>` 直接流式消费；退出等待 execution、artifact stream 与 Python process owner 收敛。
- `main/file-watcher.js`：精确忽略 `.mazz/capability-artifacts`，内部事实与 Blob 写入不触发 sidebar 文件树刷新。

### 2.3 产品接线

- `renderer/modules/math/index.js`：Python expression 新执行改走 capability proposal/execute + Artifact stream；历史不再固定只留 50 条。
- `renderer/modules/markdown/calc-block.js`：Markdown `calc` 不再直接调用 `py:exec`，不再截断 256 KiB 结果或固定驱逐 128 条。
- `renderer/modules/sheet/charts.js`：选区先冻结为 Chart Spec，再生成可追责 SVG Artifact；既有 ECharts 层仅保留兼容预览/导出，不再拥有权威 Chart 真相。

## 3. 关键故障与边界闭合

1. Calc 任意代码、import、属性/下标、文件、环境、进程与网络旁路均 fail-closed；Abort/timeout 会结束 Python owner。
2. Chart 六图型的标题、系列与类别全部转义；SVG 不含 script、foreignObject、外部 URL、事件属性或时间随机量。
3. Artifact publication 不使用 `Buffer.concat`、base64 或 copy fallback；正式 Blob 只在完整 hash、文件 `fsync` 和排他发布成功后可进入 Receipt。
4. Artifact read grant 单次消费、current Workspace 绑定；FD + identity 复核阻止 pathname 替换后读取错误字节。
5. 相同 Definition/Spec exact replay 不双执行；Source/Packaged 对 Calc、Chart Spec 与 SVG 产生相同内容哈希。
6. `.mazz/capability-artifacts` 内部写入的文件树事件为 `0`；退出后 execution、artifact stream、Python process、service active 与 staging 全部为 `0`。

## 4. 验证证据

### 4.1 定向、相邻与全量

- W94B contract：`14/14 PASS`；W94A：`16/16 PASS`。
- W71 lifecycle/security：`12/12`；Markdown roundtrip：`6/6`；W72 foundation：`6/6`；W72b：`6/6`；W72c provenance：`7/7`；W72d：`7/7`；W79 Blender 基线：`7/7`；W86：`9/9`；W93A：`35/35`。
- W67 旧反向合同已按新规格裁决：传输/资源安全预算保留，Calc 结果不再固定条数驱逐；定向 `4/4 PASS`。
- `npm test`：最终工作树 `273/273 test files passed`。
- `npm run build`、`npm run dist:dir`、`git diff --check`：PASS。

### 4.2 Source / Packaged runtime

- [Source 运行证据](./evidence/W94B_CALC_CHART_SOURCE.json)：PASS；生产 Calc/Chart adapter、真实系统 Python expression、typed result `5`、deterministic SVG、restart reopen、exact replay、网络调用 `0`、runtime error `0`。
- [Packaged 运行证据](./evidence/W94B_CALC_CHART_PACKAGED.json)：PASS；同一断言集运行于最终 `win-unpacked`，不是源码替身。
- 两端 Calc result 内容哈希一致：`sha256-a2489e86b62072094a2cbfd6b4bde3597d03ce3e3d1c5bfa4c0a9c9667b17e0a`。
- 两端 Chart Spec 内容哈希一致：`sha256-df9340e175b2f149f52ddb7e93eb53fd661b2da8f0c5b0009aa199734e44a06b`。
- 两端 SVG 内容哈希一致：`sha256-867cc53df73ff25d3fdf4ac2249281adfc6ae9ee88ce44b0c55267db05475209`。
- Source evidence SHA-256：`779C45A835647AB79FD1B3D44604D7BE807E48AB740A0A5A51976379ADD12EF9`。
- Packaged evidence SHA-256：`04B736E20F7EA0D0E016AE6E4BEC1C6010FE2AF28DBF6618B536CA3FA835F850`。

### 4.3 打包同代与源码绑定

- `Mazz Editor.exe`：`E958C875CF131DD28A8384191E12F0EF6B019CEAD6993F3752D06A22AD74D69D`。
- `app.asar`：`8928BAB28A0CAA3FFFF7B935F6877E8DBF5BE222AA586009FD628DBBED06876E`。
- renderer bundle：`9A33C00C46907C44B0C604BA3623F59CE8036C732C88130E0CD796E79169AE37`；Source 与 Packaged evidence 均绑定该值。
- `app.asar` 内下列主进程文件与当前源码逐文件 SHA-256 一致：

| 文件 | SHA-256 |
| --- | --- |
| `main/calc-chart-contract.js` | `B2AAADC3ADEA1199069EB66D641661CC06A3603200200B8E524C61D701B3F836` |
| `main/capability-artifact-store.js` | `5C3CEF86C44458C1D6B28749E99C006BEC70BD2F24E990442F5859D493F915D1` |
| `main/capabilities/calc-python-adapter.js` | `A5FFB5BC0DDF4B12A8EAF99E49019F9B568FD316D02EDBEC282AC053C8A0A299` |
| `main/capabilities/chart-svg-adapter.js` | `27AA254897A0AF05BCB5903B25A4383AE64057D07B04902B6FF9323056C41486` |
| `main/capability-execution-service.js` | `0BC7A7235D37CA8660524A2CAEDC8F3853DED1896A77658D523B5F74D7125DD8` |
| `main/capability-execution-ipc.js` | `0B19067C1E002A67182319F3646B1C3496703A6D52D8DDD8C17CD60B33D5827C` |
| `main/main.js` | `8AEB6511BB4367EF093644E4F592C13349E61377881B6E00017BD7EEF53F40E8` |
| `preload/bridge.js` | `076C4D42711B854ADD63DE477D33081EF73590F9F9CDCBAC240E1B2AD6E87283` |

### 4.4 治理、隐私与资源

- [Secret audit](./evidence/W71_SECRET_AUDIT.json)：`PASS_NO_CURRENT_TREE_SECRET_CANDIDATES`，扫描 `382` 文件，findings `[]`。
- [Release audit](./evidence/W71_RELEASE_BASELINE.json)：provenance status `PASS_REPOSITORY_PROVENANCE_BASELINE`，blockers `[]`；最终 package specimen 已登记。
- OSS provenance ledger：`CURRENT`；package script 变化已重生成账本。
- W94B 两份 JSON 不含 Key、Bearer、HTTP URL、用户绝对路径、请求/响应正文或用户私有资产。
- Source/Packaged 均记录 network calls `0`、runtime errors `[]`、file-tree internal events `0`；Capability/Artifact/Python owners、service active、durability failures、artifact staging 全为 `0`。

## 5. 已知非阻断项

- Node `MODULE_TYPELESS_PACKAGE_JSON`、npm mirror 配置弃用、既有 jsdom Canvas warning 仍存在；它们没有被写成 W94B 功能通过证据。
- W94B Chart 的权威输出是 deterministic SVG，不是“真实通用 Canvas 编辑器”；Canvas Agent 必须在 W94C 单独施工和实测。
- 计算当前是安全受限的 Python expression，不是任意 Python notebook/REPL；旧通用执行入口的后续退役不在本波冒充完成。
- 当前 `win-unpacked` 是本波 Packaged specimen；历史 NSIS 安装包不作为 W94B 制品声明。

## 6. 回滚与复开

回滚时可移除 Calc/Chart contracts、Artifact Store、两个 production adapters、grant protocol、Math/Markdown/Sheet 接线及 W94B 测试；不得删除 Workspace 中已经发布的 content-addressed Blob 或 W94A Receipt/Artifact 事实。旧 Math/Markdown/Sheet 文件与兼容预览仍可读。

若出现以下任一情况，W94B 重新变为 RED：同 Definition/Spec 内容哈希漂移；任意 Python/路径/网络旁路可达；Artifact publication/read 有替换窗或 base64/整读回退；相同 Proposal 双执行；Sheet/Markdown/Math 新执行绕开 W94A；Source/Packaged 不同代；资源、隐私或 provenance 门失败。

## 7. Final Gate 与下一精确波次

**W94B PASS。** 下一精确波次只有 **W94C Canvas Agent Construction**：先冻结 Canvas Document、Layer、Selection、Mask、Operation、Revision 与 Artifact Ref，再施工结构化编辑、撤销/重做、冲突和 Source/Packaged 真实 Canvas roundtrip。W94C PASS 前不进入 Blender、Player、World 或 Hub 产品施工。
