import './_setup.mjs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const ArchiveService = require('../../main/archive.js');
const { pruneSevenZipRuntime, targetArchDirs } = require('../../build/prune-7zip-runtime.js');
const {
  ARCHIVE_LIMITS, NESTED_GZIP_UNSUPPORTED, STREAM_METADATA_UNSUPPORTED,
  assertBudget, commitStaging, createOwnedStaging, isZipSymlink, parseSevenZipListing, resolveSevenZipPath,
  safeRelativePath, sniff, stagingPath,
} = ArchiveService;

function withRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-archive-formal-'));
  return Promise.resolve().then(() => fn(root)).finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

function service() { return new ArchiveService({ bus: { handle() {}, send() {} }, win: () => null }); }

// Minimal safe RAR fixtures from libarchive's BSD-2-Clause test corpus. Keeping
// them inline makes the provenance and expected bytes reviewable in one place;
// the complete retained copyright/license notice is in
// tests/fixtures/libarchive-NOTICE.txt.
// https://github.com/libarchive/libarchive/blob/master/libarchive/test/test_read_format_rar_noeof.rar.uu
// https://github.com/libarchive/libarchive/blob/master/libarchive/test/test_read_format_rar5_stored.rar.uu
const RAR_FIXTURES = Object.freeze([
  {
    name: 'safe-rar4.rar',
    base64: 'UmFyIRoHAM+QcwAADQAAAAAAAACEUnQgkDIAFAAAABQAAAADQqLIvrd22j4UMAgApIEAAHRlc3QudHh0gAi3dto+t3baPnRlc3QgdGV4dCBkb2N1bWVudA0K',
    sha256: 'b42c3bdfd96eac9c3ab336b04b3b65d01a26aca099de4fae2b7d77372b83b4cc',
    entry: 'test.txt',
    content: 'test text document\r\n',
  },
  {
    name: 'safe-rar5.rar',
    base64: 'UmFyIRoHAQAzkrXlCgEFBgAFAQGAgAA4MAZjLAIDC50ABJ0ApIMCtEOglYAAAQ5oZWxsb3dvcmxkLnR4dAoDE34Oq1tW6Q4aaGVsbG8gbGliYXJjaGl2ZSB0ZXN0IHN1aXRlIQodd1ZRAwUEAA==',
    sha256: '35d75e315d164d2e329afc28f7d844f013271b4fcffd4ddd78efcdd114a383a7',
    entry: 'helloworld.txt',
    content: 'hello libarchive test suite!\n',
  },
]);

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
    assert.throws(() => assertBudget([{ name: 'whole-ratio.bin', size: 1_000_000, packed: null }], 1), /整体压缩比/);
    assert.throws(() => assertBudget([{ name: 'unknown.bin', size: null, packed: null }], 1_000), /可信大小/);
    assert.throws(() => assertBudget([{ name: 'secret.bin', size: 1, packed: 1, encrypted: true }], 100), /加密/);
    assert.throws(() => assertBudget([{ name: 'link.bin', size: 1, packed: 1, link: true }], 100), /符号链接/);
    assert.throws(() => assertBudget(Array.from({ length: ARCHIVE_LIMITS.maxEntries + 1 }, (_, index) => ({ name: `${index}.txt`, size: 0, packed: 0 }))), /条目/);
    assert.equal(isZipSymlink({ unixPermissions: 0o120777 }), true);
  });

  test('full 7-Zip 是产品依赖并从 app.asar.unpacked 执行', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    assert.equal(pkg.dependencies['7zip-bin-full'], '26.2.1', 'full 7-Zip 必须锁定为 production dependency');
    assert.ok(pkg.build.asarUnpack.includes('node_modules/7zip-bin-full/**'), '7-Zip 可执行文件和 DLL 必须解出 asar');
    assert.equal(pkg.build.afterPack, 'build/prune-7zip-runtime.js', '打包后必须只保留目标平台/架构 runtime');
    const virtual = path.join(path.parse(process.cwd()).root, 'app', 'resources', 'app.asar', 'node_modules', '7zip-bin-full', 'win', 'x64', '7z.exe');
    const expected = virtual.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
    assert.equal(resolveSevenZipPath(virtual, value => value === expected), expected);
    assert.equal(resolveSevenZipPath('7za', () => false), '7za', 'USE_SYSTEM_7ZA 的 PATH 命令不得被当成缺失文件');
    assert.ok(service()._sevenZip(), '源码依赖中的当前平台 full 7-Zip 必须可解析');
    assert.ok(fs.existsSync(path.resolve('resources/licenses/7zip/LICENSE.txt')), '随包必须包含 7-Zip 复合许可证');
    assert.ok(fs.existsSync(path.resolve('resources/licenses/7zip/COPYING.txt')), '随包必须包含 LGPL-2.1 全文');
    assert.ok(fs.existsSync(path.resolve('resources/licenses/7zip/NOTICE.md')), '随包必须包含版本、来源与格式边界');
    assert.deepEqual(targetArchDirs('universal'), ['x64', 'arm64']);
  });

  test('afterPack 只保留目标平台/架构的 full runtime 与相邻 DLL', () => withRoot(root => {
    const runtime = path.join(root, 'resources', 'app.asar.unpacked', 'node_modules', '7zip-bin-full');
    for (const [platform, arches] of Object.entries({ win: ['x64', 'ia32'], mac: ['x64'], linux: ['x64'] })) {
      for (const arch of arches) {
        const dir = path.join(runtime, platform, arch);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, platform === 'win' ? '7z.exe' : '7zz'), 'binary');
        fs.writeFileSync(path.join(dir, 'License.txt'), 'license');
        fs.writeFileSync(path.join(dir, 'readme.txt'), 'readme');
        fs.writeFileSync(path.join(dir, 'History.txt'), 'history');
        if (platform === 'win') {
          fs.writeFileSync(path.join(dir, '7z.dll'), 'engine');
          fs.mkdirSync(path.join(dir, '7zc'));
          fs.writeFileSync(path.join(dir, '7zc', '7z.exe'), 'custom-fork');
        } else {
          fs.writeFileSync(path.join(dir, '7zzc'), 'custom-fork');
          fs.writeFileSync(path.join(dir, '7zzs'), 'unused-static');
        }
      }
    }
    const result = pruneSevenZipRuntime({ appOutDir: root, electronPlatformName: 'win32', arch: 'x64' });
    assert.deepEqual(result.archDirs, ['x64']);
    assert.equal(fs.existsSync(path.join(runtime, 'win', 'x64', '7z.exe')), true);
    assert.equal(fs.existsSync(path.join(runtime, 'win', 'x64', '7z.dll')), true);
    assert.equal(fs.existsSync(path.join(runtime, 'win', 'x64', 'License.txt')), true);
    assert.equal(fs.existsSync(path.join(runtime, 'win', 'x64', '7zc')), false, '未调用的 custom fork 不得随包');
    assert.equal(fs.existsSync(path.join(runtime, 'win', 'ia32')), false);
    assert.equal(fs.existsSync(path.join(runtime, 'mac')), false);
    assert.equal(fs.existsSync(path.join(runtime, 'linux')), false);
  }));

  test('RAR4/RAR5 魔数准确，full engine 明确带 RAR 解码器', () => withRoot(root => {
    const rar4 = path.join(root, 'sample-v4.rar');
    fs.writeFileSync(rar4, Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]));
    assert.equal(sniff(rar4), 'rar');
    const rar5 = path.join(root, 'unsupported-v5.rar');
    fs.writeFileSync(rar5, Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]));
    assert.equal(sniff(rar5), 'rar');
    const info = spawnSync(service()._sevenZip(), ['i'], { encoding: 'utf8', windowsHide: true });
    assert.equal(info.status, 0, info.stderr || info.stdout);
    assert.match(info.stdout, /^\s*\d+\s+.*\bRar5?\b/m, '随包 full engine 必须报告 RAR/RAR5 格式');
  }));

  test('真实 RAR4/RAR5 均可预审、列出并经 staging 解压', () => withRoot(async root => {
    for (const fixture of RAR_FIXTURES) {
      const archive = path.join(root, fixture.name);
      const bytes = Buffer.from(fixture.base64, 'base64');
      assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.sha256, `${fixture.name} fixture 哈希`);
      fs.writeFileSync(archive, bytes);
      assert.equal(sniff(archive), 'rar');

      const listing = await service().list(archive);
      assert.equal(listing.engine, '7zip', listing.error);
      assert.deepEqual(listing.entries.map(entry => ({ name: entry.name, size: entry.size, encrypted: entry.encrypted, link: entry.link })), [
        { name: fixture.entry, size: Buffer.byteLength(fixture.content), encrypted: false, link: false },
      ]);

      const dest = path.join(root, `dest-${path.parse(fixture.name).name}`);
      const extracted = await service()._extractZipFirst({ id: `arc-${fixture.name}`, cancelled: false }, { path: archive, dest });
      assert.equal(extracted.ok, true, extracted.info);
      assert.equal(fs.readFileSync(path.join(dest, fixture.entry), 'utf8'), fixture.content);
      assert.equal(fs.existsSync(stagingPath(dest, `arc-${fixture.name}`)), false);
    }
  }));

  test('魔数覆盖内置引擎实际暴露的 zip/7z/tar/gz/bz2/xz/cab', () => withRoot(root => {
    const cases = [
      ['empty.zip', Buffer.from([0x50, 0x4b, 0x05, 0x06]), 'zip'],
      ['sample.7z', Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), '7z'],
      ['sample.gz', Buffer.from([0x1f, 0x8b]), 'gz'],
      ['sample.bz2', Buffer.from([0x42, 0x5a, 0x68]), 'bz2'],
      ['sample.xz', Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]), 'xz'],
      ['sample.cab', Buffer.from([0x4d, 0x53, 0x43, 0x46]), 'cab'],
    ];
    for (const [name, header, fmt] of cases) {
      const filePath = path.join(root, name);
      fs.writeFileSync(filePath, Buffer.concat([header, Buffer.alloc(300)]));
      assert.equal(sniff(filePath), fmt, name);
    }
    const tar = Buffer.alloc(300);
    tar.write('ustar', 257, 'latin1');
    const tarPath = path.join(root, 'sample.tar');
    fs.writeFileSync(tarPath, tar);
    assert.equal(sniff(tarPath), 'tar');
  }));

  test('单流元数据不足与双层 gzip 在解压前明确拒绝', () => withRoot(async root => {
    for (const [name, header, fmt] of [
      ['sample.bz2', Buffer.from([0x42, 0x5a, 0x68]), 'bz2'],
      ['sample.xz', Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]), 'xz'],
    ]) {
      const archive = path.join(root, name);
      fs.writeFileSync(archive, Buffer.concat([header, Buffer.alloc(32)]));
      const listing = await service().list(archive);
      assert.equal(listing.error, STREAM_METADATA_UNSUPPORTED[fmt]);
      const dest = path.join(root, `dest-${fmt}`);
      const extracted = await service()._extractZipFirst({ id: `arc-${fmt}`, cancelled: false }, { path: archive, dest });
      assert.equal(extracted.info, STREAM_METADATA_UNSUPPORTED[fmt]);
      assert.equal(fs.existsSync(dest), false);
    }
    const nested = path.join(root, 'sample.tar.gz');
    fs.writeFileSync(nested, Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.alloc(32)]));
    assert.equal((await service().list(nested)).error, NESTED_GZIP_UNSUPPORTED);
  }));

  test('超大 ZIP 在整包读入和解析器加载前由 stat 拒绝', () => withRoot(async root => {
    const archive = path.join(root, 'oversized.zip');
    fs.writeFileSync(archive, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    fs.truncateSync(archive, ARCHIVE_LIMITS.maxArchiveBytes + 1);
    const target = service();
    let parserLoaded = false;
    target._jszip = async () => { parserLoaded = true; throw new Error('不应加载 JSZip'); };
    const listing = await target.list(archive);
    assert.match(listing.error, /超过 512 MiB/);
    assert.equal(parserLoaded, false);
  }));

  test('7-Zip 清单只解析分隔线后条目，并在预览前拒绝恶意路径', () => {
    const output = [
      'Path = C:\\outside\\archive.7z',
      'Type = 7z',
      'Physical Size = 123',
      '----------',
      'Path = safe/file.txt',
      'Size = 12',
      'Packed Size = 8',
      'Attributes = A',
      'Encrypted = -',
      '',
    ].join('\n');
    assert.deepEqual(parseSevenZipListing(output), [{ name: 'safe/file.txt', size: 12, packed: 8, dir: false, encrypted: false, link: false }]);
    const malicious = parseSevenZipListing(output.replace('safe/file.txt', '<img src=x onerror=alert(1)>.txt'));
    assert.throws(() => assertBudget(malicious, 123), /不安全/);
  });

  test('缺失的系统 7-Zip 命令正常 reject，不产生未处理 spawn error', async () => {
    const target = service();
    target._sevenZip = () => 'mazz-definitely-missing-7zip-command';
    await assert.rejects(target._runSevenZip(['i']), /ENOENT/);
  });

  test('7-Zip 清单 stdout 超限立即终止，不在主进程无限累加', async () => {
    const target = service();
    target._sevenZip = () => process.execPath;
    await assert.rejects(
      target._runSevenZip(['-e', 'process.stdout.write(Buffer.alloc(4096))'], { maxOutputBytes: 1024 }),
      /清单输出超过 1024 字节/,
    );
  });

  test('当前平台 full 7-Zip 可真实创建、列出并安全解压 7z', () => withRoot(async root => {
    const input = path.join(root, '中文载荷.txt');
    const archive = path.join(root, 'payload.7z');
    const dest = path.join(root, 'dest-7z');
    fs.writeFileSync(input, 'archive-runtime-proof');
    const bin = service()._sevenZip();
    const packed = spawnSync(bin, ['a', archive, input], { encoding: 'utf8', windowsHide: true });
    assert.equal(packed.status, 0, packed.stderr || packed.stdout);
    const listing = await service().list(archive);
    assert.equal(listing.engine, '7zip');
    assert.ok(listing.entries.some(entry => entry.name === '中文载荷.txt'), `清单路径必须固定为 UTF-8：${JSON.stringify(listing.entries)}`);
    const extracted = await service()._extractZipFirst({ id: 'arc-7z-real', cancelled: false }, { path: archive, dest });
    assert.equal(extracted.ok, true, extracted.info);
    assert.equal(fs.readFileSync(path.join(dest, '中文载荷.txt'), 'utf8'), 'archive-runtime-proof');
  }));

  test('header-encrypted 7z 不等待密码输入，清单与解压均 fail closed', () => withRoot(async root => {
    const input = path.join(root, 'secret.txt');
    const archive = path.join(root, 'secret.7z');
    const dest = path.join(root, 'dest-secret');
    fs.writeFileSync(input, 'classified');
    const packed = spawnSync(service()._sevenZip(), ['a', '-psecret', '-mhe=on', archive, input], { encoding: 'utf8', windowsHide: true });
    assert.equal(packed.status, 0, packed.stderr || packed.stdout);
    const started = Date.now();
    const listing = await service().list(archive);
    assert.ok(listing.error, '加密清单必须拒绝');
    const extracted = await service()._extractZipFirst({ id: 'arc-secret', cancelled: false }, { path: archive, dest });
    assert.equal(extracted.ok, false);
    assert.ok(extracted.info);
    assert.ok(Date.now() - started < 5_000, '不得等待交互密码');
    assert.equal(fs.existsSync(dest), false);
    assert.equal(fs.existsSync(stagingPath(dest, 'arc-secret')), false);
  }));

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

  test('ZIP 符号链接在列表预审和创建 staging 前均 fail closed', () => withRoot(async root => {
    const archive = path.join(root, 'symlink.zip');
    const zip = new JSZip();
    zip.file('link-to-outside', '../outside.txt', { unixPermissions: 0o120777 });
    fs.writeFileSync(archive, await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }));

    const listing = await service().list(archive);
    assert.match(listing.error, /符号链接/);

    const dest = path.join(root, 'dest-symlink');
    const extracted = await service()._extractZipFirst({ id: 'arc-symlink', cancelled: false }, { path: archive, dest });
    assert.equal(extracted.ok, false);
    assert.match(extracted.info, /符号链接/);
    assert.equal(fs.existsSync(dest), false);
    assert.equal(fs.existsSync(stagingPath(dest, 'arc-symlink')), false);
    assert.equal(fs.existsSync(path.join(root, 'outside.txt')), false);
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

  test('可预测旧 staging 同名目录与 queued job 销毁均不删除用户文件', () => withRoot(async root => {
    const archive = path.join(root, 'safe.zip');
    const dest = path.join(root, 'collision-dest');
    const legacy = stagingPath(dest, 'arc-collision');
    const sentinel = path.join(legacy, 'user-owned.txt');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(sentinel, 'keep-me');
    await zipAt(archive, { 'payload.txt': 'safe' });

    const job = { id: 'arc-collision', cancelled: false };
    const extracted = await service()._extractZipFirst(job, { path: archive, dest });
    assert.equal(extracted.ok, true, extracted.info);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep-me');
    assert.equal(job.stageOwned, false);
    assert.equal(job.stagePath, null);

    const queuedDest = path.join(root, 'queued-dest');
    const queuedLegacy = stagingPath(queuedDest, 'arc-1');
    const queuedSentinel = path.join(queuedLegacy, 'user-owned.txt');
    fs.mkdirSync(queuedLegacy, { recursive: true });
    fs.writeFileSync(queuedSentinel, 'still-here');
    const target = service();
    target.jobs.set('arc-1', { id: 'arc-1', payload: { dest: queuedDest }, cancelled: false });
    target.destroy('test');
    assert.equal(fs.readFileSync(queuedSentinel, 'utf8'), 'still-here');
  }));

  test('提交竞态和打包输出都使用原子 no-replace，不覆盖并发/既有文件', () => withRoot(async root => {
    const stage = path.join(root, 'manual-stage');
    const dest = path.join(root, 'manual-dest');
    const source = path.join(stage, 'race.txt');
    const target = path.join(dest, 'race.txt');
    fs.mkdirSync(stage);
    fs.writeFileSync(source, 'archive-data');
    const originalCopy = fs.copyFileSync;
    let injected = false;
    fs.copyFileSync = (from, to, flags) => {
      if (!injected && path.resolve(to) === path.resolve(target)) {
        injected = true;
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.writeFileSync(to, 'concurrent-user-data');
      }
      return originalCopy(from, to, flags);
    };
    try {
      assert.throws(() => commitStaging(stage, dest), error => error?.code === 'EEXIST');
    } finally {
      fs.copyFileSync = originalCopy;
    }
    assert.equal(fs.readFileSync(target, 'utf8'), 'concurrent-user-data');

    const input = path.join(root, 'pack-input.txt');
    const out = path.join(root, 'already-exists.zip');
    fs.writeFileSync(input, 'payload');
    fs.writeFileSync(out, 'user-archive');
    const job = { id: 'arc-pack-no-replace', cancelled: false };
    await assert.rejects(service()._pack(job, { sources: [input], out }), error => error?.code === 'EEXIST');
    assert.equal(fs.readFileSync(out, 'utf8'), 'user-archive');
    assert.equal(job.stageOwned, false);
    assert.equal(fs.readdirSync(root).some(name => name.startsWith('already-exists.zip.mazz-arc-pack-no-replace.partial-')), false);
  }));

  test('_end 防御清理由当前 job 原子创建的 owned staging', () => withRoot(root => {
    const target = service();
    const job = { id: 'arc-finalizer', payload: { dest: path.join(root, 'dest') }, cancelled: false };
    const stage = createOwnedStaging(job, job.payload.dest);
    fs.writeFileSync(path.join(stage, 'partial.txt'), 'partial');
    target.jobs.set(job.id, job);
    target.running.add(job.id);
    target._end(job.id, false, 'forced failure');
    assert.equal(fs.existsSync(stage), false);
    assert.equal(job.stageOwned, false);
  }));
});
