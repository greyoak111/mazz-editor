# W71 插件安全与 Overlay/Z-order 检查点

> **后续修正：** 本文的局部 Overlay 结论已被 W87 统一视觉合成运行时 supersede；插件信任结论不变。见 [`W87_UI_CONVERGENCE_CHECKPOINT_2026-08-19.md`](./W87_UI_CONVERGENCE_CHECKPOINT_2026-08-19.md)。

> 日期：2026-08-16
> 父坐标：`main@842a45d`
> 范围：插件执行信任边界、首启协议遮挡、代表性跨 Surface 浮层
> 结论：**两个子 Gate 通过；Plugins 仍为 Preview，不代表完整 Wave 退出**

## 1. 插件安全边界

施工前，工作区 `plugins/` 下的新 `.maz` 包默认启用并在启动扫描中直接动态导入；安装动作也会复制后立即执行。只要包进入目录就能获得渲染环境代码执行，且内容变化没有再授权机制。

本轮落地：

- 新装插件先校验、复制、禁用并隔离，不在安装阶段执行；
- 安装校验与复制共用同一次读取的字节流，源包不能在两次读取间偷换；
- 授权绑定整个 `.maz` 包的 SHA-256，而不是只信任 `id` 或版本号；
- 审查到执行携带 `expectedHash`，内容在两者之间被替换时拒绝；
- 已授权包内容变化后自动进入 `changed`，旧授权失效；
- 删除同时撤销授权并禁用；
- 同 ID 已加载模块在动态 import 前收口，重复扫描不再触发顶层副作用；
- 对包、manifest、入口代码、入口路径与 permissions 结构增加上限和校验；
- 原生插件管理面板明确展示“隔离中 / 已授权 / 内容已变化”、SHA-256 与声明权限，并在授权前警告当前没有进程级沙箱。

Packaged 真实路径依次验证：

```text
干净 userData + 工作区预放插件
→ 启动不执行
→ 面板显示隔离
→ 显式确认当前 hash 后立即加载
→ 重启自动加载同一 hash
→ 改包后再次启动不执行
→ 面板显示旧授权失效
```

机器证据：[`evidence/W71_PLUGIN_TRUST.json`](./evidence/W71_PLUGIN_TRUST.json)。

视觉证据：

- [`W71_PLUGIN_QUARANTINED.png`](./evidence/W71_PLUGIN_QUARANTINED.png)
- [`W71_PLUGIN_TRUSTED.png`](./evidence/W71_PLUGIN_TRUSTED.png)
- [`W71_PLUGIN_CHANGED.png`](./evidence/W71_PLUGIN_CHANGED.png)

边界：permissions 当前只是声明和审查信息，不是沙箱 enforcement；没有签名、发布者身份或 Marketplace 信任链。因此“未授权插件自动执行”这一 W71 Hard Gate 已关闭，但 Plugins 继续标记 **Preview**，不能扶正为正式安全插件平台。

## 2. Overlay / Z-order

真实 packaged 检查发现首启协议绕过已有原生协议面板，落回主窗 DOM modal；默认 Browser `WebContentsView` 会在独立合成层压住它。现已把 Electron 的自动首启与手动入口统一到 `agreement` PanelWindow，并把 Browser 临时分享确认切到 OS 原生对话框。

随后对首启协议、标签上下文菜单、Quick Switcher 与页签拖拽做活动 WebContentsView 同场验证：前三者使用带主窗 parent 的独立 BrowserWindow；拖拽当时使用临时 cloak + DOM 分区预览，资源账前后相等。该历史拖拽门禁后来被 W87d 证伪：hidden 不等于用户仍看见网页；现行路径必须先预绘 WCV 代理帧再 cloak。

完整 Census 与截图见 [`W71_OVERLAY_ZORDER_CENSUS.md`](./W71_OVERLAY_ZORDER_CENSUS.md)。现有局部 owner 足以关闭本轮根因，不触发 Universal Overlay Manager 或 SurfaceManager PoC。

## 3. 验证

| Gate | 结果 |
|---|---|
| 插件 trust/hash 契约 | `3/3` |
| Overlay 架构守卫 | `3/3` |
| Agreement 契约 | `4/4` |
| 插件 app-unpacked E2E | 默认隔离、授权、重启、变更撤权全部 PASS |
| Overlay app-unpacked E2E | 协议/menu/palette/drag 四路径 PASS |
| app-unpacked 重建 | Electron `33.4.11` PASS |
| W71 app-unpacked 20 轮生命周期 | PTY/Panel/WebContentsView/FileWatcher/WebTorrent/Python/Viewer/Factory/Monaco 全部 PASS；结束后 active resources 回到 `2` |
| 全量测试 | `142/142` 个测试文件通过 |

提交坐标由权威未尽总表在提交完成后回写；没有升级 Electron/依赖，没有删除 workaround，没有实施 W63–W86、统一 `.maz` 资产标准、Marketplace 或 Universal Overlay Manager。
