import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { collect } = require('../../scripts/w94h-release-seal.js');

test('W94H seals local completion separately and keeps server/public effects closed', () => {
  const report = collect();
  assert.equal(report.schema, 'mazz.w94h-release-seal/v1');
  assert.equal(report.completeClaim, false);
  assert.equal(report.publicEffectAuthorized, false);
  assert.equal(report.status, 'PARTIAL/BLOCKED');
  assert.equal(report.localStatus, 'PASS');
  assert.equal(report.localCompleteClaim, true);
  assert.deepEqual(report.localBlockers, []);
  assert.equal(report.gates.W94Ga, 'PASS');
  assert.equal(report.gates.W94E, 'PASS');
  assert.equal(report.gates.W94Gb, 'LOCAL_PASS');
  assert.equal(report.gates.W94Gc, 'PASS_WITH_SCOPE');
  assert.ok(report.blockers.length >= 2);
  assert.equal(report.fullRegression.status, 'PASS');
  assert.equal(report.fullRegression.expectedFiles, '287/287');
  assert.doesNotMatch(fs.readFileSync(path.resolve('scripts/w94h-release-seal.js'), 'utf8'), /child_process|fetch\s*\(|https?\.request|publishToHub|automaticPublication\s*:\s*true/);
});
