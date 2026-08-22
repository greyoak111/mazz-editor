// W88 Library main-process atomic import ownership contracts.
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const LibraryImportService = require('../../main/library-import-service.js');

const b64 = value => Buffer.from(value).toString('base64');
const fingerprint = value => createHash('sha256').update(Buffer.from(value)).digest('hex').slice(0, 20);

async function withWorkspace(run) {
  const workspace = mkdtempSync(join(tmpdir(), 'mazz-library-import-'));
  try { await run(workspace); }
  finally { rmSync(workspace, { recursive: true, force: true }); }
}

describe('W88 Library · cross-renderer atomic import', () => {
  test('two BrowserWindow owners with the same name and different bytes never overwrite each other', async () => {
    await withWorkspace(async workspace => {
      const service = new LibraryImportService();
      const [left, right] = await Promise.all([
        service.materialize({ workspace, name: '同名书.txt', base64: b64('renderer-A'), fingerprint: fingerprint('renderer-A') }, 'window-A'),
        service.materialize({ workspace, name: '同名书.txt', base64: b64('renderer-B'), fingerprint: fingerprint('renderer-B') }, 'window-B'),
      ]);

      assert.notEqual(left.path, right.path, 'different content must receive distinct final paths');
      assert.deepEqual(new Set([readFileSync(left.path, 'utf8'), readFileSync(right.path, 'utf8')]),
        new Set(['renderer-A', 'renderer-B']));
      assert.equal(readdirSync(join(workspace, '书库')).some(name => name.endsWith('.tmp')), false,
        'fully published imports must not leak staging files');

      const foreignCleanup = await service.finalize({ receiptId: right.receiptId, keep: false }, 'window-A');
      assert.deepEqual(foreignCleanup, { ok: false, reason: 'owner-mismatch' });
      assert.equal(existsSync(right.path), true, 'one BrowserWindow cannot delete another owner receipt');

      const ownCleanup = await service.finalize({ receiptId: right.receiptId, keep: false }, 'window-B');
      assert.equal(ownCleanup.deleted, true);
      assert.equal(existsSync(right.path), false);
      assert.equal(existsSync(left.path), true, 'cleanup deletes only the exact created receipt');
      assert.equal((await service.finalize({ receiptId: left.receiptId, keep: true }, 'window-A')).kept, true);
      assert.equal(existsSync(left.path), true);
    });
  });

  test('create-exclusive publication remains correct across independent coordinators', async () => {
    await withWorkspace(async workspace => {
      const coordinatorA = new LibraryImportService();
      const coordinatorB = new LibraryImportService();
      const [left, right] = await Promise.all([
        coordinatorA.materialize({ workspace, name: 'race.cbz', base64: b64('archive-one'), fingerprint: fingerprint('archive-one') }, 'A'),
        coordinatorB.materialize({ workspace, name: 'race.cbz', base64: b64('archive-two'), fingerprint: fingerprint('archive-two') }, 'B'),
      ]);
      assert.notEqual(left.path, right.path);
      assert.deepEqual(new Set([readFileSync(left.path, 'utf8'), readFileSync(right.path, 'utf8')]),
        new Set(['archive-one', 'archive-two']));
      await coordinatorA.finalize({ receiptId: left.receiptId, keep: true }, 'A');
      await coordinatorB.finalize({ receiptId: right.receiptId, keep: true }, 'B');
    });
  });

  test('identical bytes reuse the complete published file instead of making a second copy', async () => {
    await withWorkspace(async workspace => {
      const coordinatorA = new LibraryImportService();
      const coordinatorB = new LibraryImportService();
      const payload = { workspace, name: 'same.epub', base64: b64('same-archive'), fingerprint: fingerprint('same-archive') };
      const [left, right] = await Promise.all([
        coordinatorA.materialize(payload, 'A'),
        coordinatorB.materialize(payload, 'B'),
      ]);
      assert.equal(left.path, right.path);
      assert.equal([left, right].filter(receipt => receipt.created).length, 1);
      assert.equal(readdirSync(join(workspace, '书库')).filter(name => !name.endsWith('.tmp')).length, 1);
      const owner = left.created ? [coordinatorA, left, 'A'] : [coordinatorB, right, 'B'];
      await owner[0].finalize({ receiptId: owner[1].receiptId, keep: true }, owner[2]);
    });
  });

  test('cleanup fails closed after the published bytes are replaced', async () => {
    await withWorkspace(async workspace => {
      const service = new LibraryImportService();
      const receipt = await service.materialize({
        workspace, name: 'changed.txt', base64: b64('original'), fingerprint: fingerprint('original'),
      }, 'window-A');
      writeFileSync(receipt.path, 'replacement');
      const result = await service.finalize({ receiptId: receipt.receiptId, keep: false }, 'window-A');
      assert.equal(result.ok, false);
      assert.equal(result.deleted, false);
      assert.equal(existsSync(receipt.path), true, 'receipt cannot delete content it no longer owns');
    });
  });

  test('main process verifies modern renderer fingerprints before publishing', async () => {
    await withWorkspace(async workspace => {
      const service = new LibraryImportService();
      await assert.rejects(
        service.materialize({ workspace, name: 'mismatch.txt', base64: b64('actual'), fingerprint: fingerprint('claimed-other') }, 'A'),
        error => error?.code === 'LIBRARY_IMPORT_FINGERPRINT_MISMATCH',
      );
      assert.equal(existsSync(join(workspace, '书库')), false, 'mismatched bytes must stop before any write');
    });
  });
});
