# W84 `.maz` Production Asset 本地收口检查点（2026-08-19）

## 结论

W84a–f 的本地标准与安全运行边界已经落地，状态为 `LOCAL STANDARD COMPLETE / PUBLIC DISTRIBUTION EXCLUDED`。现有 plugin `.maz` 与 Factory style `.maz` 继续作为两种 legacy profile，不被假装成同一个 v1；新容器仍标记 `0.1-local`，未抢发公共标准。

## W84a–e

1. inspect-only reader 在不执行代码的前提下识别 legacy plugin、legacy style 和新 Production Asset；多 discriminator 冲突显式阻断。
2. Public Envelope 包含 semantic identity/version/profile/dependency/permission/provenance/rights；`package.index` 对每个 block 记 bytes/SHA-256/encrypted/executable。
3. 拒绝路径穿越、absolute/drive/UNC、ADS、大小写重复项、symlink、条目/单件/总量/压缩比越界与损坏 CRC。
4. template/workflow/organization/world Definition profiles 默认不可执行；Runtime Instance、secret、Publication 权力不进包。
5. legacy style 迁移先给 diff/文件预览，写新文件而不覆盖原包；legacy plugin 保持原隔离信任链，不因新格式自动授权。
6. copy/rename 保持 semantic identity；Fork 必须新 identity；Ed25519 signature 只证明签名范围，对篡改 fail closed，不冒充安全、Canon 或 Authority。

## W84f

- Public Envelope 与 AES-256-GCM encrypted blocks 分离；RSA-OAEP-SHA256 Key Envelope 可按 recipient 轮换，不重写 ciphertext。
- License、Entitlement、Encryption、Runtime Permission 四层分权；获得密钥/明文不等于获得执行权。
- entitlement 对 subject/block/time/status 生效；撤销、过期、缺 envelope 与未授权 block 都 fail closed。
- sealed capability 公开 contract/location/input/output，内部实现保持不可见；只有独立 Runtime Permission Gate 通过才可调用，并生成 evidence digest。
- 质量资产只导出带 metric-definition version/sample size 的聚合，不携原始 W73 Production Ledger、Prompt 或私人 Run。

## 产品接线与验证

- “组织编译台”新增“检查 .maz”，用户选包后展示 profile、legacy、新容器、大小、条目、package digest 和 blockers；固定 `codeExecuted=false`。
- `mazAsset:inspect` 与 `mazAsset:migrateStyle` 由主进程处理，迁移需要 `human:*` Authority，目标存在时拒绝覆盖。
- `npm run build`：PASS
- W84 合同：11/11 PASS
- legacy plugin 邻接安全：3/3 PASS
- W82/W84 联合定向：22/22 PASS

## 外部边界

- 没有 W69m Marketplace、HTTP/P2P 公共分发、账号、支付或远程 Entitlement 服务；Sample J 的本地 crypto/rights/permission 段通过，公共分发段按网站排除。
- 没有宣称 DRM 不可破解，也没有将本地私钥写入包。
- 没有扩大插件执行权限；插件仍是 `trusted-renderer-code` Preview，并沿精确 SHA-256 授权。
