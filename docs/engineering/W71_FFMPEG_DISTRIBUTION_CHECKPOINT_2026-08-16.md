# W71 FFmpeg 分发证据检查点（2026-08-16）

> **后续状态：** 本文保留 C3 决策前的历史取证。当前权威结论是 W71 封板发行物不再分发 GPL core，相关子能力 Hidden；参见 `W71_RELEASE_LICENSING_CHECKPOINT_2026-08-16.md`。`OPEN_CORRESPONDING_SOURCE` 继续作为未来重新启用的 Activation Gate，不再阻塞不含 core 的首个 RC。

## 1. 结论

本检查点将 vendored ffmpeg.wasm 的发布风险从一个混合的“来源/许可未知”拆成三个可独立验收的 Gate：

| 子 Gate | 结果 | 证据 |
|---|---|---|
| JavaScript wrapper 身份与许可 | **PASS** | 六个 `esm/` 文件与 `@ffmpeg/ffmpeg@0.12.10` 在换行及外层空白归一后全部相同；MIT 全文随包 |
| Core 身份、分类与许可文本 | **PASS** | WASM 与 `@ffmpeg/core@0.12.10` 逐字节相同；运行时为 FFmpeg 5.1.4、`--enable-gpl`；GPLv2 全文随包 |
| Core 对应源码可重建与持久交付 | **BLOCKED / OPEN** | 上游 `v0.12.10` 构建脚本含 `x264#4-cores`、`lame#master` 等可变引用，尚无原始发布构建的不可变 commit attestation |

因此，W71 的 FFmpeg 发布许可总 Gate 仍为：

```text
OPEN_CORRESPONDING_SOURCE
```

本轮关闭的是身份、分类、完整许可文本和最终发布物携带证据；没有把“上游 tag 可见”冒充成“精确对应源码已经闭环”。

## 2. 本轮落盘

发布物现在包含：

```text
renderer/vendor/ffmpeg/COPYING.GPLv2
renderer/vendor/ffmpeg/LICENSE.wrapper-MIT
renderer/vendor/ffmpeg/NOTICE.md
renderer/vendor/ffmpeg/PROVENANCE.md
renderer/vendor/ffmpeg/SOURCE_REPRODUCIBILITY.md
```

`COPYING.GPLv2` 已与 FFmpeg `n5.1.4` 官方文本按 CRLF/LF 归一后完整一致，其发布字节 SHA-256 为：

```text
8177F97513213526DF2CF6184D8FF986C675AFB514D4E68A404010521B880643
```

wrapper 的官方 npm tarball SHA-256 为：

```text
B2F2418BE6CC3C29A0765C1376EBFBFEA94073B287767460851A3CE487666D8F
```

`scripts/release-audit.js` 已升级到 schema v2，不只检查根 `LICENSE/NOTICE`，还会从真实 `app.asar` 抽取上述五份 FFmpeg 材料，记录每份的存在性、大小和 SHA-256。

## 3. 最终 Windows specimen

本轮重建：

| 项 | 结果 |
|---|---:|
| installer | `release/Mazz Editor Setup 0.2.0.exe` |
| installer bytes | `141,036,193` |
| installer SHA-256 | `6F816396A4D09F5C9304017D21DA34F879CEFD08E11D168191411F19295011C2` |
| `win-unpacked` bytes | `597,414,446` |
| `app.asar` bytes | `290,111,146` |
| `app.asar` entries | `9,477` |
| source maps | `0` |
| unpacked native binaries | `10` |
| FFmpeg 专用材料 | `5/5` present，均有 SHA-256 |

完整机器证据见 [`W71_RELEASE_BASELINE.json`](./evidence/W71_RELEASE_BASELINE.json) schema v2 和 [`W71_LICENSE_AUDIT.json`](./evidence/W71_LICENSE_AUDIT.json) schema v2。

## 4. 运行与回归证据

```text
W71 release foundation contract     5/5 PASS
packaged smoke                       PASS
20-cycle lifecycle matrix            PASS
FFmpeg packaged load                 PASS
generated WAV -> MP3                 PASS
terminate -> reload -> version       PASS
```

运行证据仍明确记录：

```text
exactSourceAndBuildRecipeRecovered = false
releaseLicenseGate = OPEN
```

## 5. 为什么对应源码仍不能关闭

上游 `ffmpegwasm/ffmpeg.wasm` 的 `v0.12.10` tag（commit `c3a763857c5e615ae8674715ad5e4f63ff469e9d`）确实保存了 Dockerfile、Makefile、bindings 和构建脚本，并固定 Emscripten 3.1.40 与 FFmpeg `n5.1.4`。但其中部分依赖通过可变 Git ref 获取：

```text
ffmpegwasm/x264#4-cores
ffmpegwasm/lame#master
sekrit-twc/zimg#release-3.0.5
```

2026-08-16 观察到的远端 head 只能证明“现在指向哪里”，不能证明 npm 0.12.10 发布时采用了哪些 commit。若直接用当前 head 打包，只能得到一个看似合理的源码集合，不能证明它对应现有二进制。

关闭该 Gate 至少需要：

1. 找回全部构建输入的不可变 commit 或等价构建 attestation；
2. 归档源码、bindings、patches、构建脚本与工具链坐标；
3. 建立 binary-to-source manifest 和 archive SHA-256；
4. 重建到可解释等价，或取得足以连接源码与已发布字节的可信证明；
5. 把源码包与 installer 联动发布并验证可下载；
6. 将可用性保留要求写入 release checklist。

## 6. 参考坐标

- GNU GPLv2：<https://www.gnu.org/licenses/gpl-2.0.html>
- FFmpeg 法律与许可说明：<https://ffmpeg.org/legal.html>
- ffmpeg.wasm 官方仓库：<https://github.com/ffmpegwasm/ffmpeg.wasm>
- ffmpeg.wasm 官方 LICENSE：<https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/LICENSE>

这些链接用于工程审计定位，不替代针对实际分发方式的法律意见。

## 7. Stopline

- 不得将 `v0.12.10` tag 本身表述为完整 corresponding source。
- 不得用审计日的 branch head 伪造发布日 build input。
- 不得因为许可证全文已进 installer 就把 FFmpeg 总 Gate 改为 CLOSED。
- 在对应源码闭环前，不得把当前 specimen 标成可公开封板发布物。
