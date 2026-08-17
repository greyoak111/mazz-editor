import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const {
  buildLedger,
  checkLedger,
  serializeLedger,
} = require('../../scripts/oss-provenance-ledger.js');
const { auditRelease } = require('../../scripts/release-audit.js');
const root = path.resolve('.');

describe('W72c deterministic OSS provenance ledger', () => {
  test('同一仓库输入重复生成逐字节一致，不写时间或绝对路径', () => {
    const first = serializeLedger(buildLedger(root));
    const second = serializeLedger(buildLedger(root));
    assert.equal(first, second);
    assert.doesNotMatch(first, /generatedAt|D:\\\\output|C:\\\\Users/);
  });

  test('全部锁定包都有固定版本、来源完整性和许可证据状态', () => {
    const ledger = buildLedger(root);
    const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
    const expected = Object.keys(lock.packages).filter(location => location.startsWith('node_modules/')).length;
    assert.equal(ledger.summary.lockedPackages, expected);
    assert.equal(ledger.summary.runtimeGraphCandidates + ledger.summary.developmentPackages, expected);
    assert.equal(ledger.summary.missingLicense, 0);
    assert.equal(ledger.summary.missingSourceOrIntegrity, 0);
    assert.equal(ledger.gates.overall, 'PASS_REPOSITORY_PROVENANCE_BASELINE');
    assert.deepEqual(ledger.gates.blockers, []);
    assert.ok(ledger.dependencyGraph.packages.every(item => item.updateStatus === 'LOCKED_NOT_CHECKED_LATEST'));
    assert.ok(ledger.dependencyGraph.packages.every(item => item.vulnerabilityStatus === 'NOT_ASSESSED_OFFLINE'));
  });

  test('limiter 缺失 lock license 只由精确人工证据补齐', () => {
    const ledger = buildLedger(root);
    const limiter = ledger.dependencyGraph.packages.find(item => item.name === 'limiter' && item.version === '1.1.5');
    assert.equal(limiter.license.expression, 'MIT');
    assert.equal(limiter.license.evidenceState, 'PUBLISHED_PACKAGE_LEGACY_METADATA');
    assert.ok(limiter.requiredEvidence.some(item => item.path === 'node_modules/limiter/package.json' && item.present));
    assert.ok(limiter.requiredEvidence.some(item => item.path === 'node_modules/limiter/LICENSE.txt' && item.present));
  });

  test('本地补丁、dependency override 与复合运行时 notice 不会隐身', () => {
    const ledger = buildLedger(root);
    const webtorrent = ledger.dependencyGraph.packages.find(item => item.location === 'node_modules/webtorrent');
    assert.equal(webtorrent.modifications.length, 1);
    assert.equal(webtorrent.modifications[0].patch.path, 'patches/webtorrent+2.8.5.patch');
    assert.equal(webtorrent.modifications[0].patch.sha256.length, 64);
    assert.equal(ledger.dependencyGraph.dependencyOverrides.exceljs.unzipper, '0.12.3');
    const electron = ledger.dependencyGraph.packages.find(item => item.location === 'node_modules/electron');
    assert.equal(electron.distributionStatus, 'SHIPPED_PLATFORM_RUNTIME');
    assert.deepEqual(electron.requiredEvidence.map(item => item.role), [
      'INSTALLED_PACKAGE_METADATA', 'ELECTRON_LICENSE', 'CHROMIUM_THIRD_PARTY_LICENSES',
    ]);
    const libass = ledger.dependencyGraph.packages.find(item => item.location === 'node_modules/libass-wasm');
    assert.ok(libass.requiredEvidence.some(item => item.role === 'COMPOUND_RUNTIME_LICENSE_NOTICE' && item.present));
  });

  test('FFmpeg wrapper 固定哈希通过，core 只保留未分发激活账', () => {
    const ledger = buildLedger(root);
    const wrapper = ledger.vendoredComponents.find(item => item.componentId.includes('vendored-wrapper'));
    assert.equal(wrapper.gate, 'CLOSED_IDENTIFIED');
    assert.ok(wrapper.files.every(item => item.present && item.matchesExpected));
    const core = ledger.vendoredComponents.find(item => item.componentId.includes('deferred-core'));
    assert.equal(core.distributionStatus, 'NOT_DISTRIBUTED_ACTIVATION_CAPSULE');
    assert.equal(core.gate, 'DEFERRED_OPEN_CORRESPONDING_SOURCE');
    assert.ok(core.mustBeAbsent.every(item => item.absent));
    assert.equal(ledger.gates.deferredActivation.length, 1);
  });

  test('提交账本无漂移并已接入 release audit', () => {
    const check = checkLedger(root);
    assert.deepEqual(check, { ok: true, reason: 'CURRENT', target: '.mazz/audit/oss-provenance-ledger.json' });
    const release = auditRelease();
    assert.equal(release.schemaVersion, 4);
    assert.equal(release.licenses.provenanceLedger.current, true);
    assert.equal(release.licenses.provenanceLedger.status, 'PASS_REPOSITORY_PROVENANCE_BASELINE');
    assert.equal(release.licenses.provenanceLedger.summary.lockedPackages, buildLedger(root).summary.lockedPackages);
  });

  test('生成器不联网、不执行包管理或发布动作', () => {
    const source = fs.readFileSync('scripts/oss-provenance-ledger.js', 'utf8');
    assert.doesNotMatch(source, /child_process|spawn|execFile|fetch\s*\(|https?\.request|npm\s+(?:install|update|audit)/i);
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    assert.match(pkg.scripts['audit:provenance'], /--check/);
    assert.match(pkg.scripts['audit:provenance:update'], /--out/);
  });
});
