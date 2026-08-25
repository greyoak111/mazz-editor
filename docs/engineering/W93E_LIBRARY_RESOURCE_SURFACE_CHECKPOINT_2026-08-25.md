# W93E Library Resource Surface 检查点（2026-08-25）

> 结论：**PASS / W93F NEXT**
> 上位规格：[W93 Library Resource Freedom](../plans/W93_LIBRARY_RESOURCE_FREEDOM.md)
> 波次规格：[W93E Library Resource Surface](./W93E_LIBRARY_RESOURCE_SURFACE_SPEC.md)
> 权威证据：[W93E_LIBRARY_RESOURCE_SURFACE.json](./evidence/W93E_LIBRARY_RESOURCE_SURFACE.json)
> 运行截图：[Source](./evidence/W93E_LIBRARY_RESOURCE_SOURCE.png) · [Packaged](./evidence/W93E_LIBRARY_RESOURCE_PACKAGED.png)
> 运行边界：默认离线；只使用 `example.org` 合成 URL 建候选，未访问真实书源、未下载真实书籍、未修改 Factory。
> 审查口径：按用户要求由单 owner 实施、复核和冻结；没有启用子智能体。

## 1. 本波交付

- 现有书库新增“书架 / 资源”双页签；候选、版本、来源、格式、Rights、取得任务和修复状态在同一 Library owner 生命周期内展示。
- 主进程 `LibraryResourceSurfaceService` 统一持有 Source discovery、Candidate catalog、Rights 复议、Acquisition Job 与修复事务；Renderer 只提交查询词、opaque identity、expected revision 和明确动作。
- `<workspace>/书库/.resources/candidates/` 以 Candidate fingerprint 保存不可变快照；同一 Candidate 的新观察不会覆盖旧 Job 需要的历史版本，损坏与非普通记录进入 HOLD。
- 手动 HTTPS、自定义 OPDS 与 Gutenberg 均沿用 W93C Rights；unknown/restricted 不因存在 URL 或来源名称升级。本波运行坐标中 unknown 只建立 `awaiting-rights` Job，未启动传输。
- 七个窄 IPC 通道绑定可信已发布主 frame 和主进程当前物理 Workspace；投影不返回 artifact path、source/acquisition URL、secret、响应正文或原始错误正文。
- resource wake 只作提示，Renderer 重列持久真相；provisional、handoff、Workspace retirement 与 destroy 会撤销资源请求，finalize/activate 后才恢复写权。
- App 退出把资源服务纳入 Acquisition 的第二阶段耐久门；context、operation、background 与 controller 不归零时不得放行退出。

## 2. 必查结果

| Gate | 结果 |
| --- | --- |
| W93E 定向合同 | `npm run test:w93e:library`：**10/10 PASS** |
| W93A 相邻合同 | `node tests/contract/w93a-library-resource-foundation.test.mjs`：**35/35 PASS** |
| W93B 相邻合同 | `npm run test:w93b:library`：**82/82 PASS** |
| W93C 相邻合同 | `npm run test:w93c:library`：**14/14 PASS** |
| W93D 相邻合同 | `npm run test:w93d:library`：**12/12 PASS** |
| Source BrowserWindow | 合成 manual HTTPS → unknown → awaiting-rights → repair → 重启重放：**PASS** |
| Packaged BrowserWindow | 同代 `win-unpacked/app.asar` 重跑相同 UI 与耐久链：**PASS** |
| 默认全量 | `npm test`：**269/269 个测试文件 PASS** |
| Build / Packaged 目录 | `npm run build`、`npm run dist:dir`：**PASS** |
| 发布面 / Provenance | W71 census 同代更新；`npm run audit:provenance`：**CURRENT** |
| 语法 / diff | W93E 主文件与 E2E `node --check`、`git diff --check`：**PASS** |
| 资源终态 | W93E 临时目录 `0`；产品 Electron 进程 `0`；discovery/catalog/background/operation/controller owner 全为 `0` |

## 3. Source / Packaged 运行事实

两个坐标均通过实际 BrowserWindow 打开现有 Library，再进入“资源”页；不是仅加载模块的静态冒烟：

1. 首次 snapshot 为 0 Candidate / 0 Job，且未配置 contact 时 Project Gutenberg 明确禁用；
2. UI 保存一个合成的公共 HTTPS EPUB Candidate，页面显示“权利未知 / 等待权利确认”；
3. 取得按钮保持禁用；经可信 IPC 建立相同语义的 Job 后，持久状态为 `awaiting-rights`，transport 未启动；
4. 执行修复事务，关闭并重启应用；Candidate 与 Job 均从 Workspace 持久事实恢复，数量仍为 1/1；
5. discovery、catalog、background、operation、controller 均为 0，runtime error 为 0；临时 UserData 与 Workspace 在证据生成后删除；
6. Source 与 Packaged 截图只含合成标题/作者和状态，不含真实用户书名、绝对路径、Key 或真实响应正文。

## 4. 边界、失败与回滚

- 首轮全量为 `267/269`：W71 surface census 与 W72 OSS provenance 仍绑定上一波清单；更新确定性账本后两个定向门通过，第二轮全量 `269/269`。这两项没有被记作产品功能失败，也没有被跳过。
- 本波没有执行真实 Gutenberg/OPDS live；联系信息、礼貌访问、DNS/redirect 与协议解析由 W93C/D fixture 合同覆盖。真实 live 仍需明确 opt-in，不能成为默认测试。
- 本波没有为 unknown Rights 提供“仍然下载”旁路，没有暴露任意 headers/cookie/path/Candidate 创建 IPC，也没有把 wake payload 当事实。
- 回滚单位是 W93E 新增 service/catalog/IPC/resource-surface 与对应 main/preload/Library 接线；W93A–D 的 durable Job、Rights、Source、HTTP 与 Inbox 合同不依赖 W93E UI。
- `docs/archaeology_v2/` 是工作区原有未跟踪资料，不属于 W93E，未修改、未纳入提交或证据。

## 5. Final Gate 与下一波

**Final Gate：PASS。** W93E 的资源界面、持久 Candidate、unknown 权利阻断、任务重放、修复、Source/Packaged UI 与资源退出边界均有可复验事实，当前未发现可复现 P0/P1。

下一精确波次是 **W93F Torrent Book Transport**：只在新的规格与独立检查点内处理 torrent metadata inspect、默认 deselect、书文件选择、持久恢复、路径/Tracker/P2P 告知；W93E 不提前暴露 Magnet 或复用播放器内存队列。
