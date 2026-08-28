import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { collect } = require('../../scripts/w94h-release-seal.js');

test('W94H convergence seal fails closed while server/public gates remain incomplete', () => {
  const report = collect();
  assert.equal(report.schema, 'mazz.w94h-release-seal/v1');
  assert.equal(report.completeClaim, false);
  assert.equal(report.publicEffectAuthorized, false);
  assert.equal(report.status, 'PARTIAL/BLOCKED');
  assert.equal(report.gates.W94Ga, 'PASS');
  assert.equal(report.gates.W94Gb, 'PASS_WITH_SCOPE');
  assert.equal(report.gates.W94Gc, 'PASS_WITH_SCOPE');
  assert.ok(report.blockers.length >= 3);
  assert.equal(report.fullRegression.status, 'PASS');
  assert.equal(report.fullRegression.expectedFiles, '285/285');
  assert.doesNotMatch(fs.readFileSync(path.resolve('scripts/w94h-release-seal.js'), 'utf8'), /child_process|fetch\s*\(|https?\.request|publishToHub|automaticPublication\s*:\s*true/);
});
