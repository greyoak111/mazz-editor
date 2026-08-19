# W83 本地弹幕运行时检查点 — 2026-08-19

## 完成

- W83a：严格事件、Bilibili XML / ASS / JSON 本地 Adapter、来源保持、稳定排序/增量/二分/撤回。
- W83b：只读 media clock 的 Scheduler、seek 清池、滚动/顶部/底部轨、碰撞检测、过滤前置与高密度有界降级。
- W83c：Canvas 批绘、DPI/resize/fullscreen/context-loss/visibility 恢复、220 Active/512 glyph/10,000 event 上限、可释放生命周期。
- W83e 本地部分：可访问性投影、可选 mask region、独立 `ai-comment-local` track；Mask 缺失/失败不阻断基础轨。
- Player 正式“弹”入口可导入本地 XML/ASS/SSA/JSON，换片清轨，关闭释放 runtime。

## Hard Sample F

10,000 条归一事件完成 60 秒媒体时钟推进、20 次前后 seek、多视口 resize、过滤/撤回与 clear。相同输入/时钟/视口调度相同，活动池不越 220，高密度产生明确 dropped；clear 后 event/active/cursor/dropped 全归零。

## 验证

- `npm run build`：PASS。
- `node tests/contract/w83-danmaku-runtime.test.mjs`：7/7 PASS。
- Player W22 `6/6`、W23 `5/5`、W64 `7/7` PASS。
- 新合同已登记 `tests/run.js`；未运行真实 Canvas 长播、GPU/device-loss、packaged/DPI/RDP E2E。

## 排除与条件门

W83d 公共 Danmaku Event Projection 属于本轮明确排除的 W69/网站边界，未接入也未伪造。AI track 是独立本地来源，不冒充公共用户弹幕；mask 模型本身仍为外部可选条件。
