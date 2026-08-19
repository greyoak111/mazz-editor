# Recorder / Plugins Preview Settlement — 2026-08-19

## 结论

两项按总表既定决议完成 `PREVIEW_SETTLED`，不以删掉“预览”字样伪造 Formal。

### Recorder

- 修复麦克风 `getUserMedia()` 流未由 owner 停止的真实泄漏；节点断开、轨道停止、AudioContext 关闭均幂等。
- 捕获权限等待 60 秒超时；迟到才返回的采集流立即停轨，不成为幽灵设备占用。
- Recorder 重复停止只执行一次；画布健康探针、watchdog、2 小时和 1 GiB 上限 timer 随停止释放。
- 启动中任何音频/编码失败都会释放已经取得的屏幕、系统音和麦克风资源。
- UI 明示 WebM、2 小时/1 GiB 与设备、全屏、RDP、虚拟显示边界。

### Plugins

- 已有新装默认隔离、整包 SHA-256 授权、审查后替换拒绝、内容变化撤权、大小/入口/manifest 校验继续成立。
- 产品元数据与面板明确 `trusted-renderer-code`：`permissions` 目前是审查声明，不是进程级 enforcement。
- 在 W84 inspect-only / Profile / Trust 迁移前，不扩大权限、不宣称签名发布者链、不扶正 Formal。

## 验证

- `npm run build`：PASS。
- `recorder-preview-gate`：3/3 PASS。
- `hotfix-w56`：4/4 PASS。
- `w71-plugin-trust`：3/3 PASS。
- `w71-product-maturity`：5/5 PASS。

## 条件 Gate

Recorder 的真实摄像头/麦克风/系统音拒绝矩阵、最小化、全屏、RDP/虚拟显示、2 小时真实录制与磁盘耗尽仍需要对应硬件和真机。Plugins 的进程级沙箱、签名与发布者身份不在 Legacy runtime 偷补，将由 W84/W69 Publication 的独立边界决定。
