# W94A Capability Execution Spine 检查点

> 结论：**PASS / CHECKPOINTED / W94B NEXT**
> 日期：2026-08-25
> 代码基线：`main@0add39fce403`；本检查点对应其上的 W94A 实施工作树
> 总施工参照：[W94 Unified Capability, Artifact & Public Plane](../plans/W94_UNIFIED_CAPABILITY_ARTIFACT_AND_PUBLIC_PLANE.md)
> 施工规格：[W94A Capability Execution Spine](./W94A_CAPABILITY_EXECUTION_SPINE_SPEC.md)

## 1. 本波裁决

W94A 已建立主进程唯一的 `Registry → Proposal → Lease → Receipt → Artifact` 耐久执行脊柱，并完成 fixture capability 的 Source 与 Packaged 闭环。执行真相由 Workspace 内持久账拥有；Renderer、adapter、短命 Promise 与内存 owner 都不能自行宣布完成。

本波只交付公共执行脊柱，**没有**声称以下能力已经完成：

- 未接 raw Python、计算内核、Chart、Canvas 或 GPU 绘图。
- 未接已安装的 Blender 5.2，也未开放任意可执行路径或 shell。
- 未接 Player transport、P2P 房间、World、Hub、排行榜、市场或公共网络写入。
- 未把测试 fixture 注册成生产用户能力；只有 `NODE_ENV=test` 且显式设置 `MAZZ_E2E_CAPABILITY_FIXTURE=1` 时才注入。
- 未修改只读历史语料 `docs/archaeology_v2/`。

## 2. 已落实现

### 2.1 主进程合同与真相层

- `main/capability-execution-contract.js`：严格 Descriptor、Proposal、Lease、Receipt、Artifact schema；稳定身份；状态机；secret、私有路径、URI 与递归编码隐私门。
- `main/capability-execution-store.js`：绑定 canonical Workspace 的原子事实账；跨实例锁、CAS、`fsync`、腐败阻断、布局身份与 reparse 防护、显式 orphan-lock repair。
- `main/capability-execution-service.js`：唯一 registry/service owner；提交、执行、取消、恢复、退出；ResourceLedger owner；持久成功回执优先于内存 readback。
- `main/capability-execution-ipc.js`：冻结五个窄 IPC；只接受已发布 Mazz 主 frame；Renderer 不能指定任意 Workspace、adapter、路径或正文。
- `main/capabilities/fixture-capability-adapter.js`：只供显式测试注入的确定性 fixture。

### 2.2 产品接线与观测

- `main/main.js`：ready 阶段在首窗前恢复当前 Workspace；唯一 service；退出阶段等待 durability 与 owner 收敛。
- `preload/bridge.js`：仅暴露 `capability:list/workspaceSnapshot/submitProposal/executeProposal/cancelProposal`。
- `main/file-watcher.js`：精确忽略 `.mazz/capability-runtime` 内部事实写入，避免执行期间 sidebar 因内部账本持续刷新。
- `tests/run.js`、`package.json`：W94A 合同进入默认全量，另有显式 Source/Packaged runtime 命令。

## 3. 关键故障闭合

1. 同 Proposal exact replay 只产生一条 Proposal、Receipt 与 Artifact；多 Store/多调用不双执行。
2. `queued/running` 只由单实例 owner 显式恢复为 `paused`，普通 reopen 不夺取仍活跃实例的任务。
3. adapter 已执行成功但 Store/目录 `fsync` 失败时，错误保持为 durability failure；不得改写成看似已持久的业务 failed receipt。
4. 取消、adapter failure、重启和退出均释放 Lease 与 ResourceLedger owner；腐败、layout swap、symlink/reparse 和异常 lock fail-closed。
5. Descriptor、Proposal、Receipt 与 Artifact metadata 拒绝 secret、绝对私有路径、URI 以及多层 percent-encoded 旁路；正文不进 Receipt/Artifact metadata。
6. `.mazz/capability-runtime` 写盘不会进入文件树 watcher 广播链，关闭了本轮能力执行导致 sidebar 闪动的同源风险。

## 4. 验证证据

### 4.1 定向、相邻与全量

- W94A contract：`16/16 PASS`。
- W72 foundation：`6/6`；W72b：`6/6`；W72c provenance：`7/7`；W72d：`7/7`。
- W73e scheduler：`9/9`；W73e factory：`9/9`；W79：`7/7`；W86：`9/9`；W93A：`35/35`。
- `npm test`：最终工作树 `272/272 test files passed`。
- `npm run build`、`npm run dist:dir`、`git diff --check`：PASS。
- W71 Packaged 外部文件变更：PASS；资源终态改为连续三次稳定 identity-subset/no-growth，允许启动期临时 owner 正常退休而拒绝新增/替换 owner。

### 4.2 Source / Packaged runtime

- [Source 运行证据](./evidence/W94A_CAPABILITY_EXECUTION_SOURCE.json)：PASS；exact replay、restart reopen、持久计数 `1/1/1`、内部文件树事件 `0`、网络调用 `0`、owner/active/durability failure 均 `0`。
- [Packaged 运行证据](./evidence/W94A_CAPABILITY_EXECUTION_PACKAGED.json)：PASS；同一断言集，运行于最终 `win-unpacked`。
- 两端 Artifact 内容哈希一致：`sha256-21fe0e063bdd1f061d1daba6117c0a82276e8c0e157c835ddf717fb7c2017e34`。
- Source evidence SHA-256：`1DEF51004C34BC005357F041E1EED99343826167436DA25369F25C6E3A6A11A8`。
- Packaged evidence SHA-256：`71685928FB12D966F2A6BB9E6178023D63C795DA177489B10BAE0C90A18D5133`。

### 4.3 打包同代与源码绑定

- `Mazz Editor.exe`：`6f41eea931327728ee80c91341e8d31b08f0f296dbbabd2b39013d294fc2b73e`。
- `app.asar`：`6c488a3fad0d331cc52a8fdc8f501a28a8b78ba38c3c990c725a4ab7c85cbeee`。
- renderer bundle：`7bee0e3ebe874febeaa7fbfb9455c89fdf340ad1bc9d47ac2c7c5416da5e9e73`。
- `app.asar` 内 W94A 新主进程文件与源码逐文件 SHA-256 一致：

| 文件 | SHA-256 |
| --- | --- |
| `main/capability-execution-contract.js` | `3D670A848EF83FE45A7A2B5FC5F27CF9A48FD747199F1BC05560AA96FDB2BCA5` |
| `main/capability-execution-store.js` | `5F5AD10C4978FD64A807AD1757BF2E04AC567E7C685A1DC4A1134F75A28F4AEA` |
| `main/capability-execution-service.js` | `FBCC387F042BDA5AA2E59B14FEE169F06E81E3EBFE313A553EB80C899A0B37D0` |
| `main/capability-execution-ipc.js` | `57DFD6FBA26598098EA758219E3F10F3D7A65C3C1C72D739B381C57EA6BBFAEF` |
| `main/capabilities/fixture-capability-adapter.js` | `76C70D3C640DBB2C75F3677F0766F7452E24AD218501EF703BDCB6DD6198B548` |
| `main/main.js` | `D4044B24162F32B5A34F94362D1728BD28635E9F1D985FA74FD78F236273CAE3` |
| `preload/bridge.js` | `CB29007B3C72FE0389A926966029D1A9CA7F57035C875DA26464301A308A8B97` |
| `tests/contract/w94a-capability-execution-spine.test.mjs` | `06B51D3101CF94490C994391EBB5D31C81BBD0484485DB2AC4D6EB08C89EE6C8` |
| `tests/e2e/w94a-capability-execution-runtime.mjs` | `0048C3B6C72643B9146BC8A2820BB676A07E37108FA90FF745397499220E8B9D` |

同代施工文档 SHA-256：总施工参照 `31699FD15C0B5F1992506DB2B6F37A4375AC55366577C96403874345F561900C`，W94A 规格 `E253005EADBF6E2FBA2570712CF3B2F5C2EE4AA824C6122730436B0A56D85C6F`，施工蓝图库 README `E88E4C8D5E5CF8EBB25835ADEC7EEE596DFCEABB7859264C7DA106CBB1E02AE5`。

### 4.4 治理、隐私与资源

- [Secret audit](./evidence/W71_SECRET_AUDIT.json)：`PASS_NO_CURRENT_TREE_SECRET_CANDIDATES`，扫描 `377` 文件，findings `[]`。
- [Release audit](./evidence/W71_RELEASE_BASELINE.json)：blockers `[]`；最终包配置与源码面已登记。
- OSS provenance：`PASS_REPOSITORY_PROVENANCE_BASELINE`，blockers `[]`；package script 变化已重生成账本。
- W94A 两份 JSON 不记录用户绝对路径、secret、请求/响应正文；fixture 输入只在测试 Proposal 中出现，不进入 Receipt/Artifact metadata。
- Source 与 Packaged 退出后 capability execution owner、service active、durability failure 均为 `0`；临时 Workspace/profile 已清理。

## 5. 已知非阻断项

- Node `MODULE_TYPELESS_PACKAGE_JSON`、Playwright `DEP0190`、npm project-config deprecation 与既有 jsdom Canvas warning 仍存在；本轮没有把它们伪装成 W94A 功能缺陷或完成项。
- Fixture adapter 文件随包存在以支持显式 Packaged E2E，但生产启动条件不会注册它；这不等于产品已提供 fixture capability。
- W94A 的 `state.json` 是执行事实索引，不是最终大资产正文仓；W94B 起的 Calc/Chart 输出仍须接流式 Artifact Store。

## 6. 回滚与复开

回滚时可移除 W94A service/store/contract/IPC、main/preload 接线、fixture 与 W94A 测试，并删除 watcher 对 `.mazz/capability-runtime` 的精确 ignore；不得删除用户 Workspace 中已经存在的事实账。W71 stable identity-subset/no-growth 测试修正可独立保留，因为它纠正了启动临时 owner 正常退休被误判为泄漏的问题。

若出现以下任一情况，W94A 重新变为 RED：持久账可被 Renderer/adapter 绕过；Store 错误被 readback 误判成功；相同 Proposal 双执行；退出后 owner 不归零；Source/Packaged 不同代；隐私或 provenance gate 失败。

## 7. Final Gate 与下一精确波次

**W94A PASS。** 下一精确波次只有 **W94B Calc + Chart 可追责资产链**：先冻结 Calc Definition、Chart Spec、隔离执行与流式 Artifact publication，再接现有 Sheet/Markdown/Chart 表面。W94B PASS 前不进入 Canvas、Blender、Player 或 Hub 产品施工。
