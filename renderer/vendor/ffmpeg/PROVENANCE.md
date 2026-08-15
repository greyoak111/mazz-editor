# ffmpeg.wasm Vendored Runtime Provenance

> Status: `PARTIAL / RELEASE BLOCKER UNTIL COMPLETED`
> Recorded: 2026-08-15

## Files and fixed hashes

| File | SHA-256 |
|---|---|
| `ffmpeg-core.js` | `B642482AC79F8F619DD06DE77A557EECA6390E4F4E80C8A709EC1E7E9091E876` |
| `ffmpeg-core.wasm` | `9F57947A5BD530D8F00C5B3F2CB2A3492FAA7E5D823315342D6A8656D0A6B7B7` |
| `esm/const.js` | `F2BD8D9AD542BB6B693AA31770B1460686F2A2C8E687D474F10D67C7098FC3E3` |

`esm/const.js` declares `CORE_VERSION = "0.12.6"` and the candidate upstream URL `https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js`.

## Known use

The runtime is loaded lazily by `renderer/lib/ffmpeg-transcode.js` for local media conversion. It is a real product runtime, not a development fixture, and must remain in packaged builds unless the feature is explicitly removed.

## Evidence still missing

```text
exact acquisition record
wrapper package/version for the vendored esm files
upstream source archive and immutable source hash
FFmpeg configure/build flags
complete corresponding source/build recipe
license texts and notices selected by that exact build
byte-for-byte comparison with the declared candidate upstream artifact
```

FFmpeg licensing depends on the configuration and linked codecs. The version string and binary hash alone are not sufficient to classify the compiled WebAssembly artifact as LGPL-only or GPL. Do not close the W71 licensing gate until the missing evidence is supplied or the vendored binary is rebuilt through a reproducible, documented pipeline.
