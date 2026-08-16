// tests/contract/w71-release-foundation.test.mjs —— W71 发布/许可基线
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
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
    assert.ok(pkg.build.files.includes('!renderer/vendor/ffmpeg/ffmpeg-core.js'));
    assert.ok(pkg.build.files.includes('!renderer/vendor/ffmpeg/ffmpeg-core.wasm'));
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
    assert.equal(report.schemaVersion, 3);
    assert.equal(report.ffmpegDistribution.mode, 'DEFERRED_NOT_BUNDLED');
    assert.deepEqual(report.ffmpegDistribution.repositoryCoreArtifactsPresent, []);
    assert.ok(report.ffmpegDistribution.buildExclusions.every(item => item.present));
    assert.equal(report.licenses.evidence.buffers.gate, 'CLOSED_REMOVED_FROM_RUNTIME');
    assert.equal(report.licenses.packages.some(item => item.name === 'buffers' || item.name === 'binary'), false);
    const unzipper = report.licenses.packages.find(item => item.name === 'unzipper');
    assert.equal(unzipper?.version, '0.12.3');
    assert.equal(unzipper?.license, 'MIT');
    assert.ok(unzipper?.licenseFiles.includes('LICENSE'));
    assert.equal(report.licenses.evidence.ffmpegWasm.byteMatch, false);
    assert.equal(report.licenses.evidence.ffmpegWasm.recoveredOfficialArtifacts.wasmExactByteMatch, true);
    assert.equal(report.licenses.evidence.ffmpegWasm.recoveredOfficialArtifacts.declaredLicense, 'GPL-2.0-or-later');
    assert.equal(report.licenses.evidence.ffmpegWrapper.gate, 'CLOSED_IDENTIFIED');
    assert.equal(report.licenses.evidence.ffmpegWasm.sourceReproducibility.gate, 'OPEN_BLOCKED_MISSING_IMMUTABLE_BUILD_INPUTS');
    if (report.packagedSpecimen.present) {
      assert.ok(report.packagedSpecimen.asar.present);
      assert.deepEqual(report.packagedSpecimen.asar.rootNotices.sort(), ['\\KNOWN_LIMITATIONS.md', '\\LICENSE', '\\NOTICE', '\\THIRD_PARTY_NOTICES.md']);
      assert.equal(report.packagedSpecimen.asar.sourceMaps, 0);
      assert.equal(report.packagedSpecimen.asar.sourceMapBytes, 0);
      assert.equal(report.packagedSpecimen.asar.ffmpegNotices.length, 5);
      assert.ok(report.packagedSpecimen.asar.ffmpegNotices.every(file => file.present && file.sha256.length === 64));
      assert.ok(report.packagedSpecimen.asar.ffmpegCoreArtifacts.every(file => !file.present));
      assert.equal(report.packagedSpecimen.installer.sha256.length, 64);
      assert.equal(report.packagedSpecimen.asarUnpackedNative.count, 10);
    }
  });
});

describe('W71 许可证据', () => {
  test('根许可、NOTICE、第三方指针与 ffmpeg 缺口声明齐全', () => {
    const ffmpegFiles = [
      'renderer/vendor/ffmpeg/COPYING.GPLv2',
      'renderer/vendor/ffmpeg/LICENSE.wrapper-MIT',
      'renderer/vendor/ffmpeg/NOTICE.md',
      'renderer/vendor/ffmpeg/PROVENANCE.md',
      'renderer/vendor/ffmpeg/SOURCE_REPRODUCIBILITY.md',
    ];
    for (const file of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', ...ffmpegFiles]) {
      assert.ok(fs.existsSync(path.join(root, file)), `${file} 缺失`);
    }
    const provenance = fs.readFileSync(path.join(root, 'renderer/vendor/ffmpeg/PROVENANCE.md'), 'utf8');
    const gpl = fs.readFileSync(path.join(root, 'renderer/vendor/ffmpeg/COPYING.GPLv2'), 'utf8');
    const wrapperLicense = fs.readFileSync(path.join(root, 'renderer/vendor/ffmpeg/LICENSE.wrapper-MIT'), 'utf8');
    const notice = fs.readFileSync(path.join(root, 'renderer/vendor/ffmpeg/NOTICE.md'), 'utf8');
    const sourceStatus = fs.readFileSync(path.join(root, 'renderer/vendor/ffmpeg/SOURCE_REPRODUCIBILITY.md'), 'utf8');
    assert.ok(provenance.includes('CORE NOT DISTRIBUTED'));
    assert.ok(provenance.includes('--enable-gpl'));
    assert.ok(provenance.includes('0.12.6'));
    assert.ok(provenance.includes('GPL-2.0-or-later'));
    assert.ok(provenance.includes('ffmpeg version 5.1.4'));
    assert.ok(provenance.includes('@ffmpeg/ffmpeg@0.12.10'));
    assert.ok(gpl.includes('3. You may copy and distribute the Program'));
    assert.ok(gpl.replace(/\s+/g, ' ').includes('complete corresponding machine-readable source code'));
    assert.equal(crypto.createHash('sha256').update(gpl).digest('hex').toUpperCase(), '8177F97513213526DF2CF6184D8FF986C675AFB514D4E68A404010521B880643');
    assert.ok(wrapperLicense.includes('Copyright (c) 2019 Jerome Wu'));
    assert.ok(notice.includes('B2F2418BE6CC3C29A0765C1376EBFBFEA94073B287767460851A3CE487666D8F'));
    assert.ok(sourceStatus.includes('DEFERRED / NOT DISTRIBUTED'));
    assert.ok(sourceStatus.includes('ffmpegwasm/x264#4-cores') && sourceStatus.includes('ffmpegwasm/lame#master'));
  });

  test('ffmpeg 转码任务串行化且成功/失败路径均释放监听器、虚拟文件与 worker', () => {
    const source = fs.readFileSync(path.join(root, 'renderer/lib/ffmpeg-transcode.js'), 'utf8');
    assert.ok(source.includes('transcodeTail.then(run, run)'));
    assert.ok(source.includes("f.off('progress', progressHandler)"));
    assert.ok(source.includes('for (const name of [inName, outName, paletteName])'));
    assert.ok(source.includes('export async function disposeFFmpeg()'));
    assert.ok(source.includes('ffmpeg.terminate()'));
    assert.ok(source.includes('PRODUCT_CAPABILITIES.ffmpegRuntime.maturity === MATURITY.HIDDEN'));
  });

  test('NSIS 安装循环使用隔离目标、已安装 exe 真冒烟与受限清理', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const installerInclude = fs.readFileSync(path.join(root, 'build/installer.nsh'), 'utf8');
    const main = fs.readFileSync(path.join(root, 'main/main.js'), 'utf8');
    const shell = fs.readFileSync(path.join(root, 'renderer/shell/shell.js'), 'utf8');
    const smoke = fs.readFileSync(path.join(root, 'tests/e2e/w71-packaged-smoke.mjs'), 'utf8');
    const cycle = fs.readFileSync(path.join(root, 'tests/e2e/w71-installer-cycle.mjs'), 'utf8');
    const cycleEvidence = JSON.parse(fs.readFileSync(path.join(root, 'docs/engineering/evidence/W71_INSTALLER_CYCLE.json'), 'utf8'));
    assert.equal(pkg.build.nsis.include, 'build/installer.nsh');
    assert.deepEqual(pkg.build.fileAssociations.map(item => item.name), [
      'com.mazz.editor.markdown', 'com.mazz.editor.markdown', 'com.mazz.editor.text', 'com.mazz.editor.workspace',
    ]);
    assert.ok(installerInclude.includes('WriteRegStr SHELL_CONTEXT "Software\\Classes\\mazz"'));
    assert.ok(installerInclude.includes('DeleteRegKey SHELL_CONTEXT "Software\\Classes\\mazz"'));
    assert.ok(installerInclude.includes('com.mazz.editor.markdown_backup'));
    assert.ok(installerInclude.includes('SHChangeNotify'));
    assert.ok(installerInclude.includes('Explorer\\FileExts\\.markdown\\OpenWithProgids'));
    assert.ok(installerInclude.includes('"com.mazz.editor.markdown"'));
    assert.equal(main.includes('app.setAsDefaultProtocolClient(PROTOCOL)'), false);
    assert.ok(main.includes('extractProtocolUrls(argv)'));
    assert.ok(main.includes('pendingProtocolUrls.splice(0).forEach(handleProtocol)'));
    assert.ok(main.includes("app.on('window-all-closed', () => { if (wm.forceClose) app.quit(); })"));
    assert.ok(shell.includes("window.mazz.on('protocol:open'"));
    assert.ok(smoke.includes('MAZZ_E2E_EXECUTABLE'));
    assert.ok(smoke.includes('launchIntegrationTarget(protocolUrl)'));
    assert.ok(smoke.includes('launchIntegrationTarget(associatedFile, { windowsShell: false })'));
    assert.ok(smoke.includes('associatedFileObserved'));
    assert.ok(smoke.includes("['url.dll,FileProtocolHandler', target]"));
    assert.ok(cycle.includes("run(installer, ['/S', `/D=${installDir}`])"));
    assert.ok(cycle.includes('MAZZ_E2E_EXECUTABLE: installedExe'));
    assert.ok(cycle.includes("run(uninstaller, ['/S'])"));
    assert.ok(cycle.includes('assertInsideTemp(target)'));
    assert.ok(cycle.includes('removeOwnedTempDirectory(installDir)'));
    assert.ok(cycle.includes('Existing Mazz Editor installation/shortcut found'));
    assert.ok(cycle.includes('windowsIntegrationRemoved'));
    assert.ok(cycle.includes('sameVersionReinstall'));
    assert.ok(cycle.includes('originalAssociationBackupsPreserved'));
    assert.ok(cycle.includes("MAZZ_E2E_WINDOWS_SHELL: '1'"));
    assert.ok(cycle.includes('waitForExecutableRelease(installedExe)'));
    assert.ok(cycle.includes("runColdStartTarget(installedExe, 'protocol')"));
    assert.ok(cycle.includes('runColdStartTarget(installedExe, ext, dispatchMode)'));
    assert.ok(cycle.includes('UserChoice'));
    assert.ok(cycle.includes('assertUserChoicesPreserved'));
    assert.ok(cycle.includes("'windows-shell-cold-start'"));
    assert.ok(cycle.includes("'registered-command-direct-cold-start'"));
    assert.ok(cycle.includes('visibleRendererTargetObserved: true'));
    assert.ok(cycle.includes('CloseMainWindow()'));
    assert.ok(cycle.includes('schemaVersion: 5'));
    assert.equal(cycleEvidence.schemaVersion, 5);
    assert.equal(cycleEvidence.coldStartShell.protocol.mainWindowTitle, '隐私浏览器 — Mazz Editor');
    for (const ext of ['md', 'markdown', 'txt', 'mazz']) {
      const baselineChoice = cycleEvidence.userChoicePreservation.baseline.find(item => item.ext === ext);
      const result = cycleEvidence.coldStartShell.associatedFiles[ext];
      assert.deepEqual(result.baselineUserChoice, baselineChoice);
      assert.equal(result.mainWindowTitle, `cold-start-file.${ext} — Mazz Editor`);
      assert.equal(result.forcedCleanupProcesses, 0);
      assert.equal(result.launchMode, ext === 'mazz'
        ? 'windows-shell-cold-start'
        : 'registered-command-direct-cold-start');
    }
    assert.deepEqual(cycleEvidence.coldStartShell.shellDefaultNotAssertedExtensions, ['md', 'markdown', 'txt']);
    assert.deepEqual(cycleEvidence.coldStartShell.proprietaryShellExtensions, ['mazz']);
    assert.equal(cycleEvidence.coldStartShell.allVisibleTargetsObserved, true);
    assert.equal(cycleEvidence.coldStartShell.allGracefullyReleased, true);
    assert.equal(cycleEvidence.coldStartShell.allAssociationOutcomesValid, true);
    assert.equal(cycleEvidence.coldStartShell.protocol.forcedCleanupProcesses, 0);
    assert.equal(cycleEvidence.userChoicePreservation.allUnchanged, true);
    assert.deepEqual(cycleEvidence.userChoicePreservation.unchangedAfterEachPhase, {
      afterInstall: true,
      afterSameVersionReinstall: true,
      afterColdStarts: true,
      afterInstalledRuntime: true,
      afterUninstall: true,
    });
  });
});
