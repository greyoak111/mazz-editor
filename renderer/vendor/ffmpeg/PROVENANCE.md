# ffmpeg.wasm Vendored Runtime Provenance

> Status: `DEFERRED / CORE NOT DISTRIBUTED IN SEALED BUILD`
> Recorded: 2026-08-16

## Historical core files and fixed hashes

| File | SHA-256 |
|---|---|
| `ffmpeg-core.js` | `B642482AC79F8F619DD06DE77A557EECA6390E4F4E80C8A709EC1E7E9091E876` |
| `ffmpeg-core.wasm` | `9F57947A5BD530D8F00C5B3F2CB2A3492FAA7E5D823315342D6A8656D0A6B7B7` |
| `esm/const.js` | `F2BD8D9AD542BB6B693AA31770B1460686F2A2C8E687D474F10D67C7098FC3E3` |

`esm/const.js` declares `CORE_VERSION = "0.12.6"` and the candidate upstream URL `https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js`.

## Candidate comparison (2026-08-15)

The fixed npm artifact `@ffmpeg/core@0.12.6` was acquired and hashed:

| Candidate artifact | SHA-256 | Vendored match |
|---|---|---|
| npm tarball | `9812C82188E8CA434A3D0E9EDC2435458B55DF0CE3F700A8DF867C22EC8A8CED` | n/a |
| `dist/umd/ffmpeg-core.js` | `A34873964B0F62AEC516BAC75E3AA9086EC3535D4D07F0269AA94EA748B6CB71` | **NO** |
| `dist/umd/ffmpeg-core.wasm` | `2390EFA7FB66E7E42DBAE15427571A5FFC96B829480904C30F471F0A78967F61` | **NO** |

The version constant therefore identifies an intended API/core version, but it does not prove that the vendored binaries came from that npm package. Do not replace the current binary merely to force a hash match without a media regression matrix; do not attribute the candidate package's build or license metadata to the current bytes.

## Recovered core identity (2026-08-16)

The later official npm packages `@ffmpeg/core@0.12.9` and `@ffmpeg/core@0.12.10` contain the same single-thread core payload. The current vendored core matches that payload:

| Evidence | Result |
|---|---|
| Official `0.12.10` npm tarball SHA-256 | `D00089CE82E1BDF637DDBE42E0C3D41A1BA8CF4C9E825E7FA4D0BB970E844BD4` |
| Official ESM `ffmpeg-core.wasm` SHA-256 | `9F57947A5BD530D8F00C5B3F2CB2A3492FAA7E5D823315342D6A8656D0A6B7B7` — **exact byte match** |
| Official ESM `ffmpeg-core.js` SHA-256 | `67A48F11645F85439F3FDE4F2119042C16B374B910206B7A7A24F342E28DCAE3` |
| JS comparison | identical after normalizing CRLF/LF and outer whitespace; the executable content is unchanged |
| Upstream repository/tag | `https://github.com/ffmpegwasm/ffmpeg.wasm`, `v0.12.10` |
| Tag commit | `c3a763857c5e615ae8674715ad5e4f63ff469e9d` |
| npm declared license | `GPL-2.0-or-later` |

The packaged runtime was also executed rather than identified from filenames. `W71_FFMPEG_RUNTIME.json` records:

```text
ffmpeg version 5.1.4
--enable-gpl
--enable-libx264
--enable-libx265
--enable-libvpx
--enable-libmp3lame
--enable-libass
...
```

It successfully converted a generated WAV specimen to MP3, terminated its worker/WASM instance, reloaded a fresh instance and ran `ffmpeg -version` again. The core must therefore be handled as **GPL-2.0-or-later**, not as an assumed LGPL-only FFmpeg build.

## Recovered wrapper identity (2026-08-16)

All six files under `esm/` match the official `@ffmpeg/ffmpeg@0.12.10` ESM distribution after normalizing CRLF/LF and outer whitespace:

```text
classes.js
const.js
errors.js
types.js
utils.js
worker.js
```

| Evidence | Result |
|---|---|
| Official npm tarball SHA-256 | `B2F2418BE6CC3C29A0765C1376EBFBFEA94073B287767460851A3CE487666D8F` |
| npm integrity | `sha512-lVtk8PW8e+NUzGZhPTWj2P1J4/NyuCrbDD3O9IGpSeLYtUZKBqZO8CNj1WYGghep/MXoM8e1qVY1GztTkf8YYQ==` |
| Declared license | `MIT` |
| Vendored match | six of six normalized matches |

The complete wrapper license is shipped as `LICENSE.wrapper-MIT`. The complete core license text is shipped as `COPYING.GPLv2`; `NOTICE.md` ties both components to their package coordinates and hashes.

## Current distribution decision

The historical core was loaded lazily by `renderer/lib/ffmpeg-transcode.js` for local media conversion. W71 C3 has now removed `ffmpeg-core.js` and `ffmpeg-core.wasm` from the current branch and added explicit electron-builder exclusions. The sealed installer does not distribute the GPL core. Viewer transcode, Player GIF export and Recorder mp4 conversion are Hidden by the central product-maturity policy; native playback, WebM recording and system-default open remain available.

The wrapper code, integration code, hashes and this provenance record remain as a future activation capsule. Reintroducing any core binary requires the corresponding-source Gate below; placing files back on disk is not approval.

## Evidence required before future activation

```text
a durable corresponding-source archive or download mechanism for the shipped `v0.12.10` core payload
the immutable commit set used for every build-time source input, including mutable refs in the upstream Dockerfile
rebuild or equivalent attestation tying that source set to the shipped core bytes
verification that the source delivery remains available for the required compliance period
documented release procedure that keeps binary, source offer and hashes together
```

The byte identity, wrapper identity, npm metadata, historical live `--enable-gpl` configuration and dedicated license files close the former classification, attribution and license-text uncertainty. They do **not** complete a future GPL binary distribution. `SOURCE_REPRODUCIBILITY.md` records why the current upstream tag cannot yet serve as a proven corresponding-source archive. The current sealed binary Gate is closed by non-distribution, not by claiming the missing source has been recovered.
