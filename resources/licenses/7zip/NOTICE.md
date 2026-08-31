# 7-Zip runtime notice

Mazz Editor distributes the unmodified full 7-Zip command-line runtime supplied by `7zip-bin-full@26.2.1`. The Windows x64 executable identifies itself as 7-Zip 26.02 (2026-06-25), Copyright (C) 1999-2026 Igor Pavlov, and loads the adjacent upstream `7z.dll`. The package is pinned by the integrity value in `package-lock.json`.

The packaging hook removes unrelated operating-system and architecture directories before sealing. The retained target directory keeps its upstream `License.txt`, `readme.txt` and `History.txt` beside the executable and, on Windows, `7z.dll`.

7-Zip is primarily licensed under GNU LGPL version 2.1 or later. Upstream's binary-distribution LGPL, BSD 3-clause, BSD 2-clause and unRAR terms are reproduced in this directory's `LICENSE.txt`; the complete LGPL-2.1 text is reproduced in `COPYING.txt`. The `7zip-bin-full` JavaScript wrapper is separately MIT licensed and its license remains beside the packaged npm module.

Upstream source and license material for this exact engine version:

- https://github.com/ip7z/7zip/tree/26.02
- https://github.com/ip7z/7zip/blob/26.02/DOC/License.txt
- https://github.com/ip7z/7zip/blob/26.02/DOC/copying.txt
- https://www.7-zip.org/

Mazz exposes zip, RAR, 7z, tar, CAB and ordinary single-stream gzip after a pre-extraction path, size, compression-ratio, encryption and link audit. BZIP2 and XZ are recognized but rejected because the command-line listing does not provide enough pre-extraction metadata for Mazz's safety budget. `tar.gz`/`tgz` are rejected until a verified two-layer extraction transaction exists. Interactive encrypted archives are not supported; password prompts are disabled so background jobs fail closed.

Integrity of the copied license documents (UTF-8/LF repository bytes):

- `LICENSE.txt`: SHA-256 `32369594a3a9f7c643d124035120eaa6a7707e75e57c4386ef509f801447bc49`
- `COPYING.txt`: SHA-256 `dc626520dcd53a22f727af3ee42c770e56c97a64fe3adb063799d8ab032fe551`
