# Mazz Post-W71 增量研究储备：统一 Runtime、局域网同步、Replica Harness 与桌面性能工程

> 文档属性：增量整理 / 研究与验证储备
> 形成时间：2026-08-15
> 适用阶段：Post-W71 之后再评估
> 当前状态：**不进入 W71，不修改当前冻结范围，不构成交付承诺**

## 0. 文档边界

本文只整理“GitHub 扒仓库两轮战利品”之后新增的讨论与工程启示，主题集中在：

- Chat / Work / Codex Cloud / Local 的状态割裂，以及统一 Runtime 对 Mazz 的启示；
- 思源式多端一致、Mazz 局域网同步的基本哲学与分层；
- 没有第二台电脑时的 Replica 仿真、双实例、Hyper-V 与故障测试；
- Win10 LTSC、16GB 内存机器上的轻量验证策略；
- 桌面端性能工程中可以迁移到 Mazz 的原则。

本文**不重复浏览器历史主体方案**。只有在解释通用 `Workspace Event` 和多父上下文时，才做两处最小引用：

1. 浏览器历史只是未来可能接入 `Workspace Event` 的一种来源，不是事件模型本身；
2. 同一对象进入多个上下文时，应同步独立的 `Placement` 关系，而不是把单一路径当作对象身份。

本文也不把对 OpenAI/Codex 的产品观察或架构推断写成内部实现事实。官方公开页面可以确认 Chat、Work、Codex 面向不同任务形态；至于桌面端具体如何切进程、做虚拟列表、调度优先级，本文只把它当作黑盒体验、此前仓库观察和通用性能工程共同导出的候选原则。

---

## 1. 一句话结论

这轮新增讨论最终汇成两条主线：

1. **同步不是“把一个文件夹复制到另一台电脑”，而是让多个 Replica 对同一组语义对象和关系最终收敛。** Transport 只负责搬运，索引随时可重建，测试 Harness 必须能主动制造断网、乱序、重复、崩溃和旧状态复活。
2. **桌面端不应让 UI 承担 Runtime。** UI 只观察状态、提交意图并渲染当前可见表面；任务、索引、Watcher、PTY、Browser、Player、同步和持久化都有独立生命周期、预算与背压。

两条主线其实是一回事：

> 把真实状态、执行生命周期和展示表面拆开；让每一层都能独立恢复、替换、验证和限流。

---

## 2. Chat / Work / Codex Cloud / Local：状态割裂暴露出的 Runtime 问题

### 2.1 产品层面的可见割裂

当前这类桌面智能工作台通常同时存在几条轴：

| 轴 | 典型取值 | 容易被错误混为一谈的东西 |
|---|---|---|
| 体验表面 | Chat / Work / Codex | 侧栏、历史、交付物、代码任务 |
| 执行位置 | Cloud / Local | 算力、网络、可访问工具、进程生命周期 |
| 数据位置 | 云端 / 本机 / 外部服务 | 会话、文件、输出、凭据、缓存 |
| 权限域 | 账号 / Workspace / 本机授权 | 哪个任务能读什么、能调用什么 |
| 可续接范围 | 桌面 / Web / Mobile / Remote | “看得见”不等于“状态完全同构” |

由此产生的用户体感是：同一个产品里看似相邻的入口，历史、任务、文件、权限、执行位置和恢复能力却未必一致；“能在另一个端看到”也不等于“另一个端拥有相同的本地状态与工具环境”。

这不是在批评某一个产品，而是在提醒 Mazz：**如果表面模式直接拥有核心状态，功能越多，割裂越会固化。**

### 2.2 给 Mazz 的核心启示：统一 Runtime，不强求统一 UI

Mazz 不需要把 Browser、Player、Mindmap、Viewer、Chat、Agent 做成同一张脸，但应让它们建立在同一套运行时身份和状态语义上。

建议未来统一的最小概念不是“页面”，而是：

```text
Workspace
├─ Entity / Placement / Relation
├─ Thread / Task
├─ Artifact
├─ Execution
├─ Event
├─ Permission Context
└─ Replica State
```

其中：

- `Thread / Task` 描述一段可续接的工作；
- `Artifact` 描述可交付、可引用、可版本化的结果；
- `Execution` 描述一次具体运行，位置可以是 Local、Cloud、VM 或未来的远端节点；
- `Permission Context` 明确这次运行能访问的目录、应用、账号和网络；
- `Event` 是 Runtime 的增量事实，不等同于某个 UI 组件的 state；
- `Replica State` 负责某个副本已经见过、应用过和持久化过什么。

于是表面只选择视图和能力：

```text
UI Surface
  ├─ 读取 Snapshot
  ├─ 订阅 Delta
  ├─ 提交 Intent
  └─ 展示 Execution / Artifact

Runtime
  ├─ 拥有任务生命周期
  ├─ 持久化语义状态
  ├─ 调度本地或远端执行
  └─ 向不同 Surface 发布同一种事件
```

### 2.3 不要制造一个“上帝模式字段”

不建议在核心里堆出：

```ts
if (mode === "chat") { ... }
if (mode === "work") { ... }
if (mode === "codex-local") { ... }
if (mode === "codex-cloud") { ... }
```

更稳的做法是把差异拆成正交属性：

- `experienceMode`：当前表面如何组织交互；
- `executionSite`：这次执行在哪里跑；
- `storageScope`：权威状态和产物在哪里；
- `contextRefs`：引用了哪些 Workspace 对象；
- `permissionProfile`：允许访问什么；
- `capabilities`：这个执行器实际支持什么。

这样未来新增 NAS、小服务器、第二台真机或 CI Runner 时，是增加 Executor / Transport Adapter，而不是复制一套“新模式业务逻辑”。

---

## 3. 思源式多端一致与 Mazz 的局域网同步哲学

### 3.1 同步的目标是最终收敛，不是复制动作看起来成功

局域网同步的验收标准不应是：

> A 发出了文件，B 收到了文件。

而应是：

> 在允许的重试、乱序、重复、离线、重启和并发修改之后，所有 Replica 对权威语义状态得到相同的规范结果。

因此必须先定义：

- 什么是需要同步的权威对象；
- 什么是关系，什么是对象属性；
- 删除如何表达、保留多久、怎样避免旧副本复活；
- 并发修改如何合并或暴露冲突；
- 事件重复和乱序怎样保持幂等；
- Replica 如何确认自己缺了什么；
- “最终一致”具体比较哪些规范化结果。

### 3.2 Local-first，但不能把“本地文件夹”误当作一致性模型

Mazz 的自然方向仍然是 Local-first：本机在离线时可完整工作，联网只是让多个副本交换增量。

但 Local-first 不等于：

- 直接同步数据库文件；
- 直接镜像缓存目录；
- 依赖最后写入时间覆盖；
- 把绝对路径当成全局身份；
- 假设 TCP 成功返回就等于业务落盘。

更稳的抽象是：每台设备维护自己的 Replica，本地提交先成为可持久化的语义变化，再由 Transport 与其他 Replica 交换；收到远端变化时走与本地一致的验证、去重、应用和派生更新流程。

### 3.3 多父上下文的最小引用：同步 Placement，而不是路径

同一个 Entity 未来可能同时出现在多个父上下文中。对象身份与“它出现在哪里”应分开：

```text
Entity E1
├─ Placement P1 → Parent A
├─ Placement P2 → Parent B
└─ Placement P3 → Parent C
```

同步时：

- 修改 Entity，不应隐式删除它的其他 Placement；
- 从 Parent A 移除，只删除或墓碑化 P1；
- 向 Parent D 添加，是新增 P4；
- 路径只是某个投影视图的结果，不是 E1 的身份。

这是本文对通用 Workspace Event / 多父模型的全部引用，不展开浏览器历史的采集、过滤、回填或展示方案。

---

## 4. 同步架构分层：对象、派生索引、Replica、Transport

### 4.1 第一层：同步对象（Source of Truth）

候选同步对象包括：

- Entity 的稳定身份与权威字段；
- Placement / Relation 的增删与属性；
- 必须跨设备成立的用户配置；
- 任务、产物或工作区中被明确纳入同步语义的元数据；
- 删除墓碑、版本前提或冲突记录；
- 必要的 Blob 清单与内容寻址引用。

是否同步大体积 Blob 可以后续分级，但“元数据已收敛、Blob 尚待传输”必须是可表达状态，不能假装二者同时完成。

### 4.2 第二层：派生索引（可删除、可重建）

以下内容原则上不作为跨设备真相直接同步：

- 全文索引；
- 搜索倒排表；
- Backlink / 子树 / 最近使用等投影；
- 缩略图和预览缓存；
- UI 排版缓存；
- 临时下载、处理中间文件；
- Watcher 扫描结果缓存；
- 为当前版本生成的兼容性缓存。

判断标准：

> 如果删掉它，能否只用权威对象和稳定规则重新生成？

能，就优先归入派生层。把派生索引当作权威真相直接同步，会把版本耦合、损坏传播和无意义流量一起带进来。

但“不是同步真相”不等于“永远不能传输”。昂贵但可重建的派生资产可以作为 **versioned cache** 在设备之间搬运，例如 OCR、embedding、thumbnail、visual descriptor。它们必须携带 `extractorVersion`、`modelVersion`、`schemaVersion` 等足以判断兼容性的版本信息；版本失配、校验失败或权威输入变化时，可以直接丢弃并重建，永远不能反过来成为权威状态。

```text
Sync as Truth                 ×
Transfer as Versioned Cache   √
```

这样高算力设备可以把已经计算好的大规模视觉或语义索引交给低功耗设备复用，而不会把缓存升级成不可替代的数据真相。

### 4.3 第三层：Replica 状态

每个 Replica 至少需要独立维护下列候选状态：

- 稳定 `replicaId`；
- 已生成和已应用的事件身份；
- 去重集合或可压缩的 seen-state；
- 对其他 Replica / Stream 的进度游标；
- 未确认出站队列；
- 收到但暂时无法应用的依赖队列；
- Tombstone / GC 水位；
- Snapshot / Checkpoint 元数据；
- 协议版本与迁移能力。

具体采用序列号、版本向量、Lamport 时间、混合逻辑时钟还是其他机制，应由并发语义和规模验证决定，本文不提前锁死实现。

### 4.4 第四层：Transport

Transport 只负责发现、连接、鉴权、分帧、传输、重试与流控，不决定业务合并语义。

```text
Sync Semantics
      ↑
Replica Protocol
      ↑
Transport Adapter
├─ Same-process loopback
├─ Same-machine IPC / localhost
├─ LAN direct
├─ Hyper-V virtual network
└─ Future relay / CI transport
```

这样可以先在同机 Deterministic Transport 上把一致性打穿，再换成局域网；网络实现变化不应迫使同步语义重写。

### 4.5 推荐的接收管线

```text
Receive Envelope
  → 验证协议与身份
  → 持久化收件事实
  → 去重
  → 检查依赖 / 前提
  → 幂等应用到权威状态
  → 提交游标 / ACK
  → 异步更新派生索引
  → 发布 Workspace Delta
```

关键点是：ACK 的含义必须明确。至少要区分“已收到”“已持久化”“已应用”，否则断电恢复时无法判断对端应不应该重发。

---

## 5. 没有第二台电脑：Sync Replica Harness

### 5.1 测试目标

没有第二台电脑不是同步模块无法验收的理由。测试交付物应包含一个可自动运行的 `Sync Replica Harness`，让一台机器制造两个或更多逻辑副本，并控制它们之间的时间、网络和生命周期。

Harness 的职责：

- 为每个 Replica 分配完全隔离的数据目录、端口、Replica ID 和日志；
- 启动、停止、暂停、杀死和重启实例；
- 注入传输故障与时间顺序；
- 安排本地操作和并发操作；
- 等待系统静默或达到同步水位；
- 规范化并比较最终权威状态；
- 收集导致不收敛的最小事件轨迹和日志。

### 5.2 四级验证阶梯

| 层级 | 形态 | 主要验证内容 | 默认频率 |
|---|---|---|---|
| T0 | 同进程、内存内多 Replica | 合并语义、幂等、乱序、重复、属性测试 | 每次提交 |
| T1 | 同机双进程、独立数据目录 | 真实持久化、锁、端口、进程重启、IPC / localhost | 高频 |
| T2 | Host + Hyper-V VM | 机器边界、虚拟网卡、部署、崩溃恢复、旧快照 | 低频 / 夜间 |
| T3 | 两台真机 / NAS / CI Runner | 真实局域网、设备差异、休眠与防火墙 | 条件具备后 |

T0 和 T1 应先成为主力。VM 不是第一步，也不是同步正确性的唯一证明；它负责补上同机双实例无法真实覆盖的机器边界。

### 5.3 同机双实例的最低隔离要求

```text
Replica A
├─ data/A
├─ port A
├─ replicaId A
└─ log/A

Replica B
├─ data/B
├─ port B
├─ replicaId B
└─ log/B
```

禁止两个实例共享：

- 数据库文件；
- 索引目录；
- 临时目录；
- 单例锁；
- 默认用户配置；
- 隐式全局缓存。

否则测到的可能不是同步，而是“两个进程碰巧读了同一份状态”。

### 5.4 必须覆盖的故障注入

Transport Fault：

- 丢包 / 丢事件；
- 延迟与抖动；
- 重复投递；
- 乱序；
- 分区后恢复；
- 单向可达；
- 限速与背压；
- 连接在帧中途断开。

Replica Fault：

- 应用前崩溃；
- 应用后、ACK 前崩溃；
- 写入中途进程被杀；
- 离线期间累计大量修改；
- 从旧 Snapshot / VM Checkpoint 恢复；
- 本地时钟跳变；
- 磁盘满、只读或短暂写失败；
- 索引损坏后重建。

Semantic Race：

- 两端同时编辑同一 Entity；
- A 删除、B 编辑；
- 两端分别新增不同 Placement；
- A 移除 P1、B 修改同一 Entity；
- 旧 Replica 带着已删除对象重新上线；
- 大 Blob 未完成时元数据先到达；
- 同一事件被重复重放多次。

### 5.5 最终收敛判定

测试不能只看“没有异常”或“队列清空”。建议在允许的同步窗口结束后：

1. 暂停新的用户操作；
2. 恢复所有链路并排空可重试队列；
3. 获取各 Replica 的规范化语义状态；
4. 忽略本机路径、缓存时间戳等非语义差异；
5. 比较 Entity、Placement、Relation、Tombstone、未决冲突、因果 / 版本状态、Blob 引用和协议水位；
6. 删除派生索引并重建，再验证查询结果等价；
7. 若失败，输出随机种子、操作序列、网络计划和首次分歧点。

理想的属性测试表达是：

```text
Given: 任意合法操作序列 + 任意可恢复故障计划
When:  所有 Replica 最终重新连通并完成重试
Then:  canonicalSemanticState(A)
       == canonicalSemanticState(B)
       == ...

canonicalSemanticState includes:
  entities
  placements
  relations
  tombstones
  unresolved conflicts
  causal / version state
```

如果冲突策略允许显式 `unresolved conflict`，收敛意味着所有 Replica 得到**同一组对象、同一组冲突记录和同一因果状态**；在用户裁决之前，不要求系统偷偷选择同一个业务值。不能为了让测试变绿而用任意 LWW 吞掉并发写入，因为“两边相等”并不自动等于“用户数据没有丢失”。

---

## 6. Win10 LTSC、16GB 内存机器的轻量策略

### 6.1 默认不启动 VM

16GB 主机上，日常开发应把资源花在 T0 / T1：

- 默认跑确定性内存仿真；
- 需要持久化边界时跑同机双进程；
- VM 只在特定测试组、夜间、发布前或同步核心变更后启动；
- 同一时间最多一台测试 VM；
- Harness 完成后自动关机并释放内存。

### 6.2 Hyper-V 采用能力探测，不写死环境假设

Harness 启动时检测：

- Windows 版本与所需功能是否可用；
- CPU 虚拟化是否开启；
- Hyper-V 管理能力是否存在；
- 基准 VM / Checkpoint 是否准备好；
- 当前可用内存和磁盘是否达到测试下限。

如果不满足：

- T0 / T1 正常执行；
- T2 明确显示 `SKIPPED: capability unavailable`；
- 不把“机器未配置 Hyper-V”伪装成同步失败。

### 6.3 保守资源预算

可从以下候选预算起步，再用实测调整：

- 1 台最小 Windows 测试 VM；
- 1–2 vCPU；
- 动态内存，低启动值、有限上限；
- 只安装测试 Agent 和必要运行时；
- 不在 VM 内常驻 IDE、浏览器或无关服务；
- Host 与 VM 日志采用有界缓冲；
- 并发测试组限为 1，避免两个“压力测试”互相制造假信号。

这里不把具体 GB 数写成永久标准，因为 Windows Guest 版本、Mazz 打包方式和安全软件都会改变基线。应由 Harness 在首次建立基准镜像时测量稳定空载与峰值，再写入机器本地 profile。

### 6.4 快照策略

- 保留一个“系统 + 依赖已就绪、Mazz 未运行”的干净 Checkpoint；
- 每轮恢复到基准，而不是长期复用已经污染的运行状态；
- 当前测试包由 Harness 部署；
- 测试数据盘 / 目录每轮独立生成；
- 专门保留“从旧快照复活”的测试场景，但它不能污染下一轮普通测试。

---

## 7. 原则：虚拟机由测试 Harness 自动管理

虚拟机不应成为人工操作教程，而应降格为可抛弃的测试基础设施。

目标体验：

```text
运行「Sync Torture Test」
        ↓
检测 Hyper-V 与资源
        ↓
创建或恢复基准 VM
        ↓
Host 启动 Replica A
VM   启动 Replica B
        ↓
部署当前测试包
        ↓
执行正常同步 + 故障矩阵
        ↓
收集两端日志与规范状态
        ↓
PASS / FAIL + 失败证据
        ↓
关闭 VM、释放资源
```

Harness 应满足：

- **幂等**：重复运行不会产生一堆未知 VM、交换机和残留进程；
- **可恢复**：上次中断后能识别并清理自己拥有的资源；
- **有所有权边界**：只管理带专用标签 / ID 的测试资源，不碰用户其他 VM；
- **一次授权**：首次配置可能需要管理员权限，日常运行尽量无需人工管理；
- **可移植**：以后换成真机、NAS 或 CI Executor 时，测试套件不重写，只换环境适配器；
- **证据优先**：失败必须留下可重放种子、事件轨迹、两端日志和环境摘要。

可以把它固化成未来 AI 交付规则：

> 凡实现涉及多进程、多设备、网络、并发或恢复语义的功能，交付物不能只有功能代码，必须同时包含可自动复现的仿真 / 故障测试环境。

---

## 8. OpenAI/Codex 桌面端性能讨论：Mazz 可以偷什么

### 8.1 先声明证据等级

以下内容分三类：

- **可见行为**：桌面端长任务可持续运行，UI 主要接收进度和结果；
- **此前仓库 / 运行痕迹带来的架构线索**：存在独立服务和子进程边界；
- **工程推断**：虚拟化、事件合并、输入调度等具体手段没有完整公开实现说明。

因此 Mazz 应“偷原则、做自己的测量”，而不是照抄一个未经证实的内部架构故事。

### 8.2 原则一：UI ≠ Runtime

Renderer / UI Surface 负责：

- 可见界面；
- 交互与输入；
- 局部视图状态；
- 增量展示；
- 提交用户 Intent。

Runtime 拥有的是权威身份、生命周期和资源所有权：

- Thread / Task / Execution 的身份与状态机；
- 数据库和语义状态的持久化；
- 文件扫描、索引、同步 Replica 与 Watcher 的协调；
- 外部进程、句柄、订阅、日志、恢复与取消责任；
- Browser / Player / PTY 等能力“由谁拥有、是否继续、怎样恢复”的决策。

具体执行不必全部塞进同一个后台服务。根据能力和平台，它可以实际生活在：

```text
Execution may live in:
  Service
  Worker
  PTY process
  WebContents / web renderer
  Media / decoder / GPU process
  Dedicated Surface process
```

例如 Browser 的网页 renderer、WebContents 和 GPU compositor，Player 的解码器和媒体进程，本来就可能拥有专用进程或 Surface。Runtime 负责它们的任务身份、权威状态、资源所有权与延续策略，不等于亲自执行所有重活。

最重要的所有权规则是：

> Surface 不应该因为普通 UI 组件卸载，就顺手杀掉本来应该继续存在的 Runtime；组件重渲染不应重建任务，窗口切换不应复制订阅。

UI 可以崩溃后重连 Runtime；Runtime 也可以重启后从持久状态恢复，而不是依赖 React/Vue 内存里那份“世界”。

### 8.3 原则二：Snapshot + Delta

新 Surface 打开时：

1. 获取一个带版本 / 水位的 Snapshot；
2. 从该水位开始订阅 Delta；
3. 只更新受影响的最小视图；
4. 检测事件缺口，必要时重新取 Snapshot；
5. 对高频但可折叠的事件进行合并。

不要在每个 token、日志行、文件变化或同步事件到来时重新加载全部历史、全部树和全部索引。

候选事件协议至少要考虑：

- 单调序号或明确水位；
- 幂等事件身份；
- gap detection；
- 批量 / coalescing；
- Snapshot 压缩与旧 Delta 回收；
- 慢消费者背压。

### 8.4 原则三：只为可见 Surface 付渲染成本

Mazz 的 Browser、Player、Mindmap、Viewer、Tree、日志面板都可能成为“不可见但仍在工作”的性能黑洞。

“可不可见”和“是否继续执行”必须拆成两条正交状态轴：

```text
presentationState
  active     可见、可交互、完整更新
  warm       最近可见，保留轻量展示状态
  hidden     不可见，停止非必要布局、绘制和 UI 推送
  disposed   展示实例已释放

executionState
  idle
  running
  paused
  stopped
```

二者的组合行为由能力策略决定，不能把 `hidden` 自动翻译成 `execution stops`：

```text
Player:  hidden + running
  → 不刷新可见播放 UI
  → 解码与音频可以继续

Browser: hidden + running
  → 不做非必要可视刷新
  → 下载或已授权后台任务可以继续

Factory: hidden + running
  → Desk 不渲染
  → Job 继续执行

Mindmap: hidden + idle
  → 暂停布局计算
```

对应措施：

- 长列表、树和日志必须虚拟化；
- 折叠节点不构造整棵子树 DOM；
- 离屏 Mindmap 不持续布局；
- 隐藏 WebView / Browser Surface 不持续做非必要截图、轮询或可视刷新，但独立下载 / 任务按 capability policy 继续；
- 非活动 Player 不向隐藏 UI 持续推送高频播放状态，但 `hidden + running` 时音频和必要解码可以继续；
- 切回时通过 Snapshot + Delta 补齐，而不是后台全速渲染。

“隐藏”不能只是一条 CSS；它应真正降低展示侧的订阅、计算、布局和绘制成本，但不越权改变独立 Execution 的状态。

### 8.5 原则四：重活异步化、增量化、可取消

以下任务不能阻塞输入线程或 Renderer 主循环：

- 全盘 / Workspace 文件扫描；
- 全文索引与重建；
- Git 状态和大 diff；
- Markdown / 富文本大文档解析；
- 缩略图、波形、媒体元数据；
- 大日志解析与搜索；
- Mindmap 自动布局；
- 同步校验与 Blob 哈希。

但“扔到 Worker”仍不够，还必须：

- 分块执行并主动让出；
- 支持取消和版本淘汰；
- 合并重复请求；
- 限制并发；
- 对结果回传做背压；
- 避免把巨大对象反复序列化穿过进程边界。

### 8.6 原则五：Watcher 是有预算的基础设施

最危险的模式之一是每个组件、插件或 Surface 自己创建文件 Watcher 和事件监听。

建议使用集中式 Watcher Service：

- 同一路径尽量共享底层监听；
- 订阅拥有明确 owner；
- owner 生命周期结束自动释放；
- 文件风暴做 debounce / coalesce；
- 记录每个模块的订阅数、事件率和处理耗时；
- 设置全局与模块级预算；
- 队列过载时可降级为标记 dirty 后批量重扫；
- 忽略生成目录、缓存和测试临时目录。

Watcher 的预算至少包括：句柄数、订阅数、每秒事件、待处理队列、单批处理时长和触发的下游工作量。

### 8.7 原则六：输入优先

用户能直接感知的任务拥有最高交互优先级：

```text
键盘输入 / 光标 / 点击 / 滚动
    > 当前可见区域的最小更新
    > 普通任务 Delta
    > 后台索引 / 预取 / 缩略图 / Soak 统计
```

具体做法可以包括：

- 主线程长任务切片；
- 大批 Delta 分帧提交；
- 用户连续输入时暂停低优先级刷新；
- 搜索采用可取消请求，旧查询结果丢弃；
- 日志高峰先落有界缓冲，再按帧刷新可见行；
- 后台任务显式设置 deadline / priority，而不是全部“尽快执行”。

流畅不等于所有东西都更快，而是**最重要的输入不会排在不重要的后台工作后面**。

### 8.8 原则七：生命周期必须能画出来

每类资源都应回答五个问题：

1. 谁创建？
2. 谁拥有？
3. 什么时候暂停？
4. 谁负责取消和释放？
5. 异常退出后谁恢复或清理？

重点对象包括：

- Task / Agent Run；
- PTY 与子进程；
- Browser / WebView；
- Player 解码器；
- Worker；
- 文件 Watcher；
- IPC / WebSocket 订阅；
- Blob 流；
- 定时器；
- 缓存和临时文件。

如果资源的生命周期只能靠“组件应该会卸载”解释，长期运行后大概率会泄漏。

### 8.9 原则八：8 小时 Soak——候选 RC / 长期稳定性门槛

它目前仍是 Post-W71 的候选门槛；应先用实测成本和缺陷捕获率决定是否升级为正式 hard gate。建议建立可重复的桌面 Soak 场景：

```text
启动 Mazz
→ 打开大型 Workspace
→ 周期性切换 Browser / Player / Mindmap / Viewer
→ 持续输入、滚动、搜索
→ Agent / PTY 输出长日志
→ 文件树发生批量变化
→ Replica 周期性断开与重连
→ 重复打开、关闭、挂起 Surface
→ 运行 8 小时
→ 导出资源趋势和失败证据
```

必须看趋势，而不只是结束时总内存：

- Renderer / Runtime / Worker 分进程内存；
- 内存增长斜率与 GC 后基线；
- CPU 空闲占用；
- 输入延迟、滚动掉帧、主线程 Long Task；
- Watcher / 句柄 / Timer / Subscription 数；
- 事件队列长度与最老事件年龄；
- WebView、PTY、Worker、解码器实例数；
- 日志和缓存目录增长速度；
- Surface 关闭后资源是否回落；
- UI 重连 Runtime 后能否恢复。

预算不应一开始凭空定死。先跑基线、记录机器 profile，再形成“绝对上限 + 增长斜率 + 回收后基线”三类阈值。最重要的是捕获无界增长，而不是为了过门禁调一个漂亮数字。

---

## 9. 同步 Harness 与性能 Harness 应共享一套测试哲学

这两类测试可以共用基础能力：

- 可重复随机种子；
- 场景 DSL / Timeline；
- 进程与资源所有权标签；
- 故障注入；
- 统一日志关联 ID；
- Snapshot 与增量事件采样；
- 指标预算；
- 失败后自动打包证据；
- 环境能力探测；
- 一键启动、停止和清理。

未来甚至可以让一次 Soak 同时验证：

1. UI 在长期运行中保持响应；
2. Runtime 在 Surface 反复挂起 / 恢复时不泄漏；
3. 两个 Replica 在周期性分区后仍最终收敛；
4. 派生索引随时可删除重建；
5. VM 测试结束后不留下基础设施垃圾。

---

## 10. Post-W71 研究与验证储备清单

以下项目只进入储备，不进入当前冻结范围：

| 储备项 | 目标产物 | 进入实现前的验证 |
|---|---|---|
| Unified Runtime Vocabulary | Thread / Task / Artifact / Execution / Event / Permission / Replica 的 ADR | 能描述 Local、Cloud、VM、远端节点而不靠上帝模式字段 |
| Sync Semantics Spec | Entity / Placement / Relation / Tombstone / Blob 的一致性规则 | 删除、并发和旧副本复活有明确结果 |
| Deterministic Replica Simulator | T0 多副本内存 Harness | 随机乱序、重复、分区可稳定复现 |
| Same-machine Dual Instance | T1 独立数据目录与双进程 Harness | 可证明无共享数据库 / 缓存偷渡 |
| Hyper-V Executor Adapter | T2 Host + VM 自动测试 | 一键恢复、部署、采集、关机，资源有所有权边界 |
| Performance Budgets | 输入、Watcher、队列、内存、Surface 生命周期指标 | 可观测且能在开发机上稳定采样 |
| 8h Soak Lane | 可重复桌面长期场景 | 失败能输出趋势、首次异常点和环境摘要 |

推荐的未来顺序是：

```text
语义说明
→ 确定性 T0
→ 同机双进程 T1
→ Runtime / UI 指标化
→ 短时压力测试
→ Hyper-V T2
→ 8 小时联合 Soak
→ 条件具备后真机 T3
```

这只是风险最小化顺序，不是新的版本排期。

---

## 11. 明确不偷渡进当前冻结范围

在 W71 或其他已冻结工作完成前，本文不自动授权下列事项：

- 不重构现有 Runtime；
- 不引入同步协议或局域网发现；
- 不改数据库 Schema；
- 不建立 Hyper-V 镜像；
- 不增加后台常驻服务；
- 不重做 Browser / Player / Mindmap 生命周期；
- 不承诺多端同步上线时间；
- 不以“顺手铺路”为名扩大当前任务 diff。

当前阶段最多允许：

- 保留命名与接口上的可演进空间；
- 避免新代码继续强化 UI = Runtime、路径 = 身份、索引 = 真相等错误耦合；
- 把发现的问题记入 Post-W71 研究项；
- 在不改变产品行为的前提下补少量观测点，但仍需单独评审。

---

## 12. 后续真正开题时必须先回答的问题

同步方向：

1. 哪些对象是权威真相，哪些只是派生投影？
2. Entity 与 Placement 的稳定身份如何生成？
3. 删除、GC 和旧 Replica 复活的精确定义是什么？
4. 并发字段修改是自动合并、LWW、CRDT，还是显式冲突？
5. Blob 与元数据如何分阶段收敛？
6. ACK 分别代表收到、持久化还是应用？
7. Replica 状态压缩和协议升级怎样做？

Runtime / 性能方向：

1. 哪些任务必须脱离 UI 生命周期？
2. Snapshot / Delta 的水位和 gap recovery 如何表达？
3. `presentationState` 与 `executionState` 分别由谁驱动，capability policy 如何决定组合行为？
4. Watcher、Worker、PTY、WebView 的 owner 如何统一追踪？
5. 输入延迟和后台任务优先级由哪个调度层控制？
6. 8 小时 Soak 的机器基线、阈值和证据包格式是什么？

在这些问题有书面答案以前，不应先堆同步按钮、设备列表或“性能优化”零散补丁。

---

## 13. 参考与证据说明

- 本文主体来自当前对话在“GitHub 扒仓库两轮战利品”之后的新增讨论，以及本次请求明确列出的整理范围。
- OpenAI 官方 [ChatGPT Work and Codex](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex) Help Center 明确说明：Chat 与 Work 位于 ChatGPT 下；Cloud Work 可在 Web、移动端与桌面端之间同步；本地聊天留在本机；Codex 仍是独立视图，其历史与 ChatGPT 历史分开。该页面只支持这些产品边界事实，不公开本文所列桌面性能实现细节。
- 所有关于 Mazz 的分层、Harness、故障矩阵和性能预算，均属于 **Post-W71 候选工程方案**，需要用原型、指标和故障测试验证后才能进入实现决策。

> 最终原则：先把语义、所有权、生命周期和验收条件写清楚，再写实现。同步正确性由收敛证据证明，桌面流畅度由长期预算证明，虚拟机和测试环境由 Harness 负责，而不是由人肉操作负责。
