# Mazz Editor

一站式超级编辑器 —— 榨干 Electron 的全模块工作台。
**文档 · 表格 · 演示 · 编程 · 隐私浏览 · 双链笔记 · 导图 · 画板 · 书库 · 全格式互通**

- 一切操作皆命令：`Ctrl+Shift+P` 唤起命令面板，软件内每个功能都可搜索执行
- 帮助文档内置：按 `F1` 打开喂饭级使用指南（16+ 章，可全文搜索）
- 界面 8 语言：中文 / English / العربية / Français / Русский / Español / 日本語 / 한국어（含 RTL 镜像）

## 快速开始

```bash
npm install
npm run dev      # 构建渲染层并启动 Electron（Electron 下载失败时 postinstall 自动换镜像兜底）
npm test         # 单元 + 契约 + 往返测试（21 个测试文件）
npm run smoke    # Electron 真机冒烟（含 IPC 白名单 / 密码管理器 / 12 模块注册）
```

数据默认存放于 `文档/MazzWorkspace`：笔记与书摘为纯 Markdown，书库/插件各有专目录，全部资料可整体拷贝备份。

## 功能总览（四大阶段全部交付）

| 领域 | 模块 | 能力要点 |
| --- | --- | --- |
| 文档 | markdown / text | ProseMirror 自建内核 · 即时渲染（CJK/全角友好）· 字体字号颜色对齐行距 · 表格/脚注/批注（docx Comments 映射）· 页面设置/分页预览/目录 · docx/PDF 双向 · Word 样式映射表 |
| 表格 | sheet | 虚拟网格（10 万行）· 自研公式引擎 100+ 函数（Excel 语义对齐）· 冻结/合并/填充柄/排序筛选/验证/条件格式 · 透视 · ECharts · xlsx 双向零丢失 · Excel 互粘 |
| 演示 | slide | 大纲成稿（#/##/-/---）· 主题×5 · 画布编辑（文本/形状/图片）· 放映与演讲者视图 · PptxGenJS 导出 |
| 编程 | code | Monaco + TS 智能 · node-pty 终端 · DAP 调试（debugpy 断点/单步/变量/监视）· 运行文件/选区 |
| 浏览器 | browser | SearXNG 主进程代理（源站零暴露）· UA 归一化/Referer 剥离/追踪拦截 · 多标签 · 收藏文件夹分类/历史页面级屏蔽 · 主页主题/自定义主页 · safeStorage 密码管理器 + 自动填充 · 网页缩放/页内查找 |
| 笔记 | notes | [[双链]]（点击打开/自动创建）· 反向链接 · 关系图谱 · 每日笔记 · 1.5s 自动落盘 |
| 搜索 | search | IndexedDB 全文索引 · 正则/类型过滤 · 命中直达 |
| 导图 | mindmap | SVG 水平树 · Tab/Enter 快建 · 拖拽重排（防环）· 撤销重做 · PNG/Markdown 大纲互转 |
| 画板 | draw | Perfect Freehand 压感矢量笔 · 图层 · 参考图 · 帧与洋葱皮 · PNG 序列 |
| 书库 | library | epub/cbz 阅读器（自研解析）· 书架/进度记忆 · 摘录书摘 · epub→Markdown |
| 工具 | math / translate / ocr / voice | Python+JS REPL · calc 算块 · 主进程代理翻译（MyMemory/LibreTranslate）· Tesseract.js OCR · Web Speech 语音输入 |
| 生态 | plugins / bridge / sync | .maz 插件系统（契约校验 + 示例×2）· 9 种桥接 · 局域网同步（mDNS + TLS + 配对码 + 基线冲突处理） |
| 界面 | shell | 二叉树分屏 · 多窗口 · 思源式侧栏（折叠/钉住/浮出/拖宽）· Ribbon 折叠调高 · 7 套主题含苏式构成主义 · **图片取色自定义主题** · 8 语言 i18n |

## 架构

```
main/        Electron 主进程：单实例 · 窗口管理 · IPC 总线（白名单信封）· 托盘 · 协议
             · 打印双路径 · 拼写 · 崩溃恢复 · SearXNG/翻译/密码/同步/更新 服务
preload/     contextBridge 白名单桥（渲染进程唯一入口 window.mazz）
renderer/
  core/      命令注册表（单一事实源）· 上下文键 · 键位 · 菜单 · 命令面板 · 模块注册表
  shell/     Ribbon · 标签 · 二叉树窗格 · 侧栏 · 状态栏 · 主题
  modules/   12 个契约模块（create/activate/getContent/setContent + contributes）
  i18n/      8 语言字典（原文即 key 映射）· RTL
  help/      内置帮助中心（mini md 渲染）
tests/       自研 harness：单元 / 契约（jsdom 真实实例化）/ 往返（docx/xlsx/pptx）/ e2e 冒烟 / 双实例同步
plugins-samples/  示例插件源码（构建时打成 samples/*.maz）
```

**模块契约**：任何功能模块必须实现 `create / activate / deactivate / getContent / setContent / newDocument`，经 `contributes` 声明命令/键位/菜单——插件与内置模块同权，加载时严格校验。

**安全基线**：contextIsolation + IPC 白名单（渲染进程无任意通道）· CSP（仅按需放行 OCR CDN 与插件 blob）· 密码经 safeStorage 系统级加密 · 搜索/翻译通道细节不出主进程 · webview 独立会话禁 nodeIntegration。

## 隐私红线

- SearXNG 实例地址与凭据仅存主进程，渲染进程与网页不可见；搜索结果零源站信息
- 网页浏览：UA/Accept-Language 归一化、跨域 Referer 剥离、追踪域名拦截、X-Client-Data 清除
- 翻译走主进程代理；密码密文落盘（DPAPI/Keychain/keyring）

## 测试与质量

- 21 个测试文件全绿：`npm test`（单元/契约/往返/i18n/同步/帮助/UI 主题）
- docx 往返 20 份关键元素 100% 保留 · xlsx 10 份零丢失 · pptx×5 主题合法
- 公式引擎 26 组 Excel 一致性断言 · Electron 真机冒烟 10 项 · 双实例同步 100 文件零丢失
- 测试本身有防"假绿"设计（harness 防 beforeExit 重入，历史教训固化）

## 许可与第三方

代码：ProseMirror / Monaco / SheetJS / ExcelJS / PptxGenJS / ECharts / jszip / perfect-freehand / Tesseract.js / node-pty / debugpy / node-forge / bonjour-service（均为 MIT/Apache/BSD）。
SearXNG（AGPL）为自部署服务、不分发；Pandoc（GPL）仅外部进程调用（可选）。
