# Mobile / Updater 条件门结算（2026-08-19）

## 唯一产品结论

| 能力 | 状态 | 本机已证明 | 仍需外部条件 |
|---|---|---|---|
| Mobile | `HIDDEN / CONDITIONAL_PLATFORM_BUILD` | 共用渲染层构建；Capacitor Android/iOS 工程生成与同步；客户端存储/同步合同 | JDK 17 + Android SDK 的 APK 编译、Android 真机；macOS/Xcode/CocoaPods、签名与 iOS 真机；商店审核 |
| Updater | `HIDDEN / CONDITIONAL_RELEASE_INFRASTRUCTURE` | HTTPS-only manifest check、1 MiB 上限、地址配置当场拒绝 HTTP/凭据/fragment、有限 notes/files | 真实旧/新签名 specimen、可信发布 endpoint、下载/安装/失败恢复/回滚和证书 |

二者都不再记作“入口像正式能力但只有 35–45%”的模糊 PARTIAL：实现与开发材料保留，正式产品入口继续 Hidden，只有各自 Activation Gate 全过才允许提升承诺。

## Mobile 修正

- CI 在 `cap add` 前先执行 `npm run prepare`，避免空 `www/`。
- `mobile/prepare.mjs` 不再把已被发行政策禁用的 ffmpeg vendor 目录复制进移动壳。
- 移除没有 Android/iOS 原生实现的 `mazz-tcp-server` 包依赖；移动端只承诺作为桌面主机的同步客户端，不把 JS fixture 冒充原生 TCP 插件。
- 当前 Windows 主机实跑：`npm install --no-package-lock` PASS；`npm run prepare` PASS；`cap add/sync android` PASS；`cap add/sync ios` PASS。
- `gradlew assembleDebug` 在任何编译副作用前明确失败：本机没有 `JAVA_HOME`/Java。iOS 同步明确报告无 CocoaPods/xcodebuild。这两项形成可判定条件门，不伪造 APK/IPA。

## Updater 修正

- 仍只作为 manifest 检查 Foundation，不提供自动安装。
- 保存配置时立即执行 HTTPS、无 URL credential、无 fragment、2048 字符上限，而不是等下次检查才失败。
- `update:getConfig` 明示 `maturity=hidden`、`supportsAutomaticInstall=false` 与条件门。
- 对服务端 notes 截到 50,000 字符、files/assets 截到 20 项；现有响应体 1 MiB 上限和 TLS 证书校验继续有效。

## 验证

- `npm run build`
- `mobile-updater-release-settlement`：3/3
- `w71-product-maturity`：5/5
- `w71-release-policy`：3/3
- `w71-lifecycle-security`：10/10
- `web-sync`：10/10
- `ws-host`：2/2（协议/注入式 transport fixture，不冒充原生插件）

当前结算没有安装依赖到仓库根、没有提交 `mobile/node_modules`/生成的 Android/iOS 工程或 package-lock，也没有改动用户工作区。
