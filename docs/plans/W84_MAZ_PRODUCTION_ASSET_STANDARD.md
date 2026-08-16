# W84 `.maz` Production Asset Standard
## Portable / Inspectable / Versioned Production Definition

> 状态：`DESIGN REGISTERED / POST-W71 / NOT APPROVED FOR IMPLEMENTATION`
> 版本：v0.1
> 登记日期：2026-08-16
> 来源：维护者《从内容网络、World、组织编译器到 .maz 生产资料标准》
> 原始 SHA-256：`79A1588A2971E134B6CEB1CFD02AC4D27AB4981968A0E46285DEA0EE3D039408`
> 跨波次真源：`C:\Users\Administrator\Downloads\交付区\Mazz 当前未落地全景-W71归并版.md`

## 0. 先承认当前现实

仓库现有 `.maz` 不是统一标准，而是至少两种同扩展名协议：

```text
Plugin .maz
zip { plugin.json, main.js, ... }
renderer/plugins/loader.js 会动态 import 代码

Factory style .maz
zip { definition.json, prompt.txt, meta.json,
      rules/checks.json? }
renderer/modules/factory/maz.js 导入为自定义文体
```

因此 W84 不是“给现有 `.maz` 多塞几个目录”。第一步必须冻结探测、身份、Profile、信任和迁移协议，保证旧插件与旧文体包继续可识别；在此之前不得宣布 `.maz v1`。

## 1. 上位定义

`.maz` 升格候选为：

> Portable / Inspectable / Versioned Production Asset，保存 Production Definition，不保存 Runtime Instance State。

```text
animation-short.maz     definition / factory drawing
Workspace Run #1872     runtime instance / production site
```

四条核心不变量：

```text
Definition != Runtime Instance
Semantic Identity != File Path
Seat != Model != Provider != Harness
Rebuildable Cache != Source of Truth
```

附加不变量：Secrets、绝对路径、私人 Runtime History 不进包；embedding、search index、thumbnail 和编译缓存不作为真相。

## 2. Profile，而不是一个万能 schema

候选 Profile：

```text
kind: plugin          现有可执行插件兼容层
kind: template        轻量模板/现有文体包兼容层
kind: workflow        Workflow + Artifact/Gate contract
kind: organization    Workflow + Seats + Authority
kind: world           Canon + Rules + State definition
kind: toolpack        Capability adapter definition / assets
kind: bundle          显式组合多个 profile
```

共享的是容器身份、版本、依赖、权限、完整性和 provenance；每种 Profile 有自己的必需目录与 validator。`bundle` 不允许绕过子 Profile 的权限和签名。

## 3. 候选目录结构

```text
manifest.json

blueprint/
workflow/
seats/
gates/
authority/
constraints/
routing/
schemas/
instructions/
scripts/
assets/
tests/
quality/
provenance/
integrity/
```

- `manifest`：semantic id、version、kind、能力需求、依赖、权限、入口和兼容区间；
- `blueprint`：Goal 与 input/output schema；
- `workflow`：Definition state machine、恢复与迁移，不含活跃 Run；
- `seats`：职责与边界，不绑定 Model/Machine；
- `gates`：deterministic/AI/external/human gate 定义；
- `authority`：修改、签发、破坏性动作与 Promotion 权限；
- `constraints`：locks、scope、budget、risk；
- `routing`：Capability requirement 与派工策略；
- `schemas`：Artifact Contract；
- `instructions`：Seat 内执行说明，Prompt 只在这里占一席；
- `scripts`：确定性工具，默认不可信且不自动执行；
- `assets`：示例、参考与训练资产，必须有许可和来源；
- `tests`：conformance fixtures；
- `quality`：匿名、可撤回的汇总履历，不含私人 Run；
- `provenance`：来源、Fork、supersedes 与 migration；
- `integrity`：内容 hash、签名、签名范围和算法版本。

目录是候选语义，不是已经批准的 ZIP 物理格式。W84a 必须先用 fixtures 证明 Profile/identity/migration，再冻结 layout。

## 4. 身份、依赖与完整性

`semanticId` 在复制、重命名和不同 Hub URL 间保持；file hash 标识具体字节版本，不能替代 semantic identity。依赖必须声明：

```text
packageId / version range / profile
required capability / permission / license
optional vs required
resolution lock / source / integrity
```

签名只证明签名者对某些字节负责，不证明包安全、正确或获得 Canon/Authority。Fork 默认新 semantic identity，并保留 `derivedFrom`。

## 5. 安全与执行权

当前 plugin `.maz` 可动态 import 代码，属于高风险兼容 Profile。未来统一容器必须把“可查看”和“可执行”分开：

- 导入、检查 manifest、列目录、验证 hash 不需要执行权；
- scripts/plugin main 必须显式信任、逐权限授权并在 hash 变化后重新确认；
- organization/world/template Profile 默认不可执行；
- 包不能通过 `kind` 伪装获得更高权限；
- 安装、启用、运行、网络、文件、进程和外部工具分别授权；
- 不可信包的 conformance test 不能在产品主进程内裸跑。

W84 不替代 W71 插件安全 Gate；现有插件在权限沙箱完成前仍保持 Preview。

## 6. 与现有波次的边界

| 波次 | W84 消费 / 提供 | 禁止混写 |
|---|---|---|
| W72 Asset Identity | semantic id、version、provenance、Capability refs | `.maz` 不建 Universal Asset DB |
| W73 Factory Runtime | 消费 Definition，产生 Run/State/Ledger | Runtime Instance 不回塞 Definition 包 |
| W74c Promotion | 私有 Definition 到公开 Workflow/World Publication | 导入不等于发布 |
| W79 Tool Capability | toolpack/Capability 声明 | 打包工具不等于揉入工具源码 |
| W82 Organizational Compiler | organization/workflow Profile | `.maz` 不执行 Compiler/Runtime |
| W69m | 公共 package projection、发现、Fork | Hub 不成为包或资产唯一真相 |

## 7. 施工拆波

### W84a — Legacy Census & Profile Detection

冻结现有 plugin/style 两种 fixture、无执行探测、冲突提示、Profile discriminator 和版本策略。

### W84b — Common Envelope & Inspect-only Reader

实现 semantic identity、manifest、integrity、provenance、dependency 和权限只读检查；坏包、炸弹、路径穿越、重复项与大小上限纳入 Gate。

### W84c — Template / Workflow / Organization Profiles

先覆盖不执行代码的 Definition profiles；往返保留未知字段，版本不支持时明确拒绝或只读打开。

### W84d — Legacy Migration & Trust Boundary

旧文体包可迁移为 template；旧插件保留隔离兼容路径。迁移先预览 diff，原包不覆盖；插件不可因“统一格式”自动获得信任。

### W84e — Import / Export / Fork / Sign

完成可复验导入导出、semantic Fork、依赖锁、签名验证和离线迁移；再与 W69m Promotion 对接。

## 8. Hard Validation Sample G

```text
legacy style .maz + legacy plugin .maz
→ inspect without execution
→ identify two profiles correctly
→ migrate style to template profile
→ import a minimal organization profile
→ export / rename / copy / reimport
→ same semantic identity and byte-version evidence
→ fork to new identity
→ reject tampered signature and forbidden absolute path
```

退出条件：旧包不误判、不执行；Definition/Run 不混；迁移不覆盖原件；unknown profile 可安全检查；危险脚本无授权不运行；往返/Fork/篡改/坏包均有确定证据。

## 9. 永久禁区

```text
× 把现有两个不兼容 .maz 假装成同一 v1
× 导入 = 安装 = 启用 = 执行
× Definition 包保存活跃 Run / 私人履历 / secret / 绝对路径
× 文件路径或 Hub URL 充当 semantic identity
× cache / embedding / search index 充当 source of truth
× bundle 绕过子 Profile 权限
× 签名 = 安全 / 正确 / Canon / Authority
× 为追求统一强制所有 Profile 使用同一目录全集
```

## 10. 当前停止线

本文件只登记 W84 v0.1 与现有双 `.maz` 冲突。W71 内不得改扩展名语义、迁移用户包、扩大插件执行权、实现统一 loader 或发布所谓 `.maz v1`。
