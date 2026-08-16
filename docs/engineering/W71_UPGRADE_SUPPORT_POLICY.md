# W71 Windows 升级支持策略

> 生效基线：Mazz Editor `0.2.0`
>
> 结论：**不伪造历史升级证据；从首个封板 specimen 开始建立可验证升级链**

## 1. 为什么本轮不做“0.1.0 → 0.2.0 已通过”声明

仓库中的 `0.1.0` 只出现在初始开发提交，没有与当前安装/许可/系统集成规则同等级的冻结 installer、hash、发布清单和验收记录。WIP tag 与历史 patch 也不是正式发布物。

把当前代码临时改成 `0.1.0` 再装一遍只能证明版本字符串变化，不能证明真实旧代码、旧注册表、旧 userData schema 和失败路径的升级。因此 W71 明确拒绝这种假绿。

## 2. 当前支持边界

```text
0.2.0 same-version reinstall / repair  = SUPPORTED / PROVEN
0.1.0 or WIP → 0.2.0 in-place upgrade = NOT CLAIMED
0.2.0 → future sealed version          = MUST PASS FUTURE UPGRADE GATE
downgrade / rollback                   = NOT CLAIMED
automatic updater                      = HIDDEN
```

安装器不得删除工作区或应用 userData；卸载只清理 Mazz 自有注册和产品文件。Windows UserChoice 不得写入或篡改。当前主机的同版本覆盖、五入口、正常退出、卸载与原 owner 恢复已有 schema v5 证据。

## 3. 下一版本的强制 Gate

未来首个声称“可从 0.2.0 升级”的版本，必须在同一自动化 run 中验证：

1. 从冻结 hash 的 0.2.0 installer 干净安装；
2. 建立真实 workspace、settings、snapshot、Library、Notes、插件信任和关联样本；
3. 覆盖安装新版本并核对版本、EXE、注册表与入口；
4. 用户数据与工作区逐项守恒，迁移幂等；
5. 模拟安装失败，旧版本仍可启动且原数据不被半迁移破坏；
6. 验证明确支持或明确不支持的回滚行为；
7. 正常退出、卸载和残留清单通过；
8. 固定旧/新 installer hash、证据 JSON 与 Known Limitations。

没有同时满足上述条件时，Updater 必须继续 Hidden，产品不得用“支持自动升级”措辞。
