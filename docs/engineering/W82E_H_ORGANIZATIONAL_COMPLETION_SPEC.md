# W82e–h Organizational Compiler 本地完备规格

## 范围

本规格关闭 W82e–h 的本地能力，不实施 W69m 公共网站、市场或 Publication：

- W82e：Novel / Comic / Audio / Animation 共享 World/Event/资产引用，但 Edition 的 Anchor、进度、版本与专业 Gate 独立。
- W82f：Blueprint → Design Bible → Asset/Code → external engine build → independent playtest → local manifest 的最小游戏垂直切片。
- W82g：Workflow create/import/export/fork/diff/migrate/deprecate、本地库、兼容性与缺件预览。
- W82h：从目标、约束、资产、方法和预算生成可检查组织预览；显示责任、工件 DAG、Gate、成本、缺件和人工签发点。

## 不变量

1. World/Repository/Evidence 是钉住版本的 Production Context，不由 Workflow Run 静默改写。
2. 同一 Event 的多媒介 Edition 共享引用，不共享 Anchor namespace、progress namespace 或专业工件版本。
3. 游戏引擎和构建工具属于 W79 External Capability；Mazz 不建设或冒充 Game Engine。
4. Workflow Library 保存 Definition 和 provenance，不保存 W73 Runtime Instance、secret、绝对私有路径或 Publication 权力。
5. 同 `workflowId/version` 的内容漂移拒绝覆盖；Fork 必须产生新 semantic identity；deprecate 需要 human Authority 和理由。
6. Intent UI 的“编译预览”和“存入本地库”都不启动 Agent/Tool；强制 Authority/Gate 不可由换 Method/Executor 绕过。
7. W73 持有唯一运行真相；W66/W79 只在将来用户明确启动后执行。本波无自动执行与外部 mutation。

## Hard Gates

- 四媒体 Edition 的 Anchor/进度 namespace 唯一；World version 移除 Event 只标记受影响 Edition。
- 游戏 external engine 缺失必须得到 `BLOCKED_TOOL_MISSING`/Kernel blocker；失败与取消只失效 affected DAG。
- Workflow export→import 保持 package digest；rename/copy 不改变 identity；Fork 改 identity；tamper/drift fail closed。
- compatibility 分开报告 Capability 和 Human Authority 缺件。
- 真 Electron 打开组织编译台，生成 7 Seat/4 Gate 动画预览并写入工作区本地库；renderer error 为 0。

## 停止线

没有真实游戏二进制、真实 external engine 调用、跨用户 Fork、Hub 页面、市场、公共排名、支付、Publication 或跨行业外部生产承诺。Sample D 的“master.mp4 + Hub Publication + another-user fork”仍因本轮唯一排除项 W69 与外部工具条件未整体通过；本地 Compiler/Library/UX 不冒充公共闭环。
