# Mazz Editor 0.2.0 RC Known Limitations

This document describes the boundary of the first sealed Windows release candidate. It is part of the distributable and must be updated with every promoted specimen.

## Release channel

- The current artifact is an **unsigned internal RC**. It has not passed a public code-signing or SmartScreen reputation gate.
- Automatic updating is Hidden. The current implementation is not a supported download/install/rollback channel.
- Other Windows versions, CPUs, clean machines, multi-user installs, broad DPI/RDP/GPU combinations and real capture-device permission matrices remain conditional validation gates.

## Upgrade baseline

- Version `0.2.0` is the first sealed upgrade baseline.
- Earlier `0.1.0`, WIP tags, patches and development installers were never frozen as supported release specimens. Automated in-place upgrade or downgrade from them is not claimed.
- Same-version `0.2.0` repair/reinstall is verified on the current host. It preserves existing association owners and Windows UserChoice state.
- The installer and uninstaller do not delete workspace files or application user data. Back up important work before manual replacement nevertheless.
- A future version may claim in-place upgrade only after an old sealed specimen, the new specimen, user-data migration, failure preservation and rollback behavior pass one automated matrix.

## Optional media conversion

- The sealed build does not contain `ffmpeg-core.js` or `ffmpeg-core.wasm`.
- Native audio/video playback, WebM recording and “open with the system default application” remain available.
- Local fallback transcoding, Player GIF export and Recorder mp4 conversion are Hidden until complete corresponding source and durable source delivery are available and tested.

## Remote and virtual-display video

- spacedesk and comparable virtual-display drivers use Mazz's compatibility composition mode: GPU/platform video decoding stays enabled while DirectComposition video overlays are disabled.
- True RDP/ICA/PCoIP sessions and explicitly selected safe mode still disable GPU acceleration. HEVC may be unavailable there; Player stops a time-advancing zero-frame stream and offers retry/system-player recovery instead of silently presenting a black picture.
- The current host passed real AVC and HEVC files, including the reported HEVC seek point at 42:17. Broad GPU, driver, HDR, color-depth and remote-display combinations remain conditional validation gates.

## Preview and deferred capabilities

- DMHY, Recorder, Plugins, OCR and Archive remain Preview.
- Mobile, Updater, W62e Feed and general Agent UI/Adapters remain Hidden; the W66 Harness foundation remains internal.
- Post-W71 work—including complete Session topology, exhaustive compatibility matrices and W63–W86 design capsules—is preserved in the complete backlog and is not part of this RC.
