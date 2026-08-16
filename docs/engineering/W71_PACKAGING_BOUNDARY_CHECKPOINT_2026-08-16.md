# W71 Windows 发布物边界检查点

> 日期：2026-08-16
> 前置提交：`main@2ba3cce`
> 范围：仅收口 packaged source map；不宣称安装、签名、升级或完整体积优化已经结束

## 1. 根因

既有构建规则只排除了：

```text
renderer/dist/**/*.map
renderer/vendor/**/*.map
```

这能清除渲染层自产 map，却没有覆盖生产依赖随包携带的 map。对 `2ba3cce` 重建的 `app.asar` 做逐项提取计数后，发现：

| 指标 | 修复前 |
|---|---:|
| `app.asar` source map | 388 |
| map 原始字节合计 | 70,344,542 |
| `app.asar` | 360,465,697 bytes |
| `win-unpacked` | 667,726,899 bytes |

主要来源是 ECharts、ExcelJS、web-streams-polyfill、WebTorrent、xterm、SheetJS 和 zrender；其中仅 ECharts map 就超过 33 MiB。这些文件不参与运行。

## 2. 最小改动

构建规则增加：

```text
!node_modules/**/*.map
```

没有删除开发树中的 source map，没有 prune 开发依赖，也没有改变模块版本。`scripts/release-audit.js` 同时升级为对 `app.asar` 内 map 逐文件计数、计字节，契约把 packaged source map 固定为零。

## 3. 重建结果

| 指标 | 修复前 | 修复后 | 变化 |
|---|---:|---:|---:|
| `app.asar` source map | 388 | **0** | -388 |
| map 原始字节合计 | 70,344,542 | **0** | -70,344,542 |
| `app.asar` | 360,465,697 | **290,083,965** | -70,381,732 |
| `app.asar` entries | 9,863 | **9,473** | -390 |
| `win-unpacked` | 667,726,899 | **597,387,265** | -70,339,634 |
| NSIS installer | 150,813,568 | **141,028,503** | -9,785,065 |

发布目录递归检查同时确认 `.map = 0`、`.pdb = 0`；`app.asar` 内测试目录条目为 0。根级 `LICENSE`、`NOTICE`、`THIRD_PARTY_NOTICES.md` 仍在。

## 4. 回归

```text
W71 release-foundation contract：4/4
packaged smoke：PASS
20 次 lifecycle：PASS，活动资源回到基线
ffmpeg packaged load/transcode/dispose/reload：PASS
```

## 5. Gate 结论

```text
packaged source maps：CLOSED
packaged PDB：PASS（0）
packaged test directories：PASS（0）
installer size/hash：PASS（141,028,503 bytes；SHA-256 D178BFC98310233781BDB43E885A4963FCD3EF83A6958C5CCE8831A59620D4D1）
code signing：OPEN（当前构建明确记录 no signing info，未伪装为已签名）
签名 / clean install / upgrade / uninstall：OPEN
native ABI 异机证明：OPEN
进一步依赖去重或功能裁剪：未授权、未执行
```

本检查点说明“开发资产没有继续泄漏进当前 installer/unpacked specimen”，不等于发布工程已经封板。仍须取得代码签名，并跑 clean install、首次启动、覆盖升级、卸载和用户数据保留矩阵。
