# Mazz Editor 移动端（Android / iOS）

把 Mazz Editor 的渲染层打包进 Capacitor WebView，配上 Web 桥与移动端自适应层，编译成 Android / iOS 应用。**桌面版（Electron）功能不受影响**，两套壳共用同一份渲染层代码。

## 形态适配

| 形态 | 断点 | 行为 |
| --- | --- | --- |
| 手机 | <600dp | 侧栏变 ☰ 抽屉、Ribbon 紧凑可横滑、欢迎页单列、触控目标 ≥40dp |
| 平板 | 600–839dp | 侧栏收窄 190dp，布局不变 |
| 桌面宽度 | ≥840dp | 与桌面版一致 |
| 折叠屏展开/双屏 | `visualViewport.segments` 或 `horizontal-viewport-segments: 2` | 左屏整栏给文件树/导航，右屏编辑区，内容避开铰链 |

另有：刘海/手势条安全区（`env(safe-area-inset-*)`）、旋转/折叠展开时自动重排、窗格分隔条与 Ribbon 调高把手的触控拖拽（Pointer Events）。

## 编译步骤

环境：Node.js ≥ 20 · JDK 17 · Android Studio（含 Android SDK）。

```bash
# 1. 安装依赖（仓库根目录一次，mobile/ 目录一次）
npm install
cd mobile
npm install

# 2. 首次：生成 Android 工程（只跑一次）
npx cap add android

# 3. 构建渲染层并同步进 Android 工程
npm run sync

# 4. 编译 APK（二选一）
npm run apk        # macOS/Linux
npm run apk:win    # Windows(CMD/PowerShell)
# 或者：npm run open 用 Android Studio 打开后点 Run
```

产物：`mobile/android/app/build/outputs/apk/debug/app-debug.apk`（ debug 包，可直接装机）。发布包在 Android Studio 里 `Build > Generate Signed App Bundle / APK`。

真机调试：手机开 USB 调试，`npm run open` 后点 Run；WebView 内容用 Chrome 的 `chrome://inspect` 调试。

## 编译 iOS 版

**iOS 必须有 macOS 环境**（苹果硬性限制，Windows 无法直接编译）。两条路：

### 路线 A：有 Mac（推荐）

环境：Xcode 15+ · CocoaPods（`sudo gem install cocoapods`）· Node.js ≥ 20。

```bash
cd mobile
npm install
npx cap add ios        # 首次
npm run sync:ios       # 构建渲染层 + 同步（自动补 Info.plist 局域网权限键）
npm run open:ios       # Xcode 打开，选你的设备/模拟器点 Run
```

真机运行：Xcode 里 Signing 选你的 Apple ID（免费账号可签，7 天有效；$99 开发者账号 1 年）。首次打开「局域网同步」时系统会弹「允许访问本地网络」，允许即可。

### 路线 B：只有 Windows（云编译 + 本地签名）

仓库带 GitHub Actions 流水线（`.github/workflows/build-mobile.yml`），公开仓库免费：

1. 推送代码后，GitHub 网页 → **Actions → Build Mobile → Run workflow**；
2. 等跑完，下载产物 `mazz-ios-unsigned-ipa`（未签名 IPA）和 `mazz-android-debug-apk`；
3. Windows 上用 [Sideloadly](https://sideloadly.io/) 或 AltStore 签名安装：拖入 IPA，填你的 Apple ID（免费账号签名 7 天有效，到期重签；$99 账号 1 年）。

> 模拟器调试也可以：CI 产物在 macOS 上解压 `.app` 拖进模拟器（未签名包仅支持模拟器或越狱机直接装）。

### iOS 注意事项

- **本地网络权限**：iOS 14+ 连局域网设备需用户授权，prepare 脚本已自动写入 `NSLocalNetworkUsageDescription`；
- **加密合规**：已自动写入 `ITSAppUsesNonExemptEncryption=false`（仅用系统标准加密算法，App Store 上架免出口合规申报）；
- **页面协议**：iOS 的 WKWebView 强制自定义协议（`capacitor://`），无法像 Android 用 http——ws:// 局域网连接在 iOS 17 上社区验证可用；
- **WebCrypto**：若旧系统上 `crypto.subtle` 不可用（非安全上下文），同步会明确报错而不是静默失败；
- 调试：Mac 上 Safari → 开发菜单 → 你的设备 → 选 WebView 页面。

## 功能矩阵（移动端现状）

**完整可用**：文档 / 表格 / 演示 / 思维导图 / 画板 / 书库（含大文件 epub/cbz）/ 笔记库 / 全局搜索 / 纯文本 · **局域网同步（见下）** · 主题 / i18n / 帮助中心 · 打开设备文件 · 打印（系统打印）。

**工作区存储**：走 `@capacitor/filesystem` 真·文件系统（应用私有目录，**无容量上限、无需权限弹窗**）；纯浏览器预览才退回 localStorage（约 5MB）。

**局域网同步（移动端 ↔ 桌面端）**：
- 桌面端「发起共享」后同时开两条通道：桌面↔桌面走原 TLS（端口 P），手机/平板走 WebSocket（端口 P+1，主机对话框里会显示）；
- 移动端「局域网同步：加入」填电脑局域网 IP + 移动端端口 + 配对码即可；
- 加密不降格：配对码经 PBKDF2（10 万次）派生 AES-GCM-256 会话密钥，密钥即身份——口令错误首帧校验即断开，配对码永不明文上传；同步协议（增量/冲突保留副本/基线）与桌面完全同源；
- 发现方式：v1 手动填 IP（桌面主机对话框显示端口）；mDNS 手机端后续可经 UDP 插件补上。

**受限可用**：
- 隐私浏览器搜索：受 CORS 限制，需要允许跨域的 SearXNG 实例（自部署时开 CORS 头即可）；
- 翻译 / OCR：走在线服务（MyMemory / tessdata CDN），需联网；
- 保存「另存为」：写入工作区后需用系统分享/下载导出。

**不可用（架构性，桌面独占）**：集成终端（node-pty）· Python 内核与调试器 · 全局快捷键 / 系统托盘 · 密码管理器（OS 级加密）· 开机自启/文件关联 · 移动端当同步主机（手机端请连电脑发起的共享）。对应入口已安全降级（提示「仅桌面版可用」），不会崩。

## 已知限制

- Android 5.x 及以下老系统 WebView 过旧，建议 minSdkVersion 24+（Capacitor 6 默认）。
- 折叠屏双屏识别依赖 Chromium 的 Viewport Segments API：Surface Duo 原生支持；三星/华为折叠屏在较新系统 WebView 上支持，不支持时自动退化为平板布局，不会出错。
- 移动端同步通道为 AES-GCM 应用层加密（配对码派生密钥），与桌面间 TLS 不同构但同安全目标；两台手机互传需其中一端用桌面版中转。

## 目录

```
mobile/
  capacitor.config.json   Capacitor 配置（appId com.mazz.editor）
  prepare.mjs             构建渲染层 → 组装 www/
  www/                    （生成物，勿手改）
  android/                （cap add 生成，Android Studio 工程）
```

渲染层侧的移动适配代码：`renderer/lib/mobile-env.js`（形态探测 + 抽屉按钮）、`renderer/styles/mobile.css`（全部自适应样式）、`renderer/lib/browser-bridge.js`（Web 桥 + 双后端存储 + 移动端降级桩）、`renderer/lib/sync-web.js`（移动端局域网同步客户端）。桌面侧改动：`main/lansync.js` 增加 WebSocket 加密通道（零依赖 RFC6455 实现）。
