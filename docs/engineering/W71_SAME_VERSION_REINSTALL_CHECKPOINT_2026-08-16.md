# W71 Windows 同版本覆盖安装检查点

> 日期：2026-08-16
>
> specimen：`release/Mazz Editor Setup 0.2.0.exe`
>
> 范围：同一 NSIS specimen、同一当前用户、同一隔离安装目录的第二次静默安装；这是 reinstall / repair rehearsal，不是跨版本 upgrade、downgrade 或 rollback

## 1. 结论

本机同版本覆盖安装子门禁为 **PASS**：

```text
clean install
→ 锁定原文件类型 owner backup
→ 同目录再次运行同一 installer
→ EXE / 卸载注册 / 协议 / 四类关联保持正确
→ 原 owner backup 未被 Mazz 自己覆盖
→ 覆盖后正式 EXE 完成 packaged smoke
→ silent uninstall 恢复原 owner 并清除全部 Mazz 私有状态
```

这关闭的是“重复安装会不会破坏可卸载性”的确定问题，不足以关闭跨版本升级 Gate。

## 2. 为什么必须单独验证

electron-builder 的文件关联宏会把安装前的默认 ProgID 写入 `${FILECLASS}_backup`。如果第二次安装直接把当前 Mazz ProgID 当作“旧 owner”覆盖进 backup，最终卸载可能恢复成已经不存在的 Mazz ProgID，留下自指残留。

本轮因此没有只检查 backup 值存在，而是逐项断言：

```text
第二次安装后的 backup value
===
第一次安装之前捕获的 default ProgID
```

`.md`、`.markdown`、`.txt`、`.mazz` 四类均通过。

## 3. 自动门禁变化

`npm run test:w71:installer` 现在执行：

1. 无既有 Mazz 安装/集成预检；
2. 隔离 clean install；
3. 首次注册和原 owner backup 精确断言；
4. 同一目录、同一 specimen 再安装一次；
5. 第二次安装后 EXE hash、卸载注册、五条集成命令与原 owner backup 复验；
6. 覆盖后的正式 EXE 完成 20 轮 packaged 生命周期，并由 Windows Shell 真分发协议/文件二实例；
7. silent uninstall；
8. 原默认值恢复，Mazz protocol、ProgID、backup、快捷方式、EXE 与测试目录归零。

机器证据升级为 [`W71_INSTALLER_CYCLE.json`](./evidence/W71_INSTALLER_CYCLE.json) schema v3，其中 `sameVersionReinstall` 是本轮新增的独立证据段。

## 4. 真机结果

| 项目 | 结果 |
|---|---:|
| 首次安装 exit code | 0 |
| 同版本第二次安装 exit code | 0 |
| 第二次安装后 EXE bytes/hash | 与首次安装一致 |
| 卸载注册 | 保持存在 |
| 原关联 owner backup | 4/4 保持首次安装前值 |
| `mazz://` + 四类关联命令 | 5/5 精确指向隔离 EXE |
| 覆盖后 packaged smoke | PASS |
| Windows Shell 协议/`.md` 分发 | PASS |
| 覆盖后 20 轮资源账 | 回到基线 |
| 最终卸载系统集成残留 | 0 |
| 最终产品/快捷方式/测试目录残留 | 0 |

## 5. 未关闭边界

- 0.1.x → 0.2.x 或后续真实旧版 → 新版覆盖升级；
- 安装内容、文件关联 schema、ProgID 或 appId 发生迁移的升级；
- 升级中断、磁盘不足、文件占用、权限失败后的恢复；
- downgrade 与 rollback；
- 默认用户数据在升级/卸载中的保留、迁移和显式删除；
- 签名安装器、SmartScreen、异机、多 Windows 版本和多用户安装。

因此准确口径是：

> **同一 0.2.0 specimen 的同目录重复安装、覆盖后运行与最终卸载 PASS；跨版本 Upgrade / Rollback Gate 继续 OPEN。**
