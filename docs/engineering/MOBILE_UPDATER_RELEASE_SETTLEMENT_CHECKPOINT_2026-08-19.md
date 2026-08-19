# Mobile / Updater / Windows 发布条件门检查点（2026-08-19）

## 结论

Mobile 与 Updater 已从模糊 `PARTIAL` 收束为可判定的 `HIDDEN / CONDITIONAL`，Windows unsigned internal specimen 的构建、内容、原生 ABI、20 轮生命周期、隔离安装/覆盖安装/卸载门均通过。本检查点不把平台工具链、代码签名、发布服务或商店账号冒充本地已经完成。

## Mobile

1. `mobile:prepare` 只复制移动同步壳所需静态资源，不再把桌面 ffmpeg vendor 误带入移动分发边界。
2. 移除不存在的 `mazz-tcp-server` native 依赖；Mobile 继续是局域网同步客户端，不声称在 Android/iOS 上托管桌面 TCP/mDNS 服务。
3. Android/iOS 均完成 Capacitor 项目创建和 sync；Android 本机止于缺少 `JAVA_HOME/JDK`，iOS 在 Windows 上止于 CocoaPods/Xcode 条件。两端均保持 Hidden，待独立平台构建、签名、真设备和商店 Gate 后再晋级。

## Updater

1. endpoint 只接受无凭据、无 fragment、最长 2,048 字符的 HTTPS URL；保存时 fail closed。
2. 更新说明和文件列表均有硬上限；自动安装保持关闭。
3. 产品成熟度登记为 `HIDDEN / CONDITIONAL_RELEASE_INFRASTRUCTURE`，直到 HTTPS manifest、签名、证书轮换、失败回滚和真实升级矩阵闭合。

## Windows 发布实证

- 安装包：`release/Mazz Editor Setup 0.2.0.exe`
- 大小：133,936,848 bytes
- SHA-256：`64EF1455CB899F65E072C16DE497B1CFB6C3375027020409002550DFA9951CE0`
- `app.asar`：259,390,017 bytes / 9,556 entries；source map `0`，PDB `0`
- 原生二进制：37 个 `.node` 文件纳入发布审计
- OSS provenance：`PASS_REPOSITORY_PROVENANCE_BASELINE / CURRENT`
- 打包态烟测：20 轮 PTY、PanelWindow、WebContentsView、Torrent、Python、Viewer、Factory、Monaco 生命周期均回到 `browser-window + file-watcher = 2` 的稳定长期基线
- 隔离安装：首次静默安装、同版本覆盖安装、协议和文件关联冷启动、打包态烟测、静默卸载均 exit `0`；可执行文件、卸载注册、快捷方式和产品注册表残留为 `0`

打包烟测同时修正了一个测试基线竞态：Agreement 面板关闭与 workspace watcher 装配是异步的，旧测试可能在长期资源尚未稳定时采样。新门必须先精确等到主窗与 watcher 两个长期资源，再开始短生命周期循环；错误信息保留末次完整账本用于定位。

## 验证

- `npm run dist`
- `npm run audit:provenance`
- `npm run audit:release`
- `node tests/e2e/w71-packaged-smoke.mjs`
- `npm run test:w71:installer`
- Mobile：`npm run prepare`、`npx cap add android`、`npx cap sync android`、`npx cap add ios`、`npx cap sync ios`
- 合同：Mobile/Updater `3/3`、Product Maturity `5/5`、Release Policy `3/3`、Lifecycle/Security `10/10`、Web Sync `10/10`、WS Host `2/2`

## 条件边界

- 安装包未签名，只是 unsigned internal specimen，不能作为公发 RC。
- 未执行 Android JDK/Gradle APK/AAB 构建、iOS Xcode/CocoaPods 构建、真设备、商店与移动后台生命周期矩阵。
- 未部署真实 updater feed，也未执行旧版→新版/坏 manifest/断网/证书轮换/签名校验矩阵。
- 外平台 native staging 没有候选时明确拒绝空跑；该结果不冒充跨平台 ABI 已验证。
