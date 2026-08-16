# ffmpeg.wasm Corresponding-Source Reproducibility Status

> Status: `BLOCKED / DO NOT CLAIM COMPLETE CORRESPONDING SOURCE`
>
> Audit coordinate: upstream `ffmpegwasm/ffmpeg.wasm` tag `v0.12.10`, commit `c3a763857c5e615ae8674715ad5e4f63ff469e9d`

## What is proven

- The upstream tag contains the Dockerfile, Makefile, build scripts, FFmpeg binding sources and package layout used to build the core.
- It pins the Emscripten base to `emscripten/emsdk:3.1.40` and FFmpeg to `n5.1.4`.
- It declares the codec/library set observed by the packaged runtime.
- The shipped core bytes match `@ffmpeg/core@0.12.10`; the shipped ESM wrapper matches `@ffmpeg/ffmpeg@0.12.10` after newline/outer-whitespace normalization.

## Why the source gate remains open

The Dockerfile does not identify every source input by immutable commit. In particular:

| Component | Upstream ref in Dockerfile | Risk |
|---|---|---|
| x264 | `ffmpegwasm/x264#4-cores` | branch, mutable |
| lame | `ffmpegwasm/lame#master` | branch, mutable |
| zimg | `sekrit-twc/zimg#release-3.0.5` | branch-style ref; exact build commit not attested |
| remaining libraries | version/tag-like refs | must still be resolved to commits and archived |

As observed on 2026-08-16, the current remote heads were:

```text
ffmpegwasm/x264 4-cores = 33cac6b77d5b9259c552156013a817ab23119612
ffmpegwasm/lame master   = 2badea1974ae36cb8312afe99cff1e6b3b5decee
```

These observations do not prove those commits were used to build the 0.12.10 npm payload. Replacing missing build-time evidence with current branch heads would create a plausible archive, not corresponding source for the shipped binary.

## Required release gate

Before distributing the GPL core as a sealed release:

1. recover an immutable build attestation or exact commit set for every Docker `ADD` / `git clone` source;
2. archive all those source trees, the `v0.12.10` build scripts, bindings, patches and interface definitions;
3. record archive SHA-256 and a binary-to-source release manifest;
4. rebuild or otherwise prove that the archive corresponds to the shipped core payload;
5. publish the source archive beside every downloadable installer, or accompany the binary with a GPLv2-compliant written offer and retain fulfillment capability for the required period;
6. test the published source URL and keep binary/source availability coupled in the release checklist.

Until all six pass, the correct status is:

> License text and attribution: present in the distributable. Corresponding source: unresolved; distribution gate remains open.
