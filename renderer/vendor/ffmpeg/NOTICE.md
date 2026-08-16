# ffmpeg.wasm Runtime Notice

Mazz Editor retains an integration capsule for an optional WebAssembly media conversion runtime in this directory. The W71 sealed build does **not** ship the GPL core payload.

## JavaScript wrapper

The files under `esm/` are the ESM distribution of `@ffmpeg/ffmpeg@0.12.10`, byte-identical after normalizing line endings and outer whitespace. The package is licensed under the MIT License; see `LICENSE.wrapper-MIT`.

Official package evidence:

- npm package: `@ffmpeg/ffmpeg@0.12.10`
- npm tarball SHA-256: `B2F2418BE6CC3C29A0765C1376EBFBFEA94073B287767460851A3CE487666D8F`
- npm integrity: `sha512-lVtk8PW8e+NUzGZhPTWj2P1J4/NyuCrbDD3O9IGpSeLYtUZKBqZO8CNj1WYGghep/MXoM8e1qVY1GztTkf8YYQ==`
- upstream repository: `https://github.com/ffmpegwasm/ffmpeg.wasm`

## Historical core payload

The core audited before C3 was byte-identical to the official single-thread `@ffmpeg/core@0.12.10` payload; its JavaScript glue was identical after normalizing CRLF/LF and outer whitespace. The package declares `GPL-2.0-or-later`; historical packaged evidence reported FFmpeg 5.1.4 with `--enable-gpl` and GPL components including x264/x265. Those core files have been removed from the current branch and are explicitly excluded from sealed builds.

See `COPYING.GPLv2` for the complete GPLv2 text and `PROVENANCE.md` for hashes, runtime evidence and upstream coordinates.

## Corresponding source status

The upstream `v0.12.10` Dockerfile contains build-time Git references including mutable `lame@master` and `x264@4-cores`; the exact commits used for the published WASM have not been recovered from an immutable build attestation. See `SOURCE_REPRODUCIBILITY.md`.

The current sealed installer closes this blocker by not distributing the core. Do not reintroduce or distribute a core binary until the exact source inputs, build scripts and release-side source archive have passed the future activation gate.
