# Third-Party Notices

Mazz Editor includes npm/Electron dependencies and vendored runtimes governed by their own licenses. This file is an inventory pointer, not a replacement for those licenses.

## Runtime dependency inventory

The authoritative dependency versions are locked in `package-lock.json`. Run:

```text
npm run audit:provenance
npm run audit:release
```

The deterministic W72 provenance ledger records locked source artifacts and integrity values, declared licenses, local package patches, dependency overrides, required evidence files, vendored hashes and deferred activation gates. The release baseline then links that ledger to the actual packaged specimen. Neither report is a legal opinion or a substitute for reviewing the license texts and distribution obligations.

Important direct runtime dependencies include:

| Component | Declared license / handling |
|---|---|
| Electron | MIT; Chromium and bundled components carry additional notices |
| node-pty | MIT; native ABI must be verified in the packaged Windows specimen |
| WebTorrent and native helpers | MIT-family dependencies; packaged native binaries require inventory |
| libass-wasm | Compound license set declared by the package; its `dist/js/COPYRIGHT` must remain available |
| ffmpeg.wasm optional integration | `@ffmpeg/ffmpeg@0.12.10` wrapper (MIT) is retained; the historical `@ffmpeg/core@0.12.10`-identical GPL core is not present in the current branch or sealed installer; see `renderer/vendor/ffmpeg/NOTICE.md` and `PROVENANCE.md` |
| Monaco Editor | MIT |
| ECharts | Apache-2.0 |

## Optional external capability providers

Mazz can detect and invoke independently installed external tools through a bounded Adapter protocol. These tools are not included in the Mazz installer and remain governed by their own licenses and installation terms.

| Provider | Boundary |
|---|---|
| Blender | GPL-3.0-or-later; optional independent installation; Mazz does not bundle, download, install or update Blender. The W79 Adapter uses Blender's headless command line and a Mazz-owned render script only after a local version probe succeeds. |

Unresolved release evidence:

- The former `buffers@0.1.1` blocker is closed by a scoped `exceljs > unzipper@0.12.3` override. The unlicensed `buffers` and legacy `binary` packages are absent from the locked runtime graph; XLSX roundtrip/export regression tests pass.
- Historical ffmpeg wrapper/core identities and runtime configuration were recovered. Because the upstream build uses mutable refs whose original release commits have not been attested, W71 C3 removed the GPL core from the current branch and sealed installer and hid all dependent product controls. The current binary release blocker is therefore closed by non-distribution; future reactivation still requires an exact rebuildable source archive and durable delivery mechanism. See `renderer/vendor/ffmpeg/SOURCE_REPRODUCIBILITY.md`, `docs/engineering/evidence/W71_LICENSE_AUDIT.json` and `docs/engineering/evidence/W71_FFMPEG_RUNTIME.json`.

## Release rule

No release may mark the licensing gate closed solely because this summary exists. The final installer must be audited against its actual `app.asar` and `app.asar.unpacked` contents, and every shipped native or vendored runtime must have an identified version, source, hash, license and required notice/source-offer material.
