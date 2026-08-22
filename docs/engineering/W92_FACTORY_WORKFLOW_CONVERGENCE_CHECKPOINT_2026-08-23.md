# W92 智能创作工作流收敛检查点（2026-08-23）

## 结论

W92 在本轮授权范围内完成并封板。项目立项、持久业务回执、智能创作执行、断点恢复、专业流程审校、智能创作台投影，以及 Source / Windows `win-unpacked` 运行时已经形成同一条可复验链路。

用户可见结果：

- 立项窗标题回到“新项目立项”；`AI 服务设置` 是右上角有边框、有文字、有焦点态的次按钮，不再作为左上角裸页签。
- 小说长度只有一套权威规格：短篇 1 万、中篇 10 万、长篇 50 万、无限；手填后进入“自定义”，预计章数按向上取整显示。
- 920×720、761×720、760×600、520×480、480×360 均保持关键规划区与提交操作可达；标签、required、radio/button 状态和 live output 可被辅助技术读取。
- “立刻开工”先建立稳定业务回执，再后台执行；失败、超时、迟到回执、批量部分成功、重启与注册表丢失都不能复制项目。
- 智能创作台可从磁盘收据重建任务，展示自动校验、节点验收、交叉审校、复核与仲裁、人工最终审定的真实状态与工件。

## 正式术语与范围

历史资料中的“六方体系 / 双环流水线 / Factory / W68”在产品显示层统一为 **智能创作专业流程 / 创作流 / 智能创作 / 智能创作台**。四档编制语境中的旧“六方”对应“专业版”。这里的“六方”表示必须分权并留痕的职能，不表示固定六个模型、六个 Provider 或六个进程。

底层仍保留既有 role id、协议号和兼容文件名，供恢复、磁盘互通与历史审计使用；它们不再作为面向用户的产品分类。本轮真实 Provider 验收使用本机已加密保存的 `DeepSeek / deepseek-v4-pro` 跑完专业职能链，证明分席权限与工件协议真实执行，但不冒充多 Provider 独立性。

上位架构正式名为 **生产组织编译器（W82 Organizational Compiler）**。本检查点只封存智能创作运行链，不声称 W82 编译后的完整组织已在本次真实 Provider 坐标执行，也不触发 Publication、Canon、MazzHub 或跨用户发布。

## 完成证据与 fail-closed 边界

- 流式与非流式调用都保留精确 `finishReason`、完成种类与 usage；`length`、`content_filter`、空终态、损坏 EOF、中断和对象伪正文均不可提交。
- 正文必须同时满足 Provider 安全终态与模型原生字数声明。系统不补造声明；半稿只进入 checkpoint。
- `reasoning_content` 永不作为作品或审校工件。官方 DeepSeek v4 只在精确官方 origin、精确专业 role 上显式使用 direct-output 选项；普通正文、研究、蓝图 stream 和非 DeepSeek 连接不继承该策略。
- 节点验收、交叉审校、答辩、复议、庭审与裁决均使用严格类型包、真实证据引用、全局唯一质询 ID 和持久的原始请求/系统归一记录；坏包、伪引用和越权决定 fail closed。
- 四闸是唯一封存真相。安静路径不让仲裁席发明“第五闸”；有真实关闭闸、未撤质询或证据冲突时才允许阻断。
- 任务的 mode、字数、章数、审校档、预算、双环/预览开关和事务标识进入 canonical 状态包。显式 `false` 与预算 `0` 不会被旧值或默认值覆盖。
- 文件监视在真实 ready 后才报告健康；fatal 为粘性 degraded，并可保留全部 roots 重建。Chokidar 3.6.0 close/readdir 竞态补丁有可复算指纹。

## 最终验证矩阵

| 门 | 结果 | 关键事实 |
|---|---|---|
| 全量测试 | **256/256 PASS** | 最终验收门修正后重新完整执行，exit 0 |
| W92 专项合同 | **28/28 PASS** | 非流式完成证据、严格专业席协议、发布原子边界、watcher、资源身份边界 |
| 确定性 Source | **PASS** | max/BLUEPRINT 正向任务 done；截断任务 stopped、checkpoint 1、正式章节 0；重启零重复 |
| 确定性 Packaged ×2 | **PASS / PASS** | 与 Source 相同的正向、截断、重启和 watcher 门连续两轮通过 |
| 真实 Provider ping | **Source PASS / Packaged PASS** | 使用隔离复制的加密 Factory 配置；未输出明文 Key |
| 真实 Provider 完整流程 | **Source PASS / Packaged PASS** | 单篇；121/121 字、1 单元；正文逐字匹配；42 项工件；四闸全开且 sealed |
| 真实模式分流 | **PASS** | `runSingleTask=1`、`runMaxTask=0`；Provider max 蓝图未调用；本地单元索引精确匹配持久收据 |
| 资源与关机 | **PASS** | 稳定终态身份是启动基线子集；无新增 owner、Factory request/run owner 为 0；watcher 唯一且 watching；关机后 fatal 0 |
| Build / Provenance | **PASS / CURRENT** | 最终 bundle 构建成功；OSS ledger 无漂移；`git diff --check` 无错误 |
| Secret audit | **PASS** | 当前树 351 个受检文件无 secret candidate；报告不回写匹配值 |

确定性门使用进程内真实 loopback OpenAI-compatible HTTP 服务，不走产品 mock 分支；真实 Provider 门只有显式设置 `MAZZ_E2E_ALLOW_LIVE_PROVIDER=1` 才会启动并消耗真实额度。默认 `npm test`、`test:e2e` 和构建流程不会读取或调用本机 Key。

## 发布制品绑定

两份 manifest 的 `result` 必须为 `PASS`，且其内嵌坐标与哈希一致，才构成本检查点的发布证据；单独的 leaf JSON 或 PNG 不独立构成 PASS。

| 制品 | SHA-256 |
|---|---|
| `release/win-unpacked/Mazz Editor.exe` | `8ac85b69d8ad9761d66704dbebff6537e9bb8837f5884aecb8ba6944cfe67619` |
| `release/win-unpacked/resources/app.asar` | `b54c2bf3f860218d401374003e27f67c78afeab137551b4382fe9ba2264e2457` |
| `renderer/dist/app.js` / asar 内嵌 bundle | `13e293c2e2d79d2b7389e9e314d3c3cf165caf61fee476e3f1b960362153ed94` |
| `patches/chokidar+3.6.0.patch` | `0960b165fd49a72924ebac3b7343bd8861ce5150ac746f6a6ea34fd238cd3ccb` |

发布 helper 逐项强校验 source 与 asar 内嵌版本一致：`renderer/dist/app.js`、`renderer/panels/factorycfg.html`、`main/main.js`、`main/factory-sse.js`、`main/panel-windows.js`、`main/file-watcher.js`、`main/audio-artwork.js`、`preload/bridge.js`、`node_modules/chokidar/lib/nodefs-handler.js`；并比较 canonical package 字段及依赖/overrides。这里验证的是 `win-unpacked`，不是新签名的 NSIS 安装包。

## 隐私与证据

- 真实门只复制 Factory provider/routing 与相应加密 secret 到临时 userData；workspace 固定为临时目录。
- 结构化 JSON 不记录 Key、真实 Provider 请求/响应正文、推理内容、owner key 或真实用户工作区路径；截图只显示合成 E2E fixture / 审校工件片段，不包含真实用户正文。
- Source 与 Packaged 结束后活动 Mazz/Electron 进程为 0、`mazz-w92-*` 临时目录为 0，真实 Downloads 工作区未产生验收项目。
- 五张最终截图已人工回看：显示正式产品术语、智能创作台与专业工件；无明文凭据或真实用户文件名。

发布权威：

- [确定性发布 manifest](./evidence/W92_FACTORY_RELEASE_MANIFEST.json)
- [真实 Provider 发布 manifest](./evidence/W92_FACTORY_LIVE_RELEASE_MANIFEST.json)
- [确定性 Source 证据](./evidence/W92_FACTORY_WORKFLOW_SOURCE.json) · [截图](./evidence/W92_FACTORY_WORKFLOW_SOURCE.png)
- [确定性 Packaged-1 证据](./evidence/W92_FACTORY_WORKFLOW_PACKAGED_1.json) · [截图](./evidence/W92_FACTORY_WORKFLOW_PACKAGED_1.png)
- [确定性 Packaged-2 证据](./evidence/W92_FACTORY_WORKFLOW_PACKAGED_2.json) · [截图](./evidence/W92_FACTORY_WORKFLOW_PACKAGED_2.png)
- [真实 Source 工作流证据](./evidence/W92_FACTORY_LIVE_WORKFLOW_SOURCE.json) · [截图](./evidence/W92_FACTORY_LIVE_WORKFLOW_SOURCE.png)
- [真实 Packaged 工作流证据](./evidence/W92_FACTORY_LIVE_WORKFLOW_PACKAGED.json) · [截图](./evidence/W92_FACTORY_LIVE_WORKFLOW_PACKAGED.png)
- [真实 Source Provider 证据](./evidence/W92_FACTORY_LIVE_PROVIDER_SOURCE.json) · [真实 Packaged Provider 证据](./evidence/W92_FACTORY_LIVE_PROVIDER_PACKAGED.json)

截图 SHA-256：确定性 Source `d75ace9d…f67c9`，Packaged-1 `dc7713b8…78566`，Packaged-2 `73f841d4…a4b85`；真实 Source `26c0d45d…dd200`，真实 Packaged `bafe021a…9d095`。

## 前置并入范围：W90 / W91

本次提交同时保留并登记前两项用户可见收敛：

- **W90 网络资源**：四站状态首开自动探测一次、每站手动检测、统一重置；Mikan 年份/季度身份与真实封面缩略图收敛。合同 `w90-player-network` 10/10，通过 `npm run test:w90:catalog` 的真实 Mikan Chromium 解码门。
- **W91 音频封面**：旋转圆盘退役为 1:1 方形封面卡；有内嵌封面时原位 `object-fit: cover`，无封面时显示自绘方形音乐图标；切歌代次、取消、缓存与有界解析闭环。parser 9/9、UI 4/4；用户提供的音乐样本 11/11 可提取内嵌封面，声明 MIME 与图片魔数冲突时以魔数为准。

这些前置项不扩大 W92 的组织执行声明；它们只是同一最终源码、bundle 和发行包中的并入改动。
