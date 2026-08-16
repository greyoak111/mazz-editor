# Third-Party Notices

Mazz Editor includes npm/Electron dependencies and vendored runtimes governed by their own licenses. This file is an inventory pointer, not a replacement for those licenses.

## Runtime dependency inventory

The authoritative dependency versions are locked in `package-lock.json`. Run:

```text
npm run audit:release
```

The generated release baseline records every locked package for which npm metadata declares a license, plus packages whose license field is missing and therefore needs manual review.

Important direct runtime dependencies include:

| Component | Declared license / handling |
|---|---|
| Electron | MIT; Chromium and bundled components carry additional notices |
| node-pty | MIT; native ABI must be verified in the packaged Windows specimen |
| WebTorrent and native helpers | MIT-family dependencies; packaged native binaries require inventory |
| libass-wasm | Compound license set declared by the package; its `dist/js/COPYRIGHT` must remain available |
| ffmpeg.wasm vendored runtime | `@ffmpeg/ffmpeg@0.12.10` wrapper (MIT) plus `@ffmpeg/core@0.12.10`-identical core payload (GPL-2.0-or-later); see `renderer/vendor/ffmpeg/NOTICE.md` and `PROVENANCE.md` |
| Monaco Editor | MIT |
| ECharts | Apache-2.0 |

Unresolved release evidence:

- The former `buffers@0.1.1` blocker is closed by a scoped `exceljs > unzipper@0.12.3` override. The unlicensed `buffers` and legacy `binary` packages are absent from the locked runtime graph; XLSX roundtrip/export regression tests pass.
- The vendored ffmpeg wrapper and core identities are recovered, and the distributable now carries the complete GPLv2 and MIT texts plus component notice. Live runtime evidence reports FFmpeg 5.1.4 with `--enable-gpl`. The gate remains open only on the corresponding-source side: the upstream build uses mutable refs whose original release commits have not been attested, so an exact rebuildable source archive and durable delivery mechanism do not yet exist. See `renderer/vendor/ffmpeg/SOURCE_REPRODUCIBILITY.md`, `docs/engineering/evidence/W71_LICENSE_AUDIT.json` and `docs/engineering/evidence/W71_FFMPEG_RUNTIME.json`.

## Release rule

No release may mark the licensing gate closed solely because this summary exists. The final installer must be audited against its actual `app.asar` and `app.asar.unpacked` contents, and every shipped native or vendored runtime must have an identified version, source, hash, license and required notice/source-offer material.
