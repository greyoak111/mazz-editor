# W71 文件打开与失败写盘安全检查点

> 日期：2026-08-16
> 范围：W71 Wave 1 / Data Reliability
> 结论：**PASS（代表性 Hard Gate）**
> 边界：关闭正式主路径的“假打开/假保存”风险，不声称穷举所有文件格式、编码、磁盘与权限组合。

## 1. 根因

DOCX 与 XLSX 的 `setContent()` 原为未返回的异步 Promise。Shell 在解析完成前就把标签标为干净、写入最近记录并启动文件监听；解析失败只弹提示，却留下一个看似成功的空白标签。EPUB 入库失败也有同类问题：`importPath()` 返回 `null` 后，外壳仍继续登记成功。

未知扩展名则一律回退到纯文本。二进制或无法可靠解码的内容可能显示为乱码，用户若继续保存，会把原文件覆盖成损坏文本。

这不是 UI 瑕疵，而是数据正确性缺陷：产品把失败冒充了成功。

## 2. 本轮改造

### 2.1 模块加载成功契约

- Module Registry 为每个实例提供不会产生未处理拒绝的 `ready → { ok, error }`；
- Markdown DOCX 与 Sheet XLSX 导入返回真实 Promise，不再内部吞掉失败；
- Shell 只有在 `ready.ok` 后才登记 recent、watch 与成功状态；
- 失败会撤回标签、模块实例和快照；
- 异步解析期间若用户已经关签，迟到成功不能重新登记状态；
- 磁盘外改重载同样等待解析完成，失败时不清除原有脏态；
- EPUB/CBZ/MOBI/AZW3 入库返回空结果时撤回临时书库标签。

### 2.2 轻量文件探针

新增主进程 64 KiB 取样探针，只回答文件是否为：

```text
UTF-8 文本
UTF-16 LE 文本
二进制
暂不支持的编码
```

探针不读取整份大文件，也不扩张成万能格式数据库。未知二进制和不支持编码会在进入编辑器前明确拒绝；合法未知 UTF-8 文本仍可按纯文本打开。UTF-16 LE BOM 文本按正确编码读取并剥除 BOM。

### 2.3 专用格式与失败写盘

- DOCX/XLSX/PPTX 先校验 Open XML ZIP 容器签名；
- `.mazzsheet` 必须有正确标识和至少一个工作表；
- `.mazzdraw` 兼容早期无 mark 文件，但必须至少有一个画帧；
- 大损坏 DOCX 的 Monaco 降级路径现在由统一错误边界接住；
- 转换异常不会写入原目标，标签保持 dirty；
- 原子写盘失败不会伪清脏，也不遗留 `.mazztmp`。

## 3. Packaged 真程序证据

门禁使用重建后的 Windows `release/win-unpacked/Mazz Editor.exe`，在干净 userData 和临时工作区逐一投喂：

| 样本 | 结果 | 标签/recent/snapshot 残留 |
|---|---|---|
| 非 Office 头 DOCX | 拒绝 | 0 |
| 损坏 ZIP DOCX | 拒绝 | 0 |
| 损坏 ZIP XLSX | 拒绝 | 0 |
| 损坏 EPUB | 拒绝 | 0 |
| 损坏 `.mazzsheet` | 拒绝 | 0 |
| 空壳 `.mazzdraw` | 拒绝 | 0 |
| 未知二进制 | 拒绝 | 0 |
| 未知文本编码 | 拒绝 | 0 |
| 超过 3 MiB 的损坏 DOCX | 拒绝 | 0 |
| 合法 UTF-16 LE 中文文本 | 无损打开 | 成功 |

此外注入一次 XLSX 转换异常和一次真实写盘失败：两者均返回失败、保持 dirty；转换目标原字节未变，原子写临时件归零。

机器证据：[`W71_FILE_OPEN_SAFETY.json`](./evidence/W71_FILE_OPEN_SAFETY.json)

执行门禁：[`w71-file-open-safety.mjs`](../../tests/e2e/w71-file-open-safety.mjs)

合同门禁：[`w71-file-open-safety.test.mjs`](../../tests/contract/w71-file-open-safety.test.mjs)

全量测试：`150/150` 文件通过。

### 3.1 当前源码的安装态回归

提交 `9c3811f` 对应源码已重新生成 Windows 正式 specimen，并通过 schema v5 安装门禁：

| 项目 | 当前结果 |
|---|---|
| NSIS installer | `141,035,270` bytes |
| installer SHA-256 | `262D17B5D77CCA65C27110B3CF51CCE4C1736686CC72DF69A4D66F9250D1B030` |
| win-unpacked | `597,463,879` bytes |
| app.asar | `290,160,579` bytes |
| packaged source map | `0` |
| unpacked native | `10` files / `2,625,024` bytes |
| ffmpeg 分发材料 | `5/5` 入包且有 SHA-256 |
| 安装态生命周期 | `20` 轮，ResourceLedger `2→2` |
| Agent Adapter / Session | `0 / 0`，没有冒充 W66 已完成 |
| 卸载残留 | `0`；隔离临时目录受控清理成功 |

同一轮还通过 clean install、同版本 reinstall、五类系统入口、协议/注册命令分发、UserChoice 不改写、正常退出与 silent uninstall。构建日志明确记录没有代码签名证书，因此签名被跳过；这一事实保留为条件 Gate，不表述成已签名发布物。

机器证据：[`W71_RELEASE_BASELINE.json`](./evidence/W71_RELEASE_BASELINE.json)、schema v5 [`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json)。

## 4. 封板边界与完整主义预留

本轮关闭的是代表性 RC Hard Gate，不把以下完整主义矩阵塞回 W71：

- 所有历史编码、所有 MIME 与所有第三方损坏语料的穷举识别；
- 由插件动态注册任意格式识别器与转换器；
- 所有磁盘耗尽、ACL、杀毒占用、网络盘和超长路径交叉组合；
- 每种格式 × 外部修改 × 多窗口 × 崩溃恢复的全组合矩阵；
- 统一 Asset Loader / Migration / Entitlement 架构。

这些保留到 Post-W71 完整主义扩展；若发现正式 RC 的 P0/P1 实例，再把对应缺陷按证据升级回来。

## 5. 下一推荐检查点

继续封板顺序：

1. ~~以当前源码重建最终 specimen 并复验安装/覆盖/五入口/卸载~~：已完成；
2. 依 [`W71_RC_CLOSURE_LEDGER_2026-08-16.md`](./W71_RC_CLOSURE_LEDGER_2026-08-16.md) 收口仍可在本机确定验证的产品与发布 Gate；
3. 把需要额外设备、证书、第三方账号或异机环境的项目维持为条件 Gate / Known Limitations；
4. 完成 RC 汇总回归后才选择 W71 之后的新功能波。
