// tests/contract/w71-release-foundation.test.mjs —— W71 发布/许可基线
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const { auditRelease } = require('../../scripts/release-audit.js');
const root = path.resolve('.');

describe('W71 发布边界', () => {
  test('Windows 输出目录跨平台且 source map 不进发布物', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.build.directories.output, 'release');
    assert.ok(pkg.build.files.includes('!renderer/dist/**/*.map'));
    assert.ok(pkg.build.files.includes('!renderer/vendor/**/*.map'));
    assert.ok(pkg.build.files.includes('!node_modules/**/*.map'));
    for (const foreign of ['darwin-*', 'linux-*', 'android-*', 'win32-ia32', 'win32-arm64']) {
      assert.ok(pkg.build.files.some(rule => rule.includes(`/prebuilds/${foreign}/`)), `缺 ${foreign} 原生排除规则`);
    }
    assert.ok(pkg.build.asarUnpack.includes('node_modules/**/*.node'));
    for (const required of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) assert.ok(pkg.build.files.includes(required));
  });

  test('Release audit 同时盘点 source map、原生 ABI 与 vendored ffmpeg', () => {
    const report = auditRelease();
    assert.ok(report.rendererSourceMaps.count > 0 && report.rendererSourceMaps.bytes > 50 * 1024 * 1024);
    assert.ok(report.nativeBinaries.count > 0);
    assert.ok(report.nativeBinaries.files.some(file => file.path.includes('node-pty') && file.path.endsWith('.node')));
    assert.equal(report.licenses.missingDeclaredLicense.some(item => item.name === 'limiter'), false, 'legacy licenses[] 也必须识别');
    const wasm = report.vendoredFfmpeg.files.find(file => file.path.endsWith('ffmpeg-core.wasm'));
    assert.equal(wasm.sha256, '9F57947A5BD530D8F00C5B3F2CB2A3492FAA7E5D823315342D6A8656D0A6B7B7');
    assert.equal(report.licenses.evidence.buffers.gate, 'CLOSED_REMOVED_FROM_RUNTIME');
    assert.equal(report.licenses.packages.some(item => item.name === 'buffers' || item.name === 'binary'), false);
    const unzipper = report.licenses.packages.find(item => item.name === 'unzipper');
    assert.equal(unzipper?.version, '0.12.3');
    assert.equal(unzipper?.license, 'MIT');
    assert.ok(unzipper?.licenseFiles.includes('LICENSE'));
    assert.equal(report.licenses.evidence.ffmpegWasm.byteMatch, false);
    assert.equal(report.licenses.evidence.ffmpegWasm.recoveredOfficialArtifacts.wasmExactByteMatch, true);
    assert.equal(report.licenses.evidence.ffmpegWasm.recoveredOfficialArtifacts.declaredLicense, 'GPL-2.0-or-later');
    if (report.packagedSpecimen.present) {
      assert.ok(report.packagedSpecimen.asar.present);
      assert.deepEqual(report.packagedSpecimen.asar.rootNotices.sort(), ['\\LICENSE', '\\NOTICE', '\\THIRD_PARTY_NOTICES.md']);
      assert.equal(report.packagedSpecimen.asar.sourceMaps, 0);
      assert.equal(report.packagedSpecimen.asar.sourceMapBytes, 0);
      assert.equal(report.packagedSpecimen.installer.sha256.length, 64);
      assert.equal(report.packagedSpecimen.asarUnpackedNative.count, 10);
    }
  });
});

describe('W71 许可证据', () => {
  test('根许可、NOTICE、第三方指针与 ffmpeg 缺口声明齐全', () => {
    for (const file of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'renderer/vendor/ffmpeg/PROVENANCE.md']) {
      assert.ok(fs.existsSync(path.join(root, file)), `${file} 缺失`);
    }
    const provenance = fs.readFileSync(path.join(root, 'renderer/vendor/ffmpeg/PROVENANCE.md'), 'utf8');
    assert.ok(provenance.includes('RELEASE BLOCKER UNTIL COMPLETED'));
    assert.ok(provenance.includes('--enable-gpl'));
    assert.ok(provenance.includes('0.12.6'));
    assert.ok(provenance.includes('GPL-2.0-or-later'));
    assert.ok(provenance.includes('ffmpeg version 5.1.4'));
  });

  test('ffmpeg 转码任务串行化且成功/失败路径均释放监听器、虚拟文件与 worker', () => {
    const source = fs.readFileSync(path.join(root, 'renderer/lib/ffmpeg-transcode.js'), 'utf8');
    assert.ok(source.includes('transcodeTail.then(run, run)'));
    assert.ok(source.includes("f.off('progress', progressHandler)"));
    assert.ok(source.includes('for (const name of [inName, outName, paletteName])'));
    assert.ok(source.includes('export async function disposeFFmpeg()'));
    assert.ok(source.includes('ffmpeg.terminate()'));
  });
});
