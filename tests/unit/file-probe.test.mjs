import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { after, describe, test } from 'node:test';

const require = createRequire(import.meta.url);
const { classifyFileSample, probeFileSync } = require('../../main/file-probe.js');
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-file-probe-'));
after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));

describe('W71 file probe', () => {
  test('识别 UTF-8、UTF-16 LE 与空文本', () => {
    assert.deepEqual(classifyFileSample(Buffer.alloc(0)), { kind: 'text', encoding: 'utf8', reason: 'empty' });
    assert.equal(classifyFileSample(Buffer.from('Mazz 中文', 'utf8')).kind, 'text');
    assert.equal(classifyFileSample(Buffer.from([0xff, 0xfe, 0x4d, 0x00])).encoding, 'utf16le');
  });

  test('二进制和未知编码不会冒充文本', () => {
    assert.equal(classifyFileSample(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 1, 2])).kind, 'binary');
    assert.equal(classifyFileSample(Buffer.from([0x81, 0x81, 0x81])).kind, 'unsupported-encoding');
    assert.equal(classifyFileSample(Buffer.from([0xfe, 0xff, 0x00, 0x41])).encoding, 'utf16be');
  });

  test('磁盘探针只取样并保留真实文件大小', () => {
    const target = path.join(fixtureDir, 'large.unknown');
    fs.writeFileSync(target, Buffer.alloc(80 * 1024, 0x41));
    const result = probeFileSync(target);
    assert.equal(result.kind, 'text');
    assert.equal(result.size, 80 * 1024);
    assert.equal(result.sampleBytes, 64 * 1024);
  });
});
