# OCR / Vision Formal Gate 检查点 — 2026-08-19

## 已闭合

- 本地 OCR 改为单作业 worker runtime；32 MiB 输入上限、180 秒硬超时、显式取消和对话框关闭收尸。
- worker 在成功、失败、取消、超时四路都执行 `terminate()`，不保留后台识别任务。
- 首次语言模型成功后登记本地缓存就绪状态，后续明确提示可离线复用；首次下载失败给出联网重试路径。
- AI Vision 复用 Factory request owner，新增 AbortSignal；用户取消会调用 `factory:aiCancel`，不只是在 UI 丢弃结果。
- 产品成熟度、命令面板、工具坞和帮助由 Preview 晋升 Formal。

## 验证

- `npm run build`：PASS。
- `ocr-formal-gate`：3/3 PASS（成功、取消、超时、空输入、资源释放）。
- `w71-product-maturity`：5/5 PASS。
- 真实 `tesseract.js@7` 对仓库 UI PNG 完成 99% 进度，输出 1,043 个字符，worker 正常退出；英文模型首次下载耗时约 11.5 秒。

## 边界

真实样本证明引擎与下载链可运行，不代表中文、日文、韩文或手写体准确率达到统一阈值。识别结果始终可编辑；低置信度不自动写入资产或取得 Evidence Authority。packaged 首次下载、断网缓存复用和多语言语料准确率继续作为发布验收矩阵，不回退产品代码门。
