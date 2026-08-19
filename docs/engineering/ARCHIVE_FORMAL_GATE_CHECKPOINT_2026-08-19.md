# Archive Formal Gate 检查点 — 2026-08-19

## 完成

- 路径逐段校验：拒绝绝对路径、drive/UNC、`..`、ADS、NUL、非法字符和超长路径。
- 20,000 条目、512 MiB 单件/压缩包、2 GiB 总量、500× 压缩比与目标磁盘余量预算。
- ZIP symlink 预检；7za 先 list/预算，解压后 lstat 树复核，拒绝 symlink 与越界结果。
- 所有格式先写同盘 `.partial` staging；审计通过才提交，既有文件不覆盖，失败/取消/ENOSPC 清理暂存。
- 打包拒绝 symlink 和超预算输入，写临时文件后原子 rename。
- 作业进入 Resource Ledger；应用退出取消子进程、清暂存、释放作业账。
- 产品成熟度由 Preview 升为 Formal，面板标题去掉 Preview。

## 验证

- `npm run build`：PASS。
- `archive-formal-gate`：4/4 PASS。
- `hotfix-w58b`：4/4 PASS。
- `w71-product-maturity`：5/5 PASS；归档内容本身的“预览”与能力成熟度 Preview 已分开断言。
- 新合同已登记 `tests/run.js`；未执行真实 RAR/7z 损坏包、磁盘耗尽注入或 packaged 长路径 E2E。

## 条件 Gate

非 ZIP 格式的真实恶意样本、杀软占用、磁盘硬耗尽和 Windows 长路径仍须 packaged fixture；现有代码对这些失败均 fail closed 并清理 staging，但不把合同覆盖冒充真机证据。
