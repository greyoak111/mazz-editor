import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const script = fs.readFileSync(path.join(root, 'tests', 'e2e', 'w94e-dual-relation-branch-runtime.mjs'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('W94E dual runtime keeps the second Mazz A/B scope explicit', () => {
  assert.match(script, /two real Electron Mazz|两个真实 Electron Mazz/);
  assert.match(script, /USER_DATA_A/);
  assert.match(script, /USER_DATA_B/);
  assert.match(script, /sync:host/);
  assert.match(script, /sync:join/);
  assert.match(script, /relation:rejectCandidate/);
  assert.match(script, /branch:resolveConflict/);
  assert.match(script, /sync:stateFactPut/);
  assert.match(script, /fileFramesSeparate/);
  assert.equal(pkg.scripts['test:w94e:dual-runtime'], 'node tests/e2e/w94e-dual-relation-branch-runtime.mjs');
});
