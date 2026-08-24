// W93B formal main-process path streaming and atomic promotion contracts.
import * as fs from 'node:fs';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const LibraryImportService = require('../../main/library-import-service.js');

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function fsWith(overrides = {}) {
  return Object.assign(Object.create(fs), overrides);
}

async function withWorkspace(run) {
  const workspace = mkdtempSync(join(tmpdir(), 'mazz-w93b-path-'));
  try { await run(workspace); }
  finally { rmSync(workspace, { recursive: true, force: true }); }
}

describe('W93B Library · bounded path streaming and atomic promotion', () => {
  test('formal path API ignores the legacy maxBytes gate, streams many bounded chunks, fsyncs, and returns full integrity', async () => {
    await withWorkspace(async workspace => {
      const sourcePath = join(workspace, 'source.bin');
      const bytes = Buffer.alloc(64 * 1024 + 17, 0x5a);
      writeFileSync(sourcePath, bytes);

      let sourceFd;
      let sourceReads = 0;
      const directoryFsyncs = [];
      const fdPaths = new Map();
      const fsImpl = fsWith({
        openSync(target, flags, mode) {
          const fd = fs.openSync(target, flags, mode);
          fdPaths.set(fd, String(target));
          if (resolve(String(target)) === resolve(sourcePath)) sourceFd = fd;
          return fd;
        },
        readSync(fd, ...args) {
          if (fd === sourceFd) sourceReads++;
          return fs.readSync(fd, ...args);
        },
        fsyncSync(fd) {
          if (fs.fstatSync(fd).isDirectory()) {
            directoryFsyncs.push(fdPaths.get(fd));
            return;
          }
          fs.fsyncSync(fd);
        },
        closeSync(fd) {
          try { return fs.closeSync(fd); }
          finally { fdPaths.delete(fd); }
        },
      });
      const service = new LibraryImportService({ maxBytes: 1, chunkBytes: 4096, fsImpl });
      const result = await service.materializePath({ workspace, sourcePath, name: 'streamed.bin' }, 'main-owner');

      assert.equal(result.created, true);
      assert.equal(result.reused, false);
      assert.equal(result.path, result.finalPath);
      assert.equal(result.size, bytes.length);
      assert.equal(result.sha256, sha256(bytes));
      assert.equal(result.sourceHash, result.sha256, 'formal identity must be the complete SHA-256');
      assert.ok(sourceReads > 10, 'the source must be copied through repeated bounded reads');
      assert.deepEqual(readFileSync(result.path), bytes);
      assert.ok(directoryFsyncs.some(item => basename(item) === '书库'));
      assert.ok(directoryFsyncs.filter(item => basename(item) === 'staging').length >= 2,
        'staging directory is flushed after staging and after cleanup');
      assert.equal(readdirSync(join(workspace, '书库', '.resources', 'staging')).length, 0);
    });
  });

  test('same content safely reuses one complete target after a full hash verification', async () => {
    await withWorkspace(async workspace => {
      const sourcePath = join(workspace, 'same-source.epub');
      const bytes = Buffer.from('same complete book payload');
      writeFileSync(sourcePath, bytes);
      const service = new LibraryImportService({ chunkBytes: 3 });

      const first = await service.materializePath({ workspace, sourcePath, name: 'same.epub' }, 'A');
      const second = await service.materializePath({ workspace, sourcePath, name: 'same.epub' }, 'B');
      assert.equal(first.created, true);
      assert.equal(second.created, false);
      assert.equal(second.reused, true);
      assert.equal(second.path, first.path);
      assert.equal(second.sha256, sha256(bytes));
      assert.equal(readdirSync(join(workspace, '书库')).filter(name => !name.startsWith('.')).length, 1);
    });
  });

  test('same requested name with different content uses one deterministic full-SHA leaf and never overwrites', async () => {
    await withWorkspace(async workspace => {
      const firstSource = join(workspace, 'one.txt');
      const secondSource = join(workspace, 'two.txt');
      writeFileSync(firstSource, 'content-one');
      writeFileSync(secondSource, 'content-two');
      const service = new LibraryImportService({ chunkBytes: 2 });

      const first = await service.materializePath({ workspace, sourcePath: firstSource, name: 'book.txt' }, 'A');
      const second = await service.materializePath({ workspace, sourcePath: secondSource, name: 'book.txt' }, 'B');
      const repeat = await service.materializePath({ workspace, sourcePath: secondSource, name: 'book.txt' }, 'C');
      const secondDigest = sha256(Buffer.from('content-two'));

      assert.equal(basename(first.path), 'book.txt');
      assert.equal(basename(second.path), `book (${secondDigest}).txt`);
      assert.equal(repeat.path, second.path);
      assert.equal(repeat.reused, true);
      assert.equal(readFileSync(first.path, 'utf8'), 'content-one');
      assert.equal(readFileSync(second.path, 'utf8'), 'content-two');
    });
  });

  test('source mutation during copying is detected from the same opened descriptor and publishes nothing', async () => {
    await withWorkspace(async workspace => {
      const sourcePath = join(workspace, 'changing.txt');
      writeFileSync(sourcePath, Buffer.alloc(8192, 0x41));
      let sourceFd;
      let changed = false;
      const fsImpl = fsWith({
        openSync(target, flags, mode) {
          const fd = fs.openSync(target, flags, mode);
          if (resolve(String(target)) === resolve(sourcePath)) sourceFd = fd;
          return fd;
        },
        readSync(fd, ...args) {
          const read = fs.readSync(fd, ...args);
          if (fd === sourceFd && read > 0 && !changed) {
            changed = true;
            fs.appendFileSync(sourcePath, 'changed-after-open');
          }
          return read;
        },
      });
      const service = new LibraryImportService({ fsImpl, chunkBytes: 1024 });
      await assert.rejects(
        service.materializePath({ workspace, sourcePath, name: 'must-not-publish.txt' }),
        error => error?.code === 'LIBRARY_IMPORT_SOURCE_CHANGED',
      );
      assert.equal(existsSync(join(workspace, '书库', 'must-not-publish.txt')), false);
      assert.deepEqual(readdirSync(join(workspace, '书库', '.resources', 'staging')), []);
    });
  });

  test('source pathname identity replacement after opening is rejected even when size is unchanged', async () => {
    await withWorkspace(async workspace => {
      const sourcePath = join(workspace, 'identity-source.txt');
      writeFileSync(sourcePath, 'same-sized-source');
      let sourceFd;
      let copied = false;
      const fsImpl = fsWith({
        openSync(target, flags, mode) {
          const fd = fs.openSync(target, flags, mode);
          if (resolve(String(target)) === resolve(sourcePath)) sourceFd = fd;
          return fd;
        },
        readSync(fd, ...args) {
          const read = fs.readSync(fd, ...args);
          if (fd === sourceFd && read > 0) copied = true;
          return read;
        },
        lstatSync(target, options) {
          const stat = fs.lstatSync(target, options);
          if (copied && resolve(String(target)) === resolve(sourcePath)) {
            return Object.assign(Object.create(stat), { ino: `${stat.ino}-replacement` });
          }
          return stat;
        },
      });
      const service = new LibraryImportService({ fsImpl, chunkBytes: 4 });
      await assert.rejects(
        service.materializePath({ workspace, sourcePath, name: 'identity-book.txt' }),
        error => error?.code === 'LIBRARY_IMPORT_SOURCE_CHANGED',
      );
      assert.equal(existsSync(join(workspace, '书库', 'identity-book.txt')), false);
    });
  });

  test('verified hash, size, and source identity are re-bound before any formal leaf becomes visible', async () => {
    await withWorkspace(async workspace => {
      const sourcePath = join(workspace, 'verified-source.txt');
      const verified = Buffer.from('verified-good-bytes');
      const rewritten = Buffer.from('rewritten-bad-bytes');
      assert.equal(rewritten.length, verified.length);
      writeFileSync(sourcePath, verified);
      const stat = fs.lstatSync(sourcePath);
      const expectedIdentity = {
        dev: String(stat.dev),
        ino: String(stat.ino),
        birthtimeMs: Number(stat.birthtimeMs),
        ctimeMs: Number(stat.ctimeMs),
        mtimeMs: Number(stat.mtimeMs),
        size: Number(stat.size),
      };
      // Same path and same inode/length, changed after the caller's verify
      // phase but before materializePath enters its private staging copy.
      writeFileSync(sourcePath, rewritten);
      const service = new LibraryImportService({ chunkBytes: 3 });
      await assert.rejects(
        service.materializePath({
          workspace,
          sourcePath,
          name: 'must-remain-invisible.txt',
          expectedSha256: sha256(verified),
          expectedSize: verified.length,
          expectedIdentity,
        }),
        error => error?.code === 'LIBRARY_IMPORT_SOURCE_CHANGED',
      );
      assert.equal(existsSync(join(workspace, '书库', 'must-remain-invisible.txt')), false);
      assert.deepEqual(readdirSync(join(workspace, '书库', '.resources', 'staging')), []);
    });
  });

  test('formal expected SHA accepts only a primitive exact 64-hex string', async () => {
    await withWorkspace(async workspace => {
      const sourcePath = join(workspace, 'strict-source.txt');
      writeFileSync(sourcePath, 'strict expectation');
      const digest = sha256(Buffer.from('strict expectation'));
      const service = new LibraryImportService();
      for (const expectedSha256 of [new String(digest), ` ${digest}`, `${digest}\n`]) {
        await assert.rejects(
          service.materializePath({
            workspace, sourcePath, name: 'strict.txt', expectedSha256,
          }),
          error => error?.code === 'LIBRARY_IMPORT_INVALID_EXPECTATION',
        );
      }
      assert.equal(existsSync(join(workspace, '书库', 'strict.txt')), false);
    });
  });

  test('unsupported exclusive hard-link publication fails closed without a copy fallback', async () => {
    await withWorkspace(async workspace => {
      const sourcePath = join(workspace, 'source.cbz');
      writeFileSync(sourcePath, 'archive bytes');
      let copyCalls = 0;
      const fsImpl = fsWith({
        linkSync() { throw Object.assign(new Error('hard links unavailable'), { code: 'ENOTSUP' }); },
        copyFileSync() { copyCalls++; throw new Error('copy fallback must never execute'); },
      });
      const service = new LibraryImportService({ fsImpl });
      await assert.rejects(
        service.materializePath({ workspace, sourcePath, name: 'archive.cbz' }),
        error => error?.code === 'LIBRARY_IMPORT_ATOMIC_PUBLICATION_UNSUPPORTED'
          && error?.systemCode === 'ENOTSUP',
      );
      assert.equal(copyCalls, 0);
      assert.equal(existsSync(join(workspace, '书库', 'archive.cbz')), false);
      assert.deepEqual(readdirSync(join(workspace, '书库', '.resources', 'staging')), []);
    });
  });

  test('a staging fsync failure remains primary when cleanup also fails', async () => {
    await withWorkspace(async workspace => {
      const sourcePath = join(workspace, 'source.pdf');
      writeFileSync(sourcePath, '%PDF fixture');
      const fsImpl = fsWith({
        fsyncSync(fd) {
          if (fs.fstatSync(fd).isFile()) throw Object.assign(new Error('disk flush failed'), { code: 'EIO' });
          return fs.fsyncSync(fd);
        },
        unlinkSync() { throw Object.assign(new Error('staging cleanup failed'), { code: 'EACCES' }); },
      });
      const service = new LibraryImportService({ fsImpl, chunkBytes: 4 });
      let thrown;
      try { await service.materializePath({ workspace, sourcePath, name: 'book.pdf' }); }
      catch (error) { thrown = error; }
      assert.equal(thrown?.code, 'EIO');
      assert.equal(thrown?.cleanupError?.code, 'EACCES');
      assert.ok(thrown.cleanupErrors.some(error => error.code === 'EACCES'));
      assert.equal(existsSync(join(workspace, '书库', 'book.pdf')), false);
    });
  });

  test('strict leaf and native path validation rejects ADS, devices, aliases, traversal, and trailing dot/space', async () => {
    await withWorkspace(async workspace => {
      const sourcePath = join(workspace, 'source.txt');
      writeFileSync(sourcePath, 'safe');
      const service = new LibraryImportService();
      for (const name of ['CON.txt', 'aux', 'bad.', 'bad ', 'book:stream.txt', '../escape.txt', 'a\\b.txt', 'e\u0301.txt']) {
        await assert.rejects(
          service.materializePath({ workspace, sourcePath, name }),
          error => error?.code === 'LIBRARY_IMPORT_INVALID_NAME',
          `unsafe leaf should be rejected: ${JSON.stringify(name)}`,
        );
      }
      await assert.rejects(
        service.materializePath({ workspace: '.', sourcePath, name: 'book.txt' }),
        error => error?.code === 'LIBRARY_IMPORT_INVALID_WORKSPACE',
      );
      await assert.rejects(
        service.materializePath({ workspace, sourcePath: 'relative.txt', name: 'book.txt' }),
        error => error?.code === 'LIBRARY_IMPORT_INVALID_SOURCE',
      );
      await assert.rejects(
        service.materializePath({ workspace, sourcePath: `${sourcePath}:hidden`, name: 'book.txt' }),
        error => error?.code === 'LIBRARY_IMPORT_INVALID_SOURCE',
      );
      if (process.platform === 'win32') {
        await assert.rejects(
          service.materializePath({ workspace, sourcePath: '\\\\.\\NUL', name: 'book.txt' }),
          error => error?.code === 'LIBRARY_IMPORT_INVALID_SOURCE',
        );
      }
    });
  });

  test('Workspace junction/reparse layout and unsafe occupied destination fail closed', async () => {
    await withWorkspace(async workspace => {
      const sourcePath = join(workspace, 'source.txt');
      const outside = mkdtempSync(join(tmpdir(), 'mazz-w93b-outside-'));
      writeFileSync(sourcePath, 'safe source');
      try {
        const linkedWorkspace = join(outside, 'workspace-link');
        symlinkSync(workspace, linkedWorkspace, process.platform === 'win32' ? 'junction' : 'dir');
        const service = new LibraryImportService();
        await assert.rejects(
          service.materializePath({ workspace: linkedWorkspace, sourcePath, name: 'book.txt' }),
          error => error?.code === 'LIBRARY_IMPORT_UNSAFE_WORKSPACE',
        );

        mkdirSync(join(workspace, '书库'), { recursive: true });
        const occupied = join(workspace, '书库', 'occupied.txt');
        symlinkSync(outside, occupied, process.platform === 'win32' ? 'junction' : 'dir');
        await assert.rejects(
          service.materializePath({ workspace, sourcePath, name: 'occupied.txt' }),
          error => error?.code === 'LIBRARY_IMPORT_UNSAFE_DESTINATION',
        );
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  test('formal path route has no whole-file read, Base64, Buffer.concat, or copy publication dependency', async () => {
    await withWorkspace(async workspace => {
      const sourcePath = join(workspace, 'source.mobi');
      writeFileSync(sourcePath, Buffer.alloc(16387, 0x31));
      const fsImpl = fsWith({
        readFileSync() { throw new Error('formal path route must not call readFileSync'); },
        copyFileSync() { throw new Error('formal path route must not call copyFileSync'); },
      });
      const service = new LibraryImportService({ fsImpl, maxBytes: 1, chunkBytes: 257 });
      const result = await service.materializePath({ workspace, sourcePath, name: 'book.mobi' });
      assert.equal(result.size, 16387);

      const formalSources = [
        LibraryImportService.prototype.materializePath,
        LibraryImportService.prototype._stageSourcePath,
        LibraryImportService.prototype._publishPathStage,
      ].map(fn => fn.toString()).join('\n');
      assert.doesNotMatch(formalSources, /Buffer\.concat|readFileSync|copyFileSync|decodeBase64|\batob\b/);
      assert.doesNotMatch(LibraryImportService.prototype.materializePath.toString(), /this\.maxBytes/);
    });
  });

  test('legacy Base64 materialize API remains available as a compatibility route', async () => {
    await withWorkspace(async workspace => {
      const service = new LibraryImportService({ maxBytes: 1024 });
      const result = await service.materialize({
        workspace,
        name: 'legacy.txt',
        base64: Buffer.from('legacy compatibility').toString('base64'),
      }, 'legacy-owner');
      assert.equal(readFileSync(result.path, 'utf8'), 'legacy compatibility');
    });
  });
});
