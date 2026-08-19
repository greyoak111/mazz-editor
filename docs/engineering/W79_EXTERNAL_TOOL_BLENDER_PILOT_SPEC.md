# W79 External Tool Capability / Blender Headless Pilot

> 日期：2026-08-19
>
> 状态：`RUNTIME LANDED / PACKAGED CONDITIONAL GATE PASS / REAL BLENDER ACTIVATION BLOCKED_TOOL_NOT_INSTALLED`
>
> 前置：W66 Foundation `c5779a1`、W72d External Tool Adapter v0、W71 生命周期/许可地基

## 1. 决议

W79 的首个 Pilot 是独立安装的 Blender Headless Capability Provider。Mazz 不嵌入 Blender 核心、不复制 Blender UI、不下载或安装 Blender，也不把 renderer 传入的数据解释成 shell command。当前主机没有 Blender，因此本波关闭运行时和 packaged 条件门，真实 Blender 出图门保持条件阻塞。

状态必须分开：

```text
W79 Runtime / Protocol Consumer      LANDED
Packaged success/failure/cancel      PASS（固定 fixture）
Host capability probe               PASS（明确未安装）
Real Blender render                 BLOCKED_TOOL_NOT_INSTALLED
```

“未安装时能正确降级”不等于“真实 Blender 已激活”。未来只有用户自行安装 Blender 后，才能补真实版本、真实 `.blend`、真实 PNG、20 轮和应用退出证据。

## 2. 运行时边界

主进程新增独立 `ExternalToolService`，只登记满足 `mazz.external-tool-adapter/v0` 的 Adapter：

```text
externalTool:list
externalTool:probe
externalTool:run
externalTool:cancel
externalTool:dispose
```

IPC 传输以 `adapterId + frozen request` 选择已登记实现。Adapter 仍只有 W72d 冻结的 `probe/run/cancel/dispose` 四个生命周期方法；Service 不取得 Agent Session、Factory Router、Capability Registry、重试/成本/审批或任意 CLI 权力。

唯一已登记实现：

```text
adapterId = blender.headless.v0
toolId = org.blender.Blender
operation = scene.render.frame/v0
```

## 3. 命令与资产契约

`scene.render.frame/v0` 只接受：

- 一个 `role=scene / type=application/x-blender / *.blend` 输入；
- 一个 `role=frame / type=image/png / *.png` 预声明输出；
- 显式 `runId`、`workdir`、Asset id/version 与 provenance。

真实 argv 只能由 Adapter 生成：

```text
blender --background <scene.blend>
        --python <Mazz-owned mazz_render_frame.py>
        -- <declared-output.png>
```

renderer 无法传 `command`、`shell`、`env`、任意 Python 或 Blender 参数。Mazz-owned Python 脚本只读取单一预声明输出路径，使用当前 `.blend` 的当前帧写 PNG；脚本在 packaged 构建中从 `app.asar.unpacked` 提供给外部进程。

## 4. 路径与副作用 Gate

1. `workdir` 必须位于当前 Mazz Workspace 的真实根路径内；仅声明任意 `C:\` 或用户目录不能获得执行权。
2. 输入/输出路径必须相对 workdir，解析后仍在根内；绝对路径和 `..` 越界在 spawn 前拒绝。
3. workdir、输入和已存在父目录不得是逃逸 symlink/reparse path；输入必须是普通文件。
4. 已存在输出一律拒绝，Adapter 不覆盖用户文件。
5. Blender 未安装、协议错误或路径错误时不创建输出目录、不启动 render process。
6. 失败/取消产生的 partial output 保留为 `.partial-<runId>`，Terminal Result 回供相对路径；不以失败名义静默删除证据。

## 5. 生命周期与结果

外部工具使用独立 `CliSupervisor` 配置：

```text
resourceType = external-tool-process
handleOwnerTool = external-tool-supervisor
shell = false
windowsHide = true
bounded stdout/stderr
timeout = 10 minutes
Windows cancel = taskkill /PID /T /F + 1s bounded settle fallback
```

默认 W66 Supervisor 行为不变。W79 只复用经过验证的进程捕获实现，通过不同 Typed Handle owner 和 ResourceLedger type 保持归属分离。应用 before-quit 同时等待 Harness 与 External Tool dispose，并受既有 5 秒总退出上限保护。

成功必须同时满足：exit code 0、预声明文件真实存在、非空、PNG magic 正确。随后计算 SHA-256 并登记：

```text
id = asset:sha256:<hash>
version = sha256:<hash>
```

外部工具自报成功但缺文件/错类型时返回 `failed`，不能进入 Asset 真相层。

## 6. 探测、分发与许可

- 只探测 PATH、显式测试注入和 Windows 标准 `C:\Program Files\Blender Foundation\*\blender.exe`；probe 运行 `--version`。
- Blender 标记为 `GPL-3.0-or-later / independent-user-installation / bundledWithMazz=false`。
- Mazz 不分发 Blender 二进制、Python runtime 或 Blender 许可证副本；用户安装与升级不属于 W79 v0。
- fixture 只用于合同与 packaged 生命周期验证，不能冒充真实 Blender。
- Mazz-owned `mazz_render_frame.py` 随 MIT 产品分发；它只有在用户的外部 Blender 进程中运行。

## 7. W79 子波与当前 Gate

| 子波 | 结果 | 证据 |
|---|---|---|
| W79a External Tool Process Runtime | COMPLETE | 独立资源类型、Typed Handle owner、bounded output、timeout、cancel/dispose、应用退出 |
| W79b Blender Headless Adapter | COMPLETE TO CONTRACT | 固定 operation/argv、Workspace 根、输入输出验真、partial policy、许可边界 |
| W79c Packaged Conditional Gate | PASS | 未安装真实降级 + fixture 20 轮/失败/取消/重复取消/资源 `0→0` |
| W79d Real Blender Activation | BLOCKED | 当前主机 `BLENDER_NOT_INSTALLED`；未安装、未真实出图 |

机器证据：`docs/engineering/evidence/W79_PACKAGED_BLENDER_GATE_2026-08-19.json`。

## 8. 真实激活解除条件

用户自行安装 Blender 后必须重新构建当前分支并在 packaged Windows 中完成：

1. probe 输出真实 executable、Blender 完整版本与 provenance；
2. 使用人工可复核的最小 `.blend`，生成预声明 PNG，hash 与尺寸可复算；
3. 无效 `.blend`、Python 脚本缺失、输出只读、输出错类型和 timeout 均返回结构化失败；
4. 在真实渲染中取消，确认 Blender 与所有 child/grandchild 消失，partial policy 正确；
5. 20 轮真实成功/失败/取消混合循环后 `external-tool-process 0→0`；
6. 关闭窗口、退出应用和异常终止均无 Blender orphan；
7. 复核实际安装来源、版本与许可证边界，不把系统安装内容收入 Mazz 发布物。

上述七项未闭前，W79 不得标记 `REAL BLENDER ACTIVATED`，W82 动画样本也不得把 fixture 当作真实 Capability。

## 9. 明确不做

- 不安装、下载或自动升级 Blender；
- 不开放任意 command/shell/env/Python；
- 不制作 Blender UI Clone、嵌入 viewport 或接管 `.blend` 编辑；
- 不实现 W82 组织编译、W84 Toolpack、W86 物理生产 Runtime；
- 不因 packaged fixture 通过而宣称媒体生产链已完成。
