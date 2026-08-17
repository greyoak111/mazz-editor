# W71 C4 严格独立证据检查点

> 日期：2026-08-17
>
> 结论：**COMPLETE / 3 OF 3 CONSECUTIVE PASS**
>
> 最终批次：`20260817T012752968Z-e991dc`
>
> 产品源码冻结点：`main@e753dd0`
>
> 执行时仓库 HEAD：`main@0560d7a`

## 1. 为什么补做

2026-08-16 的 C4 三轮实际运行已经通过，但只保留了一份人工汇总清单，没有为三轮分别保存命令输出哈希、派生证据哈希和单轮 manifest。按 C4 原始退出条件，这属于“运行做过、独立证据包装未闭”，不能直接据此启动下一波次。

本检查点补齐的不是产品功能，而是可复核性：同一冻结 specimen 必须重新执行三轮；每轮独立保存命令结果、证据文件、截图和产物前后哈希；最后再逐文件复算并聚合。

## 2. 证据协议

可复跑命令：

```powershell
node scripts/w71-rc-evidence-run.js all
```

每轮依次执行九条门禁：

1. `node tests/run.js`；
2. packaged 产品入口成熟度；
3. packaged 正式主路径；
4. FFmpeg 不分发与禁用边界；
5. 原生媒体运行边界；
6. packaged 20 次资源生命周期；
7. silent install / repair / cold start / installed runtime / uninstall；
8. release audit；
9. current-tree secret audit。

运行器只保存标准输出和标准错误的字节数与 SHA-256，不保存完整正文；七份 JSON 与四张 UI 截图则逐文件保存大小和 SHA-256。每个执行批次、每一轮都有独立目录，避免 Windows 扫描器或预览器占用固定证据文件时产生覆盖竞争。

## 3. 最终三轮

| 轮次 | 时间（UTC） | 全量测试 | 命令 | 派生证据 | 单轮 manifest SHA-256 |
|---|---|---:|---:|---:|---|
| 1 | `01:27:53–01:31:15` | `153/153` | `9/9 PASS` | `11/11` | `BF74D837F7D8A9C0A356F86C04DBB717AD0FCCCC0C9823FF7625C631269A4162` |
| 2 | `01:31:15–01:34:38` | `153/153` | `9/9 PASS` | `11/11` | `752FD0F23B2C35CDEC657A1F7C662A98968B1CCA15E3C413E36C75CAD1C76D98` |
| 3 | `01:34:38–01:38:02` | `153/153` | `9/9 PASS` | `11/11` | `D3591ED180361218468D831358CBA4CBEBCE5A81FAF0D9924785239960247CF4` |

权威聚合清单：[`W71_RC_THREE_RUN_MANIFEST.json`](./evidence/W71_RC_THREE_RUN_MANIFEST.json)。

三个单轮清单：

- [`W71_RC_RUN_1.json`](./evidence/w71-rc/20260817T012752968Z-e991dc/run-1/W71_RC_RUN_1.json)
- [`W71_RC_RUN_2.json`](./evidence/w71-rc/20260817T012752968Z-e991dc/run-2/W71_RC_RUN_2.json)
- [`W71_RC_RUN_3.json`](./evidence/w71-rc/20260817T012752968Z-e991dc/run-3/W71_RC_RUN_3.json)

最终批次共保留 37 个文件、约 2.0 MiB：三个单轮 manifest、每轮七份 JSON、每轮四张截图，以及一份批次聚合清单。

## 4. 冻结产物不变量

三轮执行前后均一致：

| 产物 | bytes | SHA-256 |
|---|---:|---|
| `release/Mazz Editor Setup 0.2.0.exe` | `133,676,213` | `69940814475FCF2C294EB280BC1A6AFF2755DFB2F28DDCCCA422BBA3D41A41FA` |
| `release/win-unpacked/resources/app.asar` | `257,845,274` | `35961F6770A469DA0E2216BACDC7CC8EB588B93E5F10FD79C7AF63C363F312CC` |

聚合校验还确认：每轮九条命令全为 PASS、每轮十一份证据声明门禁通过且当前文件哈希与单轮记录相同、三个单轮 manifest 自身哈希可复算。

## 5. 过程中发现并处理的自动化问题

### 5.1 固定证据文件覆盖竞争

早期草稿轮次曾在覆盖固定 PNG/JSON 时遇到 Windows `UNKNOWN open`。断言在失败前或之前均通过，根因是证据输出文件被短暂占用，而不是产品入口或正式主路径回归。

处理：证据输出改为 `batch/run` 独立目录；单轮 manifest 只在结束时写一次；失败草稿不进入最终聚合。13 个顶层失败/过渡草稿已删除，它们只是不再引用的生成物，可由测试重新生成。

### 5.2 一次安装器进程瞬态访问冲突

一次非最终草稿批次的首次 silent install 以 `3221225477 / 0xC0000005` 退出。预检和事后检查均未发现注册表、快捷方式、安装目录、Mazz/Electron 进程或 WER 残留；紧接着对同一 installer 的隔离完整复跑通过。

该失败没有被重试逻辑吞掉，也没有计入三轮通过。最终计数从头开始，随后取得三轮连续完整 PASS。现有证据不足以把这一次事件归因到 Mazz 产品运行时或既往 Electron 弹窗问题；它作为签名版、异机与公开发行前的观察项保留，但不构成当前 unsigned internal RC 的已知可复现 P0/P1。

## 6. 最终判定

C4 现在满足原始退出条件中的“三次独立 packaged/release manifest”，不再只是汇总表。W71 推荐封板状态维持 `SEAL / COMPLETE`；此检查点不扩大 W71，也不把 Post-W71 完整主义欠账删除。

只有在本文件、三个单轮 manifest、权威聚合清单和冻结产物哈希同时成立时，下一波次才允许进入施工。
