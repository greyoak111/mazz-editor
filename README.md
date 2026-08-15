# Mazz Editor

一站式超级编辑器 —— 榨干 Electron 的全模块工作台。
**文档 · 表格 · 演示 · 编程 · 隐私浏览 · 双链笔记 · 导图 · 画板 · 书库 · 查看器 · 智能创作 · 全格式互通**

- 一框直达：`Ctrl+P`（或 `Ctrl+Shift+P`）唤起 Quick Switcher，文件、命令、最近打开、全文命中同框排序
- 帮助文档内置：按 `F1` 打开喂饭级使用指南（22 章，可全文搜索）
- 界面 8 语言：中文 / English / العربية / Français / Русский / Español / 日本語 / 한국어（含 RTL 镜像）
- 查看器：图片 / PDF / 音视频原生播放，放不了的格式内置 **ffmpeg.wasm 一键转码**（本地懒加载，离线可用）
- 智能创作：创作模板（公文/财务/小说/教案/通用 + 自定义）→ 表单/竹筒倒豆子 → **复制模板母版（零配置可用）或直连 DeepSeek/Kimi 批量产出**；任务队列 + 主控台日志 + 连写快照 + 断点续写

## 快速开始

```bash
npm install
npm run dev      # 构建渲染层并启动 Electron（Electron 下载失败时 postinstall 自动换镜像兜底）
npm test         # 单元 + 契约 + 往返测试
npm run smoke    # Electron 真机冒烟（含 IPC 白名单 / 密码管理器 / 13 模块注册 / 307 命令）
npm run audit:release  # 生成 source map / native ABI / 许可证 / vendored runtime 发布基线
npm run audit:w71:census  # 生成 UI / Layout / Surface / Agent Wave 0 Census
npm run dist:dir       # 构建 Windows app-unpacked specimen
npm run dist           # 构建 Windows NSIS 安装包
```

数据默认存放于 `文档/MazzWorkspace`：笔记与书摘为纯 Markdown，书库/插件各有专目录，全部资料可整体拷贝备份。

## 当前已落地主链

| 领域 | 模块 | 能力要点 |
| --- | --- | --- |
| 文档 | markdown / text | ProseMirror 自建内核 · 即时渲染（CJK/全角友好）· 字体字号颜色对齐行距 · 表格/脚注/批注（docx Comments 映射）· 页面设置/分页预览/目录 · docx/PDF 双向 · Word 样式映射表 |
| 表格 | sheet | 虚拟网格（10 万行）· 自研公式引擎 100+ 函数（Excel 语义对齐）· 冻结/合并/填充柄/排序筛选/验证/条件格式 · 透视 · ECharts · xlsx 双向零丢失 · Excel 互粘 |
| 演示 | slide | 大纲成稿（#/##/-/---）· 主题×5 · 画布编辑（文本/形状/图片）· 放映与演讲者视图 · PptxGenJS 导出 |
| 编程 | code | Monaco + TS 智能 · node-pty 终端 · DAP 调试（debugpy 断点/单步/变量/监视）· 运行文件/选区 |
| 浏览器 | browser | SearXNG 主进程代理（源站零暴露）· UA 归一化/Referer 剥离/追踪拦截 · 多标签 · 收藏文件夹分类/历史页面级屏蔽 · 主页主题/自定义主页 · safeStorage 密码管理器 + 自动填充 · 网页缩放/页内查找 |
| 笔记 | notes | [[双链]]（点击打开/自动创建）· 反向链接 · 关系图谱 · 每日笔记 · 1.5s 自动落盘 |
| 搜索 | search | IndexedDB 全文索引 · 正则/类型过滤 · 命中直达 |
| 导图 | mindmap | 多根森林 · 三布局 · 多行自适应 · 多父级连接（Ctrl+Alt+L）· 三种线全要素编辑（直曲/颜色/线宽/拐点/注释）· 右键三套选单 · PNG/SVG/PDF 导出 · 模板系统 |
| 画板 | draw | 八笔型压感矢量笔 + ABR 导入 · 图层/参考图/帧与洋葱皮 · 油漆桶/液化/滤镜 · 形状文字/套索 · 对称/辅助线 · 过程内录 mp4 |
| 书库 | library | 全格式阅读：epub/cbz/txt/mobi/azw3/pdf + 图片文件夹漫画（一话=一文件夹）· 分类/封面自定义/批量增删 · 进度条百分比/单双滚动三模式/Ctrl+滚轮缩放/主题/书签/书内搜索 · epub→Markdown |
| 查看器 | viewer | 图片缩放/适应/1:1 · PDF（PDFium）· ffmpeg.wasm 本地转码兜底 · 只读防呆 |
| 播放器 | Mazz Player | PotPlayer 风深色皮肤 · 控制条自隐 · 进度条悬停缩略图 · 无边框 · 高保真信息（kHz/声道/码率）· 频谱 · 播放列表 · 全套快捷键 |
| 智能创作 | factory | 创作模板×5+自定义 · 动态表单/竹筒倒豆子智能填充 · 模板母版复制 · 任务队列/连写快照/断点续写 · 双循环勘误 · Provider 热切换（DeepSeek/Kimi/OpenAI/Ollama）· 右侧工具坞承载 |
| 工具 | math / translate / ocr / voice / annotate | Python+JS REPL · calc 算块 · 主进程代理翻译 · Tesseract.js OCR · Web Speech 语音输入 · 全局批注外套（滚轮/键盘穿透） |
| 生态 | plugins / bridge / sync | .maz 插件系统（契约校验 + 示例×2）· 9 种桥接 · 局域网同步（mDNS + TLS + 配对码 + 基线冲突处理） |
| 界面 | shell | 二叉树分屏 · 多窗口 · 思源式侧栏（折叠/钉住/浮出/拖宽）· Ribbon 折叠调高 · 8 套主题（含苏式构成主义与原神风「星辉」）· **图片取色自定义主题** · 8 语言 i18n |

## 架构

```
main/        Electron 主进程：单实例 · 窗口管理 · IPC 总线（白名单信封）· 托盘 · 协议
             · ResourceLedger · Agent Harness Foundation · 打印双路径 · 拼写 · 崩溃恢复
             · SearXNG/翻译/密码/同步/更新 服务
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

- 131 个测试文件进入统一入口：`npm test`（单元/契约/往返/i18n/同步/帮助/UI 主题/W71 Census 与生命周期）
- docx 往返 20 份关键元素 100% 保留 · xlsx 10 份零丢失 · pptx×5 主题合法
- 公式引擎 26 组 Excel 一致性断言 · Electron 真机冒烟 10 项 · 双实例同步 100 文件零丢失
- 测试本身有防"假绿"设计（harness 防 beforeExit 重入，历史教训固化）

## 许可与第三方

Mazz 自有代码按 [`LICENSE`](./LICENSE) 中的 MIT License 分发；第三方组件以 [`NOTICE`](./NOTICE) 与 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) 为入口，最终义务以实际发布物及各组件许可证为准。

SearXNG（AGPL）为自部署服务、不分发；Pandoc（GPL）仅作为可选外部进程调用。内置 ffmpeg.wasm 是真实发布资产，其固定哈希和仍缺的来源/构建证据记录在 [`renderer/vendor/ffmpeg/PROVENANCE.md`](./renderer/vendor/ffmpeg/PROVENANCE.md)；缺口关闭前不得宣称发布许可已经完全闭环。
