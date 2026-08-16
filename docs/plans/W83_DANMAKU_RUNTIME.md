# W83 Danmaku Runtime
## Media-clock-native Scheduling / 基于媒体时钟的弹幕运行时

> 状态：`DESIGN REGISTERED / POST-W71 / NOT APPROVED FOR IMPLEMENTATION`
> 版本：v0.1
> 登记日期：2026-08-16
> 来源：维护者《从内容网络、World、组织编译器到 .maz 生产资料标准》
> 原始 SHA-256：`79A1588A2971E134B6CEB1CFD02AC4D27AB4981968A0E46285DEA0EE3D039408`
> 跨波次真源：`C:\Users\Administrator\Downloads\交付区\Mazz 当前未落地全景-W71归并版.md`

## 0. 定位

弹幕不是 Player 内若干绝对定位 DOM，而是独立的媒体时间调度、轨道分配、密度治理与渲染 Runtime：

```text
Danmaku Source Adapter
→ normalized events
→ Media Clock
→ Timeline Index
→ Scheduler
→ Lane Allocator
→ Collision / Density / Filter
→ Canvas / GPU Renderer
```

W83 只消费 Player 的稳定播放时钟和视口，不拥有媒体解码、播放队列或 Publication Event Feed。

## 1. 三层分权

```text
Source Plane
Bilibili XML / ASS / local track / MazzHub Danmaku Event / AI comment track

Runtime Plane
normalize / index / schedule / lane / collision / density / filter

Render Plane
Canvas / GPU / mask compositor / accessibility projection
```

Source Adapter 不能携带站点 DOM 或网络协议进入调度核心。W69 负责公共 Danmaku Event 的身份、权限、审核与同步；W83 负责本地实时显示。W64 AI 陪看可以产生独立 AI comment track，但不能冒充公共用户弹幕。

## 2. Player 最小接口

Player 只需暴露：

```text
currentTime
playbackRate
paused
seek event
resize event
visibility / fullscreen state
```

运行时不得轮询 DOM 猜播放状态，不得接管 video element，也不得把 wall clock 当媒体时间。

## 3. 时间与 Seek 语义

- 事件以媒体时间排序并建立可二分定位的 Timeline Index；
- Seek 后清空 Active Pool，从目标时间窗口重新物化；
- playbackRate 改变必须重算速度与剩余生命周期；
- pause 冻结媒体位置，不让 wall clock 继续推进弹幕；
- source 增量到达时保持稳定排序，不重建全部轨道；
- late event 必须有明确 drop/show-late 策略，不静默穿越时间线。

## 4. 轨道、碰撞与密度

滚动弹幕的安全间隔必须考虑文字宽度、初始位置、速度和后车追尾时间。Lane Allocator 至少区分：

```text
scroll
top-fixed
bottom-fixed
positioned / advanced（后置）
```

Density Policy 在高峰时执行优先级、采样、限流、折叠或延迟，不能把所有事件先塞进 DOM 再期待浏览器解决。用户屏蔽、关键词、来源、颜色、字号和权限过滤发生在分配轨道前。

## 5. Renderer 与性能预算

- 首选 Canvas/GPU 批绘，DOM 只作为低量回退和可访问性投影；
- 字形、描边、阴影和常用样式允许 raster/cache，但缓存必须有上限；
- Active Pool、glyph cache、mask surface 和 source buffer 都必须进入资源账本；
- resize、DPI、全屏和设备丢失后可重建，旧 surface 必须释放；
- 后台、最小化和不可见状态按策略降频或暂停，不积压无限补帧；
- 智能防挡属于独立 Mask/Compositor 层，模型失败不得阻断基础弹幕。

## 6. 数据与权限

标准事件候选字段：

```text
eventId / publicationId / editionId / version
mediaTimeMs / createdAt
mode / text / style / priority
creatorRef? / sourceRef / moderationState
replyTo? / regionHint? / provenance
```

本地导入轨、公共 Event Feed 和 AI track 必须保留来源。删除、屏蔽、审核和撤回是事件状态，不修改 Publication blob。客户端缓存可重建，不成为公共事实真相。

## 7. 施工拆波

### W83a — Clock / Event / Source Contract

冻结时钟、seek、标准事件、Adapter 和权限边界；用本地 fixture 证明 XML/ASS/JSON 可归一且来源不丢。

### W83b — Scheduler / Lane Allocator

实现 Timeline Index、Active Pool、追尾检测、固定轨、密度策略和确定性回放测试。

### W83c — Canvas Renderer & Resource Lifecycle

实现有界缓存、DPI/resize/fullscreen/device-loss 恢复及 20 次挂载/卸载回到账本基线。

### W83d — W69 Event Projection Adapter

只在 W69 公共事件契约获批后接入 Comment/Danmaku moderation、撤回和增量同步；离线本地轨仍独立可用。

### W83e — Mask / Accessibility / AI Track

智能防挡、无障碍文本投影和 W64 AI comment track 均为后置可选层，不能阻塞 W83a–c。

## 8. Hard Validation Sample F

```text
10,000 normalized events
→ 1x play for 60s
→ change to 2x
→ seek forward / backward 20 times
→ resize + fullscreen + DPI change
→ apply filter / moderation withdrawal
→ close and reopen
```

退出条件：相同输入与时钟产生可比较调度；无穿越/重复/追尾越界；高密度按策略降级；撤回事件不再出现；关闭后 Active Pool、timer、surface 和 cache 回到基线；Player 主链不因 Adapter 或 Mask 失败中断。

## 9. 永久禁区

```text
× wall clock 代替 media clock
× 每条弹幕一个永久 DOM 节点
× Source Adapter 混入 Scheduler 核心
× 公共 Event Feed = Publication content version
× W64 AI comment = 用户公共弹幕
× Mask 模型失败阻断基础播放
× 无上限 Active Pool / glyph cache / event buffer
× W83 接管 Player 解码、队列或 P2P 获取
```

## 10. 当前停止线

本文件只登记 W83 契约、拆波和 Sample F。W71 内不得据此增加弹幕入口、GPU 依赖、公共事件服务、AI 防挡模型或播放器行为。
