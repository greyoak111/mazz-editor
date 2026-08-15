// tests/contract/w71-reproducible-samples.test.mjs —— 示例插件包必须可复验
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { describe, test, assert } from '../harness.mjs';

const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

describe('W71 可复验示例插件包', () => {
  test('连续构建两次产出相同哈希', () => {
    const files = ['samples/pomodoro.maz', 'samples/wordcount.maz'].map(file => path.resolve(file));
    execFileSync(process.execPath, ['scripts/build-sample-plugins.js'], { stdio: 'ignore' });
    const first = files.map(hash);
    execFileSync(process.execPath, ['scripts/build-sample-plugins.js'], { stdio: 'ignore' });
    assert.deepEqual(files.map(hash), first);
  });
});
