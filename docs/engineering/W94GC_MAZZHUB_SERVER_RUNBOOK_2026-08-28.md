# W94Gc MazzHub 服务器运行门检查点（2026-08-28）

> 状态：**PASS_WITH_SCOPE（staging 已部署，production gates 未闭合）**
> 施工参照：[`W94G_WORLD_HUB_PUBLIC_PLANE_SPEC.md`](./W94G_WORLD_HUB_PUBLIC_PLANE_SPEC.md)
> 基线证据：[`W94GC_SERVER_BASELINE.json`](./evidence/W94GC_SERVER_BASELINE.json) · [`W94GC_SERVER_STAGING.json`](./evidence/W94GC_SERVER_STAGING.json) · [`W94GC_SERVER_RECOVERY.json`](./evidence/W94GC_SERVER_RECOVERY.json)

## 1. 已核验事实

本次只读探针使用与维护者提供的 `167.160.161.115:22` 同指纹密钥完成 SSH 登录。维护者消息中的
`proxy-runbook/167.160.161.115-root/id_ed25519` 在本机已经归档/撤销；没有复用撤销目录，改用同一
公钥指纹、状态为 `BOUND` 的 active key 完成探针。未读取或记录任何私钥内容。

基线时服务器返回 Ubuntu/Linux `6.8.0-31-generic`，root 登录；公开监听仅有 SSH 22，nginx 未安装，
根盘约 133G 可用。随后已按授权安装 Node.js 18、nginx、certbot，创建 `mazzhub`，启用 systemd
origin 与 UFW（22/80/443）。`www.mazz-hub.com` 已切换到 HTTPS，health/snapshot 为 200；根域
当前没有可用 A/AAAA 记录，因此证书只覆盖 `www`。

## 2. W94Gc Gate 结果

| Gate | 结果 | 事实 |
| --- | --- | --- |
| 非 root 部署用户、最小权限 | **PASS_WITH_SCOPE** | `mazzhub` + systemd hardening；生产/演练账号治理仍需补强 |
| 80/443、反向代理、TLS chain | **PASS_WITH_SCOPE** | nginx HTTPS + Cloudflare 200；仅 `www` 证书，apex 无记录 |
| apex/`www` DNS 与 health endpoint | **PASS_WITH_SCOPE** | `www` health 200；apex DNS 缺失 |
| publication projection / receipt 备份恢复 | **PASS_WITH_SCOPE** | 独立 localhost drill 恢复后 digest 不变；生产轮换/回滚未闭合 |
| secrets / 日志 / manifest 隔离 | **PASS_WITH_SCOPE** | origin 不接收 Workspace/私钥/草稿；正式日志审计与轮转待补 |
| 证书续期、回滚、缓存失效、incident drill | **PARTIAL** | certbot timer 已安装；完整生产演练/告警/缓存失效未完成 |
| 本地继续工作、fake Hub | **PASS_WITH_SCOPE** | W94Gb fake Hub 已通过，网络调用为 0 |

## 3. 受控解锁顺序（生产仍待人类授权）

1. 补齐 apex DNS（或明确产品只支持 `www`）及证书覆盖策略；
2. 补 production/staging 账号、密钥轮换、日志轮转、资源告警和保留策略；
3. 在 staging 完成撤回、重同步、损坏、回滚、缓存失效和进程重启的可审计演练；
4. 用真实非对称签名替换当前测试 digest reference，并建立验证/撤销链；
5. 人类再次确认后，才允许 production public-effect grant；任何未授权状态维持 `MAZZ_HUB_PUBLIC_EFFECT=0`。

本次已执行 apt 安装、账号创建、端口开放、证书申请、systemd/nginx 写入和 staging 运行；没有修改 DNS，
没有开启公网 publication effect，也没有把私钥或本地 Workspace 上传到服务器。
