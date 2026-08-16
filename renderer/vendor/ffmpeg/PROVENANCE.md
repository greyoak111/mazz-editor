# ffmpeg.wasm Vendored Runtime Provenance

> Status: `PARTIAL / RELEASE BLOCKER UNTIL COMPLETED`
> Recorded: 2026-08-16

## Files and fixed hashes

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

## Known use

The runtime is loaded lazily by `renderer/lib/ffmpeg-transcode.js` for local media conversion. It is a real product runtime, not a development fixture, and must remain in packaged builds unless the feature is explicitly removed.

## Evidence still missing

```text
wrapper package/version for the vendored esm files
full GPL-2.0-or-later license text and component notices in the final distributable
a durable corresponding-source archive or download mechanism for the shipped `v0.12.10` core payload
verification that the source delivery remains available for the required compliance period
documented release procedure that keeps binary, source offer and hashes together
```

The byte identity, npm metadata and live `--enable-gpl` configuration close the former classification uncertainty. They do **not** by themselves complete GPL distribution compliance. Do not close the W71 licensing gate until the final installer includes the required license/notices and the corresponding-source delivery path has been built and tested.
