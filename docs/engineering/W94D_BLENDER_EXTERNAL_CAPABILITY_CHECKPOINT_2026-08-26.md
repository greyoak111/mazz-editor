# W94D Blender External Capability 检查点

> 结论：**PASS / CHECKPOINTED / W94E NEXT**  
> 日期：2026-08-26  
> 施工规格：[W94D Blender External Capability](./W94D_BLENDER_EXTERNAL_CAPABILITY_SPEC.md)  
> 总施工参照：[W94 Unified Capability, Artifact & Public Plane](../plans/W94_UNIFIED_CAPABILITY_ARTIFACT_AND_PUBLIC_PLANE.md)

## 1. 结论

W94D 已将 Blender 外部进程能力接入 W94A 的统一 Capability/Artifact/Receipt 脊柱。
三种结构化 operation 均可从持久 `.blend` Artifact Ref 执行，输出经格式校验与完整 SHA-256
后原子发布；失败、取消、partial、版本探针和进程树收尸均有明确终态。Blender 不打包、
不下载、不接受任意 Python/shell/path/env，也不产生公共面副作用。

## 2. 实现落点

- `main/capabilities/blender-external-adapter.js`：W94A Capability adapter；Descriptor、
  Artifact Ref materialize、Workspace staging、hash/type 校验、三 operation、单次取消合并、
  output publication、Receipt environment/provenance。
- `main/external-tools/blender-headless-adapter.js`：复用 W79 Supervisor/探针/路径安全/输出
  校验/timeout/partial/进程树；扩展 inspect 与 OBJ export 白名单；修复版本探针期间取消
  竞态，并按 operation 返回正确 output type。
- `resources/tools/blender/mazz_blender_capability.py`：Mazz-owned 固定脚本，只解析
  `render`、`inspect`、`export-obj` 三个 mode；不执行 proposal 或 Agent 提供的代码。
- `main/capability-execution-service.js`：适配器 context 只增加 Workspace identity/path、
  durable Artifact 查询与既有 publish/open；没有扩张 Renderer IPC。
- `main/main.js`、`package.json`：启动时注册 W94D，与 capability recovery 同闸；`resources/tools/blender/**`
  保持 `asarUnpack`；测试 fixture helper 仅在 `NODE_ENV=test` 存在。

## 3. 验证矩阵

| 门 | 结果 | 证据 |
|---|---|---|
| W79 相邻 Blender contract | **7/7 PASS** | `tests/contract/w79-blender-headless.test.mjs` |
| W94D targeted contract | **4/4 PASS** | `tests/contract/w94d-blender-capability.test.mjs` |
| Source fixture runtime | **PASS**：render/inspect/export、失败 Receipt、取消、8 proposals/8 receipts/6 artifacts、active/staging/process 全 0 | [Source evidence](./evidence/W94D_BLENDER_EXTERNAL_SOURCE.json) |
| Packaged fixture runtime | **PASS**：同一断言集，EXE SHA-256 已记录 | [Packaged evidence](./evidence/W94D_BLENDER_EXTERNAL_PACKAGED.json) |
| Source real opt-in | **PASS**：Blender 5.2.1 LTS，真实 `.blend`，三 operation、4 proposals/4 receipts/4 artifacts、资源全 0 | [Real Source evidence](./evidence/W94D_BLENDER_EXTERNAL_REAL_SOURCE.json) |
| Packaged real opt-in | **PASS**：同一真实 `.blend` 与三 operation，资源全 0 | [Real Packaged evidence](./evidence/W94D_BLENDER_EXTERNAL_REAL_PACKAGED.json) |
| Blender probe | **PASS**：`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`，`Blender 5.2.1 LTS` | 真实 `--version` 探针；路径不写入 Receipt |
| Build / packaged directory | **PASS** | `npm run build`、`npm run dist:dir` |
| Full regression | **PASS** | `npm test`（见最终执行输出；不得以局部测试代替） |
| Static / privacy / provenance / release | **PASS** | W94D 变更涉及文件 `node --check`；审计命令结果写入本工作区证据 |

## 4. 真实运行边界

真实 opt-in 使用测试生成的最小 cube/light/camera `.blend`，只作为输入 Artifact；产品执行仍
只调用 Mazz 固定脚本。真实 Blender 结果被标记为 `determinism: external`，版本、渲染后端、
系统字体与 GPU/CPU 环境差异不会被隐藏成确定性保证。真实运行不上传网络、不安装工具、不
触碰 Hub/Marketplace/Player/Public Projection。

## 5. 故障与资源收口

- malformed/missing/hash/type/path/operation 在 spawn 前拒绝，直接合同测试证明外部 spawn 为 0。
- fixture 非零退出与 partial 输出落 durable failed Receipt，未生成正式输出 Artifact。
- SLEEP 取消覆盖 probe→spawn 竞态；进程树终止后 `external-tool-process`、Capability active、
  Artifact staging 和自定义 `.mazz/capability-blender/staging` 均为 0。
- Source/Packaged 退出跨过 durable quit boundary；运行证据 `networkCalls=0`、runtimeErrors=0
  （正常退出事件不计入功能错误）。

## 6. 未完成边界（明确留给 W94E 及后续）

复杂材质/纹理编排、动画批处理、版本全矩阵、GPU 结果一致性、远程 Blender、任意脚本、
Player/World/Hub 公共面均未在 W94D 声称完成。下一精确波次为 W94E Relation Retrieval +
Branch Effective State。

**W94D PASS。**
