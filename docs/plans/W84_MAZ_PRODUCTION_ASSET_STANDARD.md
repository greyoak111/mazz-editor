# W84 `.maz` Production Asset Standard
## Portable / Inspectable / Versioned Production Definition

> 状态：`DESIGN REGISTERED / POST-W71 / NOT APPROVED FOR IMPLEMENTATION`
> 版本：v0.2
> 登记日期：2026-08-16
> 来源：维护者《从内容网络、World、组织编译器到 .maz 生产资料标准》
> 原始 SHA-256：`79A1588A2971E134B6CEB1CFD02AC4D27AB4981968A0E46285DEA0EE3D039408`
> 严格增量 II：维护者《Secure Production Assets / Expert Capability Encoding》，SHA-256 `98EDCEBFE850836AD9ED96AC3D99F9C43BAD72BC6E5EFE22D547871CDCE450C0`
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
package.index.json

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
rights/
crypto/
payload/
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
- `package.index`：公开列出 block、profile、字节范围、加密状态和依赖，不泄露 sealed payload 明文；
- `rights`：License 引用、Entitlement requirement、发行与设备/组织授权策略；
- `crypto`：算法协商、Content Key envelope、recipient/org key reference 与轮换元数据；
- `payload`：允许逐 block 明文或加密；加密模块的位置、输入输出契约和权限必须公开可见。

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

## 6. Security & Rights Plane

可商业流通的 `.maz` 必须把四件事分开：

```text
Integrity    包是否被篡改
Signature    谁对哪些字节负责
Encryption   谁能读取哪些 Payload
Entitlement  谁当前获准使用哪些能力
```

`License != Entitlement != Encryption`：License 是法律权利，Entitlement 是运行时技术授权；签名不证明安全，拿到密钥也不自动获得执行权限。

候选物理模型采用 Public Envelope + Encrypted Payload，而不是整个包做密码 ZIP：manifest、索引、版本、依赖、权限声明、签名和密文 hash 可公开；Workflow internals、Seat Policy、Expert Rules、Training Assets、Private Scripts 等可逐 block 加密。由此实现“可发现、可验证、可分发，但未必可读取”。

Payload 候选采用 envelope encryption：每个内容版本只加密一次，用户、组织或设备只增加小型 Key Envelope。标准冻结语义、算法协商和轮换，不永久锁死单一算法。Ciphertext 可经 Hub、P2P、NAS 或 CDN 缓存与 Seed；拥有字节不等于拥有使用权。

```text
Distribution Right != Usage Right
Decrypt Right != Runtime Permission
```

解密后仍必须通过文件、网络、Shell、外部进程、设备和 Secret 的独立 Runtime Permission Gate。DRM 目标限于防无意泄露、普通复制、静态/传输窃取并支持商业授权；不承诺对能在本机解密执行的高级攻击者“永不可提取”。

## 7. Expert Capability Asset / Sealed Capability

`.maz` 资产化的不是统一风格，而是能力的可表达、可调用、可验证和可组合接口：

```text
Expert Capability
├─ input attention
├─ decision / negative knowledge
├─ Artifact Contract / Review Criteria
├─ exception / routing policy
├─ examples / failure experience
└─ Authority boundary
```

Director A 与 Director B 可以形成不同资产；标准不能把创造力压成同一种模板。兼容的 Artifact Contract、Seat Boundary、Authority 和 Capability Interface 允许多个专家能力被 W82 重组为生产组织。

`Sealed Capability` 允许公开 Capability Contract、Input、Output、Evidence、Authority 和 sealed module 位置，同时隐藏内部规则。执行可位于本地隔离模块、企业内网、Remote Service 或硬件隔离环境；不可审计部分必须显式标识，不能伪装成透明能力。

生产史是能力资产的长期价值层，但原始 W73 Production Ledger 不进包。`.maz` 只允许携带带 metric-definition version、样本量、证据引用和签名的汇总投影，例如 Acceptance/Revision/Human Attention/Landed Cost/Failure Distribution/Compatible Worker Profile；不得反向泄露用户私有 Run。

## 8. 与现有波次的边界

| 波次 | W84 消费 / 提供 | 禁止混写 |
|---|---|---|
| W72 Asset Identity | semantic id、version、provenance、Capability refs | `.maz` 不建 Universal Asset DB |
| W73 Factory Runtime | 消费 Definition，产生 Run/State/Ledger | Runtime Instance 不回塞 Definition 包 |
| W74c Promotion | 私有 Definition 到公开 Workflow/World Publication | 导入不等于发布 |
| W79 Tool Capability | toolpack/Capability 声明 | 打包工具不等于揉入工具源码 |
| W82 Organizational Compiler | organization/workflow Profile | `.maz` 不执行 Compiler/Runtime |
| W69m | 公共 package projection、发现、Fork、Entitlement delivery | Hub 不成为包/权利唯一真相，分发不自动授予使用权 |

## 9. 施工拆波

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

### W84f — Security & Rights / Sealed Capability

冻结 Public Envelope、encrypted block、Key Envelope、License/Entitlement、密钥轮换、离线宽限和撤销语义；证明 inspect/distribute/decrypt/execute 四阶段分权。先用不可执行 fixture 验证，禁止在 W71 或未经批准的 Marketplace 中接真实支付、账号或远程执行。

## 10. Hard Validation Sample G

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

## 11. Hard Validation Sample J — Secure Production Asset

```text
public manifest + partially encrypted workflow
→ inspect/index/verify without plaintext
→ distribute identical ciphertext through HTTP + P2P cache
→ issue User/Org Key Envelopes
→ decrypt only entitled blocks
→ deny execution until independent Runtime Permission Gate
→ rotate/revoke entitlement without rewriting large ciphertext
→ invoke a sealed review capability and retain signed evidence
→ export only aggregated quality record, never raw Production Ledger
```

退出条件：未授权节点能缓存但不能读；License/Entitlement/Encryption/Permission 不混写；密文、签名和公开索引均可独立验证；sealed 位置与契约可见；离线、过期、撤销、时钟异常和密钥丢失进入明确状态；任何失败不泄露 plaintext、secret 或私人 Run。

## 12. 永久禁区

```text
× 把现有两个不兼容 .maz 假装成同一 v1
× 导入 = 安装 = 启用 = 执行
× Definition 包保存活跃 Run / 私人履历 / secret / 绝对路径
× 文件路径或 Hub URL 充当 semantic identity
× cache / embedding / search index 充当 source of truth
× bundle 绕过子 Profile 权限
× 签名 = 安全 / 正确 / Canon / Authority
× 为追求统一强制所有 Profile 使用同一目录全集
× License = Entitlement = Encryption
× 拿到 Ciphertext / Key = 获得运行权限
× 不透明模块伪装成完整可审计能力
× 为不可破解 DRM 牺牲离线、可恢复和合法用户控制权
× 把原始 Production Ledger 或用户私人事故记录打入商业包
```

## 13. 当前停止线

本文件只登记 W84 v0.2、现有双 `.maz` 冲突、Security & Rights Plane 与 Expert/Sealed Capability 契约。W71 内不得改扩展名语义、迁移用户包、扩大插件执行权、实现统一 loader/加密/授权/Marketplace，或发布所谓 `.maz v1`。
