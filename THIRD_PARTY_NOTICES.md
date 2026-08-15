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
| ffmpeg.wasm vendored runtime | Build-dependent LGPL/GPL obligations; see `renderer/vendor/ffmpeg/PROVENANCE.md` |
| Monaco Editor | MIT |
| ECharts | Apache-2.0 |

## Release rule

No release may mark the licensing gate closed solely because this summary exists. The final installer must be audited against its actual `app.asar` and `app.asar.unpacked` contents, and every shipped native or vendored runtime must have an identified version, source, hash, license and required notice/source-offer material.
