# W64 陪看运行时规格

## 事实边界

W64 消费 Player 的媒体时钟、暂停/结束、倍速、低分辨率画面变化和 WebAudio RMS；不接管解码、字幕、播放队列或 P2P。AI 只得到当前进度及此前的本地会话上下文，不能读取未来轨道。

## 时机与话量

- 高 RMS / 高画面变化：`climax / silence`，至少屏息 8 秒。
- 高潮后 10 秒：`afterglow / wait`。
- 平缓播放：`calm / discussion`。
- 暂停：`paused / discussion`，用户可自由开讲。
- >1.25×：`accelerated / sparse`。
- 片尾：`credits / recap`。

`silent / discussion / recap` 是三档话量。用户消息永远先于 AI 发言；每次拍点最多选择两位人格，AI 之间不自动无限互聊。

## 人格、Provider 与防剧透

- 八个冻结预置人格；十类风味包。
- `.mazzperson` 使用 `mazz.persona/v0`、四象限 0–1、严格字段与 2,000 字 prompt 上限。
- 试音检查明确打回客服腔、说教腔和单次超长话量。
- `companion_1`–`companion_4` 是独立 Provider 路由；一次拍点最多并发两席。
- 每条回复强制带当前用户话题引用；未来时间码、下一集、结局类文本由输出锁二次阻断。

## 会话、档案与成本

- 会话内 verbatim 最多 2,000 条；检索只返回 `mediaTimeMs <= currentTimeMs`。
- 用户首次打开陪看后才启动感知，不打开不产生后台 AI 调用或观剧档。
- 关闭/换片取消在途请求；`{workspace}/accompany/<媒体>-<sourceHash>.md` 原子追加一剧多场、拍点轴和对话全录。
- 成本显示为调用次数/token 估算；货币价格只按实际 Provider 配置，不硬编码失真的宣传价。

## 当前激活边界

本地时机闸、人格协议、双席路由、防剧透、会话/归档和正式 Player 入口已落。真实 Qwen/豆包长视频模型、定时自动发言质量、音效资产、设备/RDP 长播仍是外部条件 Gate，未冒充通过。
