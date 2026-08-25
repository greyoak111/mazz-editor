# W93D First Source Pack & Federated Discovery 检查点（2026-08-25）

> 结论：**PASS / W93E NEXT**
> 上位规格：[W93 Library Resource Freedom](../plans/W93_LIBRARY_RESOURCE_FREEDOM.md)
> 波次规格：[W93D First Source Pack & Federated Discovery](./W93D_LIBRARY_SOURCE_PACK_SPEC.md)
> 权威证据：[W93D_LIBRARY_SOURCE_PACK.json](./evidence/W93D_LIBRARY_SOURCE_PACK.json)
> 运行边界：默认离线；未访问真实书源，未下载真实书籍，未修改 Factory。
> 审查口径：按用户要求本波由单 owner 实施和冻结树对抗复核，不启用子智能体；未发现可复现 P0/P1。

## 1. 本波交付

- `LibraryCatalogHttpClient` 只接受主进程注入的 resolver/requester/contact，逐跳校验公共 HTTPS 与 DNS；跨重定向不携带 validator，来源限速与 `Retry-After` 明确失败，不建立后台定时器。
- 通用 OPDS 1.2/2.0 Adapter 解析命名空间、acquisition link、next 与 search template；仅支持可读格式，DTD/ENTITY/处理指令、错 MIME、preview/buy/borrow 与未知字段均 fail-closed。
- Gutenberg Adapter 只使用官方 XML OPDS 坐标，要求可联系 User-Agent，单次用户动作只取一页，US 权利证据冲突时降为 unknown；不爬 HTML、不猜未公开 OPDS2 地址。
- 手动 HTTPS 入口只生成 `unknown` Rights Candidate；不把 URL、传输或来源名称升级为取得权。
- 联邦发现一次只推进每个选中来源的一页，按强 Work ID 分组，同名不误合；部分来源失败隔离，响应错误与正文不落 checkpoint。
- Workspace checkpoint 采用原子 CAS、物理路径与 corruption HOLD；只持久化 query/validator hash、opaque cursor 与必要 next URL，取消和失败不前移 revision。

## 2. 必查结果

| Gate | 结果 |
| --- | --- |
| W93D 定向合同 | `npm run test:w93d:library`：**12/12 PASS** |
| W93A 相邻合同 | `node tests/contract/w93a-library-resource-foundation.test.mjs`：**35/35 PASS** |
| W93B 相邻合同 | `npm run test:w93b:library`：**82/82 PASS** |
| W93C 相邻合同 | `npm run test:w93c:library`：**14/14 PASS** |
| Source Electron 模块运行门 | OPDS1/2、Gutenberg、manual、federated、checkpoint：**PASS** |
| Packaged Electron 模块运行门 | 同代 `win-unpacked/app.asar` 内嵌模块：**PASS** |
| 默认全量 | `npm test`：**268/268 个测试文件 PASS** |
| Build / Packaged 目录 | `npm run build`、`npm run dist:dir`：**PASS** |
| 发布面与来源账 | W71 census 更新并复核；`npm run audit:provenance`：**CURRENT** |
| 语法 / diff | W93D 主文件 `node --check`、`git diff --check`：**PASS** |
| 资源终态 | W93D 临时目录 `0`；产品 Electron/Node 进程 `0`；registry/checkpoint/catalog owner、timer、listener、network owner 全为 `0` |

## 3. Source / Packaged 运行事实

两个坐标均通过 Electron executable 的 `ELECTRON_RUN_AS_NODE=1` 加载实际 Source 或 `app.asar` 内嵌 W93D 模块；这是模块运行与打包绑定门，不冒充 BrowserWindow 资源 UI E2E。

- 每个坐标得到 2 个候选、1 个强身份分组、1 个 durable continuation；
- Gutenberg Candidate 权利状态为 `public-domain`（US 来源主张），手动 HTTPS Candidate 为 `unknown`；
- 注入 catalog requester 共处理 4 次 fixture 请求，实际 `http/https/net` 调用均为 `0`；
- runtime error 为 `0`，清理成功；registry、checkpoint、catalog 的活动请求、队列、timer、listener 与 network owner 全部归零；
- Source 与 Packaged 的 5 个 W93D 主模块 SHA-256 完全一致。

## 4. 现时政策、权利与安全边界

- 2026-08-25 复核 Project Gutenberg Robot Access、Terms of Use、Offline Catalogs and Feeds，以及 OPDS 1.2/2.0 官方规格；真实 live 不是结案必要门，本波未联网。
- Gutenberg 主站不作为 HTML 爬虫目标；高量目录留给官方 RDF/CSV/镜像。OPDS 仅用户驱动单页续取，并要求可联系 User-Agent。
- 来源 public-domain 声明不等于全球法律结论；US 外以及证据冲突均保持 unknown/awaiting-rights，仍须 W93C 决策与 W93A receipt。
- Catalog 每跳拒私网/保留地址，redirect 不转发潜在 validator；secret、签名 URL、响应正文与错误正文不进入 Candidate/checkpoint/evidence。
- 本波没有字数、token、页数、条目数、文件大小或来源数业务门；333 页 fixture 由 333 次明确 continuation 全部取得，单次调用绝不后台预取。
- 新增 `saxes@5.0.1` 作为直接依赖，用于 namespace-aware XML；OSS provenance ledger 已登记并为 CURRENT。

## 5. 精确边界与下一波

W93D 没有新增 Library UI、renderer 可控 Adapter、默认网络、真实书源 live、自动下载、Torrent、DRM、登录/验证码、IA/Standard Ebooks/OAPEN/OpenStax Adapter，也没有把发现成功冒充 Rights pass、Acquisition 或入架完成。

**Final Gate：PASS。下一精确波次是 W93E Library Resource UI & Repair；只有用户继续授权后才开始，届时把已完成的发现、权利、取得与 Inbox 真相接到书库资源界面，并执行新的 Source + Packaged UI/修复门。**
