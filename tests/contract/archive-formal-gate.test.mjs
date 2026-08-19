import './_setup.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const ArchiveService = require('../../main/archive.js');
const { ARCHIVE_LIMITS, assertBudget, isZipSymlink, safeRelativePath, stagingPath } = ArchiveService;

function withRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-archive-formal-'));
  return Promise.resolve().then(() => fn(root)).finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

function service() { return new ArchiveService({ bus: { handle() {}, send() {} }, win: () => null }); }

async function zipAt(filePath, files) {
  const zip = new JSZip();
  for (const [name, value] of Object.entries(files)) zip.file(name, value);
  fs.writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

describe('Archive Formal 安全边界', () => {
  test('拒绝 absolute/traversal/ADS/NUL，允许正常长层级', () => {
    assert.equal(safeRelativePath('a/b/c.txt'), path.join('a', 'b', 'c.txt'));
    for (const unsafe of ['../evil.txt', 'a/../../evil', '/root.txt', 'C:/evil.txt', 'a/file:ads', 'a\0b']) {
      assert.throws(() => safeRelativePath(unsafe), /不安全|绝对|NUL|超长/);
    }
    assert.throws(() => safeRelativePath(`a/${'x'.repeat(ARCHIVE_LIMITS.maxPathChars)}`), /超长/);
  });

  test('条目/单件/总量/压缩比炸弹预算 fail closed', () => {
    assert.throws(() => assertBudget([{ name: 'bomb.bin', size: 600_000_000, packed: 1 }]), /单文件|压缩比/);
    assert.throws(() => assertBudget([{ name: 'ratio.bin', size: 1_000_000, packed: 1 }]), /压缩比/);
    assert.throws(() => assertBudget(Array.from({ length: ARCHIVE_LIMITS.maxEntries + 1 }, (_, index) => ({ name: `${index}.txt`, size: 0, packed: 0 }))), /条目/);
    assert.equal(isZipSymlink({ unixPermissions: 0o120777 }), true);
  });

  test('zip 在 staging 解压后提交，既有文件不覆盖且失败无 partial', () => withRoot(async root => {
    const archive = path.join(root, 'safe.zip');
    const dest = path.join(root, 'dest');
    await zipAt(archive, { 'nested/a.txt': 'alpha', 'b.txt': 'beta' });
    const first = await service()._extractZipFirst({ id: 'arc-test-1', cancelled: false }, { path: archive, dest });
    assert.equal(first.ok, true);
    assert.equal(fs.readFileSync(path.join(dest, 'nested', 'a.txt'), 'utf8'), 'alpha');
    assert.equal(fs.existsSync(stagingPath(dest, 'arc-test-1')), false);
    const second = await service()._extractZipFirst({ id: 'arc-test-2', cancelled: false }, { path: archive, dest });
    assert.equal(second.ok, false);
    assert.match(second.info, /目标已存在/);
    assert.equal(fs.readFileSync(path.join(dest, 'b.txt'), 'utf8'), 'beta');
    assert.equal(fs.existsSync(stagingPath(dest, 'arc-test-2')), false);
  }));

  test('取消在写目标前清理 staging，零产品残片', () => withRoot(async root => {
    const archive = path.join(root, 'cancel.zip');
    const dest = path.join(root, 'cancel-dest');
    await zipAt(archive, { 'a.txt': 'alpha' });
    const result = await service()._extractZipFirst({ id: 'arc-cancel', cancelled: true }, { path: archive, dest });
    assert.equal(result.ok, false);
    assert.match(result.info, /取消/);
    assert.equal(fs.existsSync(stagingPath(dest, 'arc-cancel')), false);
    assert.equal(fs.existsSync(path.join(dest, 'a.txt')), false);
  }));
});
