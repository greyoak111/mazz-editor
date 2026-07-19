# Mazz Editor

**一站式超级编辑器 · 榨干 Electron 的全模块工作台**
**The all-in-one super editor · a full-module workbench that squeezes every drop out of Electron**

文档 · 表格 · 演示 · 编程 · 隐私浏览 · 双链笔记 · 导图 · 画板 · 书库 —— 一个窗口，全部互通。
Documents, spreadsheets, slides, code, private browsing, wiki-linked notes, mind maps, sketching, and an e-book library — one window, fully interconnected.

![版本](https://img.shields.io/badge/版本-v0.1.0-c8211b) ![平台](https://img.shields.io/badge/平台-Windows%20%7C%20macOS%20%7C%20Linux-1a1a1a) ![语言](https://img.shields.io/badge/界面语言-8%20种-4f46e5) ![内核](https://img.shields.io/badge/内核-Electron%2033-f0e6d2)

---

## 界面预览 · Screenshots

| 默认「纸白」主题 · Paper theme | 「构成」主题（苏式构成主义）· Construct theme |
| --- | --- |
|<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/950f0900-759d-4db6-a49c-d5e25856be98" />|<img width="1922" height="1080" alt="image" src="https://github.com/user-attachments/assets/f03b3cc3-d18c-47c4-9b5d-f8737e62e13d" />|


> 还有 5 套内置主题 + **图片取色自定义主题**：上传一张图片，自动提取颜色按构成主义原则生成专属配色；色彩不足会被要求换图。
> Five more built-in themes plus an **image-palette theme engine**: upload any picture and it extracts colors into a Constructivist-balanced theme; images too dull are politely rejected.

---

## 核心理念 · Philosophy

**1. 一切操作皆命令 · Everything is a command**
`Ctrl+Shift+P` 唤起命令面板——260+ 条命令覆盖软件全部能力，所有按钮、菜单、快捷键都只是命令的呈现层。忘记功能在哪？搜它。
Every one of the 260+ capabilities is a registered command. Buttons, menus and shortcuts are mere projections of the command registry. Forgot where something lives? Search it.

**2. 本地优先，你的数据永远属于你 · Local-first, your data stays yours**
笔记与书摘是纯 Markdown，书库与插件是普通文件，全部存放在你的工作区文件夹——可读、可搜、可备份、可搬走，没有云端绑架。
Notes and excerpts are plain Markdown; books and plugins are regular files in your workspace folder. Readable, searchable, backable-up, portable. No cloud hostage.

**3. 隐私红线 · Privacy by architecture**
搜索经主进程代理转发（实例与凭据不出主进程），网页浏览做 UA 归一化、跨域 Referer 剥离、追踪域名拦截，密码用操作系统级加密（DPAPI/Keychain/keyring）落盘。
Searches are proxied through the main process (instance credentials never leave it); browsing gets UA normalization, cross-origin Referer stripping and tracker blocking; passwords are sealed with OS-level encryption.

**4. 喂饭级内置帮助 · Help that actually helps**
按 `F1` 打开内置帮助中心：16+ 章手把手指南，全文可搜。功能再多，也不怕找不到、不会用。
Press `F1` for the built-in help center: 16+ chapters of step-by-step guides, fully searchable. No matter how deep the feature set goes, you're never lost.

---

## 功能全景 · Feature Map

| 模块 | 能力要点 |
| --- | --- |
| 📝 文档 | ProseMirror 自建内核 · 即时渲染（中文/全角标记友好）· 字体/字号/颜色/对齐/行距 · 表格/脚注/批注 · docx/PDF 双向 · Word 样式映射表 |
| 📊 表格 | 10 万行虚拟网格 · 自研公式引擎 100+ 函数（Excel 语义对齐）· 冻结/合并/填充柄/排序筛选/条件格式 · 透视 · 图表 · xlsx 零丢失互转 · Excel 互粘 |
| 📽 演示 | 大纲成稿（#/##/-/---）· 主题×5 · 画布编辑 · 放映与演讲者视图 · 导出 pptx |
| 💻 编程 | Monaco + TS 智能 · node-pty 终端 · DAP 调试（断点/单步/变量/监视）· 运行文件/选区 |
| 🌐 隐私浏览器 | SearXNG 主进程代理 · 多标签 · 收藏文件夹分类 · 密码管理器（自动填充）· 主页主题/自定义主页 · 网页缩放 |
| 📓 笔记库 | [[双链]]（点击打开/自动创建）· 反向链接 · 关系图谱 · 每日笔记 · 自动落盘 |
| 🔎 全局搜索 | IndexedDB 全文索引 · 正则/类型过滤 · 命中直达 |
| 🧠 思维导图 | SVG 水平树 · Tab/Enter 快建 · 拖拽重排 · PNG/Markdown 大纲互转 |
| 🎨 画板 | Perfect Freehand 压感矢量笔 · 图层 · 帧与洋葱皮 · PNG 序列 |
| 📚 书库 | epub/cbz 阅读器 · 书架/进度记忆 · 摘录书摘 · epub→Markdown |
| 🧮 工具集 | Python+JS REPL · 翻译（MyMemory/LibreTranslate）· OCR 图片识字 · 语音输入 |
| 🧩 生态 | .maz 插件系统（契约校验 + 示例×2）· 9 种模块桥接 · 局域网同步（mDNS + TLS + 配对码 + 冲突保留） |

**界面语言 8 种**：中文 / English / العربية（RTL 镜像）/ Français / Русский / Español / 日本語 / 한국어。

---

## 下载 · Download

前往 [**Releases**](https://github.com/greyoak111/mazz-editor/releases) 页面下载 · Get packages from the [**Releases**](https://github.com/greyoak111/mazz-editor/releases) page:

| 文件 | 平台 | 适用机型 | 说明 |
| --- | --- | --- | --- |
| `Mazz Editor-win32-x64.zip` | Windows 64 位 | 绝大多数 PC（Intel/AMD） | **推荐**，全功能 |
| `Mazz Editor-win32-arm64.zip` | Windows ARM64 | Surface Pro X / 骁龙本 | 全功能 |
| `Mazz Editor-win32-ia32.zip` | Windows 32 位 | 老旧机器 | 集成终端不可用，其余正常 |
| `Mazz Editor-darwin-arm64.zip` | macOS Apple Silicon | M1/M2/M3/M4 系列 | 全功能；首次打开右键→「打开」绕过 Gatekeeper |
| `Mazz Editor-darwin-x64.zip` | macOS Intel | 老款 Intel Mac | 同上 |
| `Mazz Editor-linux-x64.zip` | Linux 64 位 | Ubuntu / Fedora / Debian 等 | 全功能；解压后 `chmod +x` 运行 |
| `Mazz Editor-linux-arm64.zip` | Linux ARM64 | 树莓派 64 位系统 / ARM 服务器 | 全功能 |
| `Mazz Editor-linux-armv7l.zip` | Linux ARMv7 | 老款 32 位 ARM 设备 | 集成终端不可用，其余正常 |
| `mazz-editor（源码）.zip` | 源码 | 自行构建 / 二次开发 | `npm install && npm run dev` |

全平台绿色免安装：解压即用，无需管理员权限；macOS 解压出 `Mazz Editor.app` 拖入「应用程序」即可，Linux 需 `chmod +x` 后运行。
Portable builds: unzip and run — no admin rights required.

---

## 源码构建 · Build from Source

```bash
git clone https://github.com/greyoak111/mazz-editor.git
cd mazz-editor
npm install        # Electron 下载失败时会自动切换镜像兜底
npm run dev        # 构建渲染层并启动
npm test           # 21 个测试文件：单元/契约/往返/同步/i18n
npm run smoke      # Electron 真机冒烟（IPC 白名单 / 12 模块注册）
```

## 技术架构 · Architecture

```
main/        Electron 主进程：单实例 · IPC 总线（白名单信封）· 托盘 · 打印 · 拼写
             · 崩溃恢复 · SearXNG/翻译/密码/同步/更新 服务
preload/     contextBridge 白名单桥（渲染进程唯一入口）
renderer/
  core/      命令注册表（单一事实源）· 上下文键 · 键位 · 菜单 · 命令面板 · 模块注册表
  shell/     Ribbon · 标签 · 二叉树分屏 · 思源式侧栏 · 主题系统
  modules/   12 个契约模块（统一模块契约 + contributes 声明）
  i18n/      8 语言字典（原文即 key）· RTL
  help/      内置帮助中心
plugins-samples/  示例插件源码（.maz：字数统计 / 番茄钟）
```

**模块契约**：内置模块与第三方插件同权——实现 `create / activate / deactivate / getContent / setContent / newDocument` 六方法 + `contributes` 声明，加载期严格校验（缺方法/命令冲突/非法表达式即拒）。
**Module contract**: built-ins and third-party plugins share the same six-method contract plus a `contributes` declaration, strictly validated at load time.

## 测试与质量 · Quality

- 21 个测试文件全绿（单元 / jsdom 契约 / docx·xlsx·pptx 往返 / 双实例同步 / i18n / UI 主题）
- docx 往返 20 份关键元素 100% 保留 · xlsx 10 份零丢失 · 公式引擎 26 组 Excel 一致性断言
- Electron 真机冒烟 10 项 · 局域网双实例同步 100 文件零丢失

## 许可 · License

本体以 **MIT** 发布。第三方组件：ProseMirror / Monaco / SheetJS / ExcelJS / PptxGenJS / ECharts / jszip / perfect-freehand / Tesseract.js / node-pty / debugpy / node-forge / bonjour-service（MIT/Apache/BSD）。SearXNG（AGPL）为自部署服务、不随包分发。

---

# English

## What is Mazz Editor?

Mazz Editor is an **all-in-one super editor** built on Electron — documents, spreadsheets, presentations, a code IDE with a real debugger, a privacy-hardened browser with a SearXNG core, a wiki-linked note system with a knowledge graph, a full-text search engine, mind maps, a pressure-sensitive vector sketchboard, and an epub/comic library — all living in one window and talking to each other through 9 built-in bridges.

### Why it exists

- **One app instead of ten.** Writing, calculating, presenting, coding, reading and researching shouldn't require ten disconnected tools. Mazz unifies them under a single contract-based module system.
- **Local-first ownership.** Your notes, books and settings are plain files in a workspace folder. No accounts, no cloud lock-in, no telemetry.
- **Privacy is architecture, not a toggle.** Search requests are proxied by the main process so the page and the renderer never see the SearXNG instance or its credentials. Web browsing normalizes your UA, strips cross-origin referers and blocks tracker hosts. Passwords are sealed with the OS keychain.
- **Command-first discoverability.** Every capability is a command (`Ctrl+Shift+P`). The built-in `F1` help center ships 16+ chapters of step-by-step guides — you'll never be left wondering "where was that feature again?"

### Highlights

- **Office-grade trio**: ProseMirror document engine (docx round-trip with native Word comments), a virtual-grid spreadsheet with a 100+ function Excel-compatible formula engine (xlsx lossless both ways), and an outline-to-PPT slide compiler with presenter view.
- **Real developer tools**: Monaco with TypeScript IntelliSense, a node-pty terminal, and DAP debugging (breakpoints, stepping, variables, watch) via debugpy.
- **Knowledge work**: `[[wiki-links]]` that create notes on demand, backlink panels, a force-directed knowledge graph, daily notes, and IndexedDB full-text search with regex.
- **Creation tools**: mind maps with drag-to-rearrange, a Perfect Freehand sketchboard with layers and onion-skin frames, and an epub/cbz reader that exports whole books to Markdown.
- **Extensible**: `.maz` plugins (zip with a manifest) pass the same strict contract validation as built-in modules; two sample plugins included.
- **LAN sync**: mDNS discovery, TLS with self-signed certs and a pairing code, incremental sync, and conflict-safe version preservation.
- **8 UI languages** including full RTL mirroring for Arabic, and 7 themes including a Soviet-Constructivist art direction plus an image-palette theme generator.

### Quick start

Grab an installer from **Releases** (see the table above — x64 for most PCs), or build from source with `npm install && npm run dev`. First-run tip: press `F1` for the interactive guide, and `Ctrl+Shift+P` for everything else.

---

*Made with obsession for every drop of Electron. 榨干 Electron 的每一滴。*
