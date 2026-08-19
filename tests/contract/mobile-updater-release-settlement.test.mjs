import './_setup.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';
import { MATURITY, PRODUCT_CAPABILITIES } from '../../renderer/core/product-maturity.js';

const require = createRequire(import.meta.url);
const Updater = require('../../main/updater.js');
const read = file => fs.readFileSync(file, 'utf8');

describe('Mobile / Updater / Release 条件门结算', () => {
  test('移动壳可生成两平台工程但不携带被禁用 ffmpeg core 或伪原生 TCP 插件', () => {
    const prepare = read('mobile/prepare.mjs');
    const mobile = JSON.parse(read('mobile/package.json'));
    const workflow = read('.github/workflows/build-mobile.yml');
    assert.equal(PRODUCT_CAPABILITIES.mobile.maturity, MATURITY.HIDDEN);
    assert.equal(PRODUCT_CAPABILITIES.mobile.gate, 'CONDITIONAL_PLATFORM_BUILD');
    assert.equal(prepare.includes("['renderer/vendor', 'vendor']"), false);
    assert.equal(Object.hasOwn(mobile.dependencies, 'mazz-tcp-server'), false);
    for (const platform of ['android', 'ios']) {
      const block = workflow.slice(workflow.indexOf(`npx cap add ${platform}`) - 80, workflow.indexOf(`npx cap sync ${platform}`) + 40);
      assert.ok(block.indexOf('npm run prepare') < block.indexOf(`npx cap add ${platform}`));
    }
  });

  test('Updater 固定 Hidden，配置入口当场拒绝非 HTTPS/凭据/片段', () => {
    assert.equal(PRODUCT_CAPABILITIES.updater.maturity, MATURITY.HIDDEN);
    assert.equal(PRODUCT_CAPABILITIES.updater.gate, 'CONDITIONAL_RELEASE_INFRASTRUCTURE');
    assert.equal(Updater.normalizeUpdateUrl(''), '');
    assert.equal(Updater.normalizeUpdateUrl('https://updates.example/manifest.json'), 'https://updates.example/manifest.json');
    assert.throws(() => Updater.normalizeUpdateUrl('http://updates.example/manifest.json'), /HTTPS/);
    assert.throws(() => Updater.normalizeUpdateUrl('https://user:pass@updates.example/x'), /凭据/);
    assert.throws(() => Updater.normalizeUpdateUrl('https://updates.example/x#frag'), /片段/);
  });

  test('Windows 发布边界继续排除 source map、外平台 binary 与隐藏 GPL core', () => {
    const pkg = JSON.parse(read('package.json'));
    const files = pkg.build.files.join('\n');
    assert.match(files, /!renderer\/dist\/\*\*\/\*\.map/);
    assert.match(files, /!node_modules\/\*\*\/prebuilds\/darwin-/);
    assert.match(files, /!node_modules\/\*\*\/prebuilds\/linux-/);
    assert.match(files, /!renderer\/vendor\/ffmpeg\/ffmpeg-core\.wasm/);
    assert.equal(pkg.build.npmRebuild, false);
  });
});
