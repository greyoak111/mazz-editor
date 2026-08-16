import './_setup.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { MATURITY, PRODUCT_CAPABILITIES } from '../../renderer/core/product-maturity.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { auditSecrets } = require('../../scripts/secret-audit.js');
const read = file => fs.readFileSync(file, 'utf8');

describe('W71 C3 发布策略', () => {
  test('0.2.0 是首个封板升级基线，旧开发构建与自动更新不冒充受支持', () => {
    const policy = read('docs/engineering/W71_UPGRADE_SUPPORT_POLICY.md');
    const known = read('KNOWN_LIMITATIONS.md');
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.version, '0.2.0');
    assert.match(policy, /0\.1\.0 or WIP → 0\.2\.0 in-place upgrade = NOT CLAIMED/);
    assert.match(policy, /automatic updater\s+= HIDDEN/);
    assert.match(known, /first sealed upgrade baseline/);
    assert.ok(pkg.build.files.includes('KNOWN_LIMITATIONS.md'));
  });

  test('卸载脚本不删除工作区或 userData，Updater 与 GPL 转码子能力继续 Hidden', () => {
    const installer = read('build/installer.nsh');
    assert.equal(/(?:RMDir|Delete)\s+.*\$(?:APPDATA|LOCALAPPDATA)/i.test(installer), false);
    assert.equal(PRODUCT_CAPABILITIES.updater.maturity, MATURITY.HIDDEN);
    assert.equal(PRODUCT_CAPABILITIES.ffmpegRuntime.maturity, MATURITY.HIDDEN);
  });

  test('当前产品源码与配置没有高置信 secret 候选，扫描报告不泄露命中值', () => {
    const report = auditSecrets();
    assert.equal(report.gate, 'PASS_NO_CURRENT_TREE_SECRET_CANDIDATES');
    assert.deepEqual(report.findings, []);
    assert.match(report.privacy, /never written/);
  });
});
