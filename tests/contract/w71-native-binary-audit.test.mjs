// tests/contract/w71-native-binary-audit.test.mjs —— Windows native staging 分类契约
import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const { auditNative, classifyNative, packageNameOf } = require('../../scripts/w71-native-audit.js');

describe('W71 Windows 原生二进制审计', () => {
  test('精确区分 win32-x64、外平台 prebuild 与通用 build 输出', () => {
    assert.equal(classifyNative('x/node_modules/a/prebuilds/win32-x64/a.node').status, 'target');
    assert.equal(classifyNative('x/node_modules/a/prebuilds/linux-x64/a.node').status, 'foreign');
    assert.equal(classifyNative('x/node_modules/a/build/Release/a.node').status, 'ambiguous');
    assert.equal(packageNameOf('x/node_modules/@scope/pkg/prebuilds/win32-x64/a.node'), '@scope/pkg');
  });

  test('现有 specimen 的 staging 计划只自动排除明确外平台文件', () => {
    const report = auditNative();
    assert.equal(report.target.platform, 'win32');
    assert.equal(report.target.arch, 'x64');
    assert.ok(report.source.summary.count >= 1);
    if (report.packaged.present) {
      assert.equal(report.packaged.summary.count, report.stagingPlan.keep.length + report.stagingPlan.removeCandidate.length);
      assert.ok(report.stagingPlan.removeCandidate.every(file => !/prebuilds\/win32-x64\//i.test(file)));
      assert.ok(report.stagingPlan.keep.some(file => /prebuilds\/win32-x64\//i.test(file)));
      assert.ok(report.stagingPlan.manualReview.every(file => /build\/Release\//i.test(file)));
    }
  });
});
