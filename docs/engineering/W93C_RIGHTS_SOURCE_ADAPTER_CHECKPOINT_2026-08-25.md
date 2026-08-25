# W93C Rights & Source Adapter Foundation 检查点（2026-08-25）

> 结论：**PASS / W93D NEXT**
> 上位规格：[W93 Library Resource Freedom](../plans/W93_LIBRARY_RESOURCE_FREEDOM.md)
> 波次规格：[W93C Rights & Source Adapter Foundation](./W93C_RIGHTS_SOURCE_ADAPTER_SPEC.md)
> 权威证据：[W93C_RIGHTS_SOURCE_ADAPTER.json](./evidence/W93C_RIGHTS_SOURCE_ADAPTER.json)
> 运行边界：默认离线；未访问真实书源，未读取 Provider Key，未修改 Factory。

## 1. 本波交付

- `LibrarySourceRegistry` 以冻结 Descriptor 为来源真相，统一 `search/discover/resolve/health` 的严格 Page、取消、错误、版本和资源生命周期合同。
- fixture Adapter 只读内存页；分页没有固定页数或条目上限，仅由自然 cursor 终点、重复 cursor、取消或明确错误收敛。
- Candidate 再次通过 W93A strict normalizer，并绑定 provider、adapterVersion 与 policyVersion；同 ID 同内容幂等，同 ID 内容漂移 fail-closed。
- `evaluateRights()` 完成 public-domain、open-license、user-owned、unknown、restricted 五态裁决；来源声明不会被当成全球法律结论。
- `prepareAcquisitionJob()` 不信任调用方回传的 Decision，而是重新裁决并 canonical 比对；仅 passing 结果生成 allowlist Rights Receipt，随后仍由 W93A Store 复核并持久化。

## 2. 必查结果

| Gate | 结果 |
| --- | --- |
| W93C 定向合同 | `npm run test:w93c:library`：**14/14 PASS** |
| W93A 相邻合同 | `node tests/contract/w93a-library-resource-foundation.test.mjs`：**35/35 PASS** |
| W93B 相邻合同 | `npm run test:w93b:library`：**82/82 PASS** |
| Source Electron 模块运行门 | fixture discover→rights→durable Job roundtrip：**PASS** |
| Packaged Electron 模块运行门 | 同代 `win-unpacked` 内嵌模块：**PASS** |
| 默认全量 | `npm test`：**267/267 个测试文件 PASS** |
| Build / Packaged 目录 | `npm run build`、`npm run dist:dir`：**PASS** |
| 发布面与来源账 | W71 census 更新并复核；`npm run audit:provenance`：**CURRENT** |
| 语法 / diff | W93C 主文件与运行测试 `node --check`、`git diff --check`：**PASS** |
| 资源终态 | W93C Electron/Node 产品进程 `0`；`mazz-w93c-*` 临时目录 `0` |

第一轮全量为 265/267：两项失败精确对应新增主进程面未登记进 W71 surface census、变更后的 package/source 未登记进 OSS provenance ledger。使用仓库正式生成器更新两份权威账后，两个定向审计与第二轮全量均通过；没有删除或放宽审计门。

## 3. Source / Packaged 运行事实

两个坐标都通过 Electron executable 的 `ELECTRON_RUN_AS_NODE=1` 加载实际 Source 或 `app.asar` 中的 W93C 主进程模块；这是模块运行与打包绑定门，不冒充 BrowserWindow/UI E2E。

- 各自然遍历 57 页 fixture，得到 57 个候选；discover 调用 57 次；
- 权利裁决为 pass，durable Job 重开后为 queued，Receipt 与 Candidate fingerprint 绑定；
- `http/https/net` 调用均为 `0`，runtime error 为 `0`；
- Registry 关闭后 registered、active call、timer、listener、network owner 全为 `0`；临时 Workspace 清理成功；
- Source 与 Packaged 的 registry / rights policy 文件哈希完全一致。

## 4. 权利、安全与故障边界

- public-domain/open-license 只有在来源 mode、jurisdiction、policy 时间与 evidence 全部匹配时通过；user-owned 必须有当前用户、Candidate fingerprint、法域和时间绑定的严格声明。
- unknown 固定 awaiting-rights，restricted 固定 blocked；两者无 passing Receipt，也不能通过伪造 Decision、authority 或替换 Candidate/Descriptor 升级。
- Descriptor/Page/Decision/User Assertion 拒绝 unknown field、非原生文本、secret、私网 URL、未来政策时间和版本漂移。
- Adapter 异常、取消、重复 cursor、同 ID 冲突、close 时仍有活动调用均有确定性 fail-closed 合同；错误正文不进入 durable Job 或 evidence。
- 本波没有新 IPC、后台网络 client、定时器、监听器、Provider token/字数/页数/条数/文件大小业务门。

## 5. 精确边界与下一波

W93C 没有接入 Gutenberg、OPDS、Internet Archive、Standard Ebooks 或任何真实站点；没有资源 UI、下载入口、缓存/速率限制、Torrent 或 Reader 渐进读取，也没有执行 live 网络测试。真实来源的 ToS、robots、许可与现时协议仍未核验。

**Final Gate：PASS。下一精确波次是 W93D First Source Pack & Federated Discovery；开始前必须先写规格并做现时来源/政策核验，真实网络仍须显式 opt-in。**
