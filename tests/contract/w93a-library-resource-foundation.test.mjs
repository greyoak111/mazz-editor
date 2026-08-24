// W93A Library Resource Freedom: pure contracts + durable Workspace truth.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const nodeFs = require('node:fs');
const contract = require('../../main/library-resource-contract.js');
const LibraryAcquisitionStore = require('../../main/library-acquisition-store.js');
const { shouldIgnoreWatchPath } = require('../../main/file-watcher.js');

const NOW = '2026-08-24T00:00:00.000Z';
const LATER = '2026-08-24T00:01:00.000Z';
const SHA = createHash('sha256').update('book-bytes').digest('hex');

function fixtureCandidate(overrides = {}) {
  const workIdentifiers = { gutenberg: ['1342'] };
  const editionIdentifiers = { gutenberg: ['1342'] };
  const workId = contract.deriveWorkId({ identifiers: workIdentifiers });
  const editionId = contract.deriveEditionId({ identifiers: editionIdentifiers });
  const offer = {
    editionId,
    providerId: 'gutenberg',
    resourceId: 'ebooks-1342-epub',
    format: 'epub',
    transport: 'https',
    size: null,
    checksum: '',
    infoHash: '',
    sourceUrl: 'https://www.gutenberg.org/ebooks/1342.epub3.images',
    acquisitionRef: 'gutenberg-1342-epub',
    selectableFiles: [],
    ...(overrides.offer || {}),
  };
  if (overrides.offer?.offerId) offer.offerId = overrides.offer.offerId;
  else {
    try { offer.offerId = contract.deriveOfferId(offer); }
    catch { offer.offerId = 'offer-invalid-fixture'; }
  }
  return {
    schema: contract.CANDIDATE_SCHEMA,
    candidateId: 'candidate-gutenberg-1342',
    work: {
      workId,
      title: 'Pride and Prejudice',
      authors: ['Jane Austen'],
      languages: ['en'],
      subjects: ['Fiction'],
      identifiers: workIdentifiers,
    },
    editions: [{
      editionId,
      title: 'Pride and Prejudice',
      language: 'en',
      publisher: 'Project Gutenberg',
      publishedAt: '1998',
      identifiers: editionIdentifiers,
      description: '',
    }],
    offers: [offer],
    rights: {
      status: 'public-domain',
      licenseId: 'PG-terms',
      rightsStatement: 'Public domain in the USA',
      jurisdiction: 'US',
      evidenceUrl: 'https://www.gutenberg.org/policy/terms_of_use.html',
      assertedBy: 'project-gutenberg',
      checkedAt: NOW,
      confidence: 1,
      ...(overrides.rights || {}),
    },
    provenance: [{
      providerId: 'gutenberg',
      resourceId: '1342',
      pageUrl: 'https://www.gutenberg.org/ebooks/1342',
      observedAt: NOW,
      adapterVersion: 'fixture-v1',
    }],
    ...(overrides.candidate || {}),
  };
}

function fixtureVariantCandidate(label, overrides = {}) {
  return fixtureCandidate({
    ...overrides,
    offer: {
      resourceId: `ebooks-1342-${label}`,
      acquisitionRef: `gutenberg-1342-${label}`,
      ...(overrides.offer || {}),
    },
    candidate: {
      candidateId: `candidate-gutenberg-1342-${label}`,
      ...(overrides.candidate || {}),
    },
  });
}

function fixtureJobForCandidate(workspace, candidateInput, overrides = {}) {
  const candidate = contract.normalizeCandidate(candidateInput);
  const offer = candidate.offers[0];
  const workspacePath = resolve(realpathSync.native ? realpathSync.native(workspace) : realpathSync(workspace));
  const workspaceIdentity = contract.deriveWorkspaceIdentity(workspacePath);
  const selectedFiles = overrides.selectedFiles || [];
  const transportIdentity = contract.deriveTransportIdentity(offer);
  return {
    schema: contract.JOB_SCHEMA,
    revision: 1,
    jobId: 'job-gutenberg-1342',
    intentId: 'intent-gutenberg-1342',
    idempotencyAliases: [],
    workspaceIdentity,
    workspacePath,
    candidateId: candidate.candidateId,
    offerId: offer.offerId,
    providerId: offer.providerId,
    transport: offer.transport,
    transportIdentity,
    selectedFiles,
    rightsStatus: 'public-domain',
    rightsReceipt: {
      decision: 'public-domain',
      authority: 'source-evidence',
      evidenceRef: 'rights-gutenberg-terms',
      at: NOW,
    },
    state: 'queued',
    retryFrom: null,
    bytes: { received: 0, total: null },
    error: null,
    integrity: { sha256: '', declaredChecksum: '', pieceVerified: false },
    stagingPath: '',
    finalPath: '',
    bookId: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function fixtureJob(workspace, overrides = {}) {
  return fixtureJobForCandidate(workspace, fixtureCandidate(), overrides);
}

function fixtureReceipt(workspace, overrides = {}) {
  const workspacePath = resolve(realpathSync.native ? realpathSync.native(workspace) : realpathSync(workspace));
  return {
    schema: contract.INBOX_SCHEMA,
    revision: 1,
    receiptId: 'receipt-gutenberg-1342',
    jobId: 'job-gutenberg-1342',
    workspaceIdentity: contract.deriveWorkspaceIdentity(workspacePath),
    kind: 'library-asset-ready',
    state: 'pending',
    artifact: {
      path: join(workspacePath, '书库', 'Pride and Prejudice.epub'),
      sha256: SHA,
      size: 10,
      format: 'epub',
    },
    createdAt: NOW,
    acknowledgedAt: null,
    ...overrides,
  };
}

async function withWorkspace(run) {
  const workspace = mkdtempSync(join(tmpdir(), 'mazz-w93a-'));
  try { await run(workspace); }
  finally { rmSync(workspace, { recursive: true, force: true }); }
}

function throwsCode(fn, code) {
  assert.throws(fn, error => error?.code === code, `expected ${code}`);
}

describe('W93A Library Resource Freedom · contracts and durable truth', () => {
  test('Candidate normalizes strict Work/Edition/Offer/Rights provenance without secrets', () => {
    const normalized = contract.normalizeCandidate(fixtureCandidate());
    assert.equal(Object.isFrozen(normalized), true);
    assert.equal(normalized.work.identifiers.gutenberg[0], '1342');
    assert.equal(normalized.offers[0].format, 'epub');
    assert.equal(normalized.rights.status, 'public-domain');
    assert.equal(normalized.provenance[0].adapterVersion, 'fixture-v1');

    const withSecret = fixtureCandidate();
    withSecret.provenance[0].pageUrl = 'https://example.org/book?access_token=secret-value';
    assert.throws(() => contract.normalizeCandidate(withSecret), /敏感 query|secret/i);
    const withUnknownField = fixtureCandidate();
    withUnknownField.offers[0].downloadUrl = 'https://example.org/book.epub';
    assert.throws(() => contract.normalizeCandidate(withUnknownField), /未知字段|未冻结字段/);
    const objectTitle = fixtureCandidate();
    objectTitle.work.title = { text: 'Pride and Prejudice' };
    assert.throws(() => contract.normalizeCandidate(objectTitle), /字符串/);
    const objectDescription = fixtureCandidate();
    objectDescription.editions[0].description = ['not', 'protocol text'];
    assert.throws(() => contract.normalizeCandidate(objectDescription), /字符串/);
    for (const mutate of [
      candidate => { candidate.work.authors = false; },
      candidate => { candidate.work.languages = 0; },
      candidate => { candidate.work.subjects = null; },
      candidate => { candidate.work.identifiers = false; },
      candidate => { candidate.work.identifiers.isbn = 0; },
      candidate => { candidate.editions[0].identifiers = null; },
      candidate => { candidate.offers[0].selectableFiles = false; },
      candidate => { candidate.offers[0].sourceUrl = false; },
      candidate => { candidate.rights.evidenceUrl = null; },
    ]) {
      const malformed = fixtureCandidate();
      mutate(malformed);
      assert.throws(() => contract.normalizeCandidate(malformed), /数组|对象|字符串|URL/i,
        'explicit malformed primitives cannot collapse into optional Candidate defaults');
    }
  });

  test('strong identities do not merge same-title works and Blob identity is full SHA-256', () => {
    const left = contract.deriveWorkId({ identifiers: { gutenberg: ['1'] } });
    const right = contract.deriveWorkId({ identifiers: { gutenberg: ['2'] } });
    assert.notEqual(left, right, 'same title is deliberately absent from the strong identity');
    assert.notEqual(
      contract.deriveWorkId({ providerId: 'fixture', resourceId: 'é-book', identifiers: {} }),
      contract.deriveWorkId({ providerId: 'fixture', resourceId: 'e\u0301-book', identifiers: {} }),
      'opaque source identities are not Unicode-normalized into a false merge',
    );
    assert.throws(() => contract.deriveWorkId({
      providerId: 'fixture', resourceId: ' padded-id ', identifiers: {},
    }), /非法/);
    assert.equal(left, contract.deriveWorkId({ identifiers: { gutenberg: ['1'] } }));
    assert.notEqual(
      contract.deriveEditionId({ identifiers: { isbn: ['978-0-306-40615-7'] } }),
      contract.deriveEditionId({ identifiers: { isbn: ['978-3-16-148410-0'] } }),
    );
    assert.equal(contract.deriveBlobId(SHA), `blob-sha256-${SHA}`);
    assert.throws(() => contract.deriveBlobId(SHA.slice(0, 20)), /完整 SHA-256/);
    assert.throws(() => contract.deriveBlobId(` ${SHA} `), /完整 SHA-256/);
    assert.throws(() => contract.normalizeInfoHash(` ${'a'.repeat(40)} `), /BTIH/);
    assert.throws(() => contract.normalizeChecksum(` ${SHA} `), /checksum|非法/);
    for (const identifiers of [
      { isbn: ['-'] }, { isbn: ['123'] }, { isbn: ['0000000000'] },
      { isbn: ['9781234567890'] }, { isbn: ['4006381333931'] },
      { doi: ['doi:'] }, { doi: ['10.123'] },
      { olid: ['not-an-olid'] }, { olid: ['OL1A'] }, { olid: ['OL1Z'] },
      { gutenberg: ['not-a-number'] }, { ia: ['../escape'] },
    ]) assert.throws(() => contract.deriveWorkId({ identifiers }), /字符串|格式.*非法/);
    assert.match(contract.deriveWorkId({ identifiers: { isbn: ['123456789X'] } }), /^work-/);
    assert.match(contract.deriveWorkId({ identifiers: { isbn: ['9780306406157'] } }), /^work-/);
    assert.match(contract.deriveWorkId({ identifiers: { isbn: ['9791090636071'] } }), /^work-/);
    assert.match(contract.deriveWorkId({ identifiers: { olid: ['OL123W'] } }), /^work-/);
    assert.match(contract.deriveEditionId({ identifiers: { olid: ['OL456M'] } }), /^edition-/);
    assert.throws(() => contract.deriveWorkId({ identifiers: { olid: ['OL456M'] } }), /Work OLID/);
    assert.throws(() => contract.deriveEditionId({ identifiers: { olid: ['OL123W'] } }), /Edition OLID/);
    const offer = fixtureCandidate().offers[0];
    assert.equal(contract.deriveOfferId(offer), contract.deriveOfferId({ ...offer }));
    assert.notEqual(contract.deriveOfferId(offer), contract.deriveOfferId({ ...offer, format: 'pdf' }));
    const forged = fixtureCandidate();
    forged.work.workId = 'work-forged';
    assert.throws(() => contract.normalizeCandidate(forged), /Work ID/);
  });

  test('format, URL and selected-file boundaries reject unsupported or unsafe input', () => {
    assert.deepEqual(contract.FORMATS, ['epub', 'cbz', 'txt', 'mobi', 'azw3', 'pdf']);
    for (const format of ['azw', 'fb2', 'exe']) {
      const candidate = fixtureCandidate({ offer: { format } });
      assert.throws(() => contract.normalizeCandidate(candidate), /format 非法/);
    }
    for (const url of [
      'http://example.org/a.epub',
      'https://127.0.0.1/a.epub',
      'https://192.168.1.2/a.epub',
      'https://[::ffff:127.0.0.1]/a.epub',
      'https://[::ffff:10.0.0.1]/a.epub',
      'https://[::7f00:1]/a.epub',
      'https://[64:ff9b::7f00:1]/a.epub',
      'https://[2002:7f00:1::1]/a.epub',
      'https://[fec0::1]/a.epub',
      'https://[100::1]/a.epub',
      'https://[2001:2::1]/a.epub',
      'https://[2606:4700:4700::1111]/a.epub',
      'https://8.8.8.8/a.epub',
      'https://user:password@example.org/a.epub',
      'https://example.org/a.epub?X-Amz-Signature=secret',
      'https://example.org/a.epub?%2574oken=secret-value',
      'https://example.org/a.epub?%2561ccess_token=secret-value',
      'https://example.org/a.epub?file=%73k-proj-abcdefghijklmnopqrstu',
      'https://example.org/a.epub?file=Bearer%20abcdefghijklmno',
      'https://example.org/a.epub?file=Bearer+abcdefghijklmno',
      'https://example.org/a.epub?redirect=https%3A%2F%2Fcdn.org%2Fa%3Ftoken%3Dsecret-value',
      'https://example.org/a.epub?next=%252Fa%253Faccess_token%253Dsecret-value',
      'https://example.org/a?next=https%253A%252F%252Fcdn.org%252Fa%253Ffile%253DBearer%252Babcdefghijklmnop',
      'https://example.org/a?next=%252Fa%253Ffile%253DBearer%25252Babcdefghijklmnop',
      'https://example.org/a#file=Bearer+abcdefghijklmnop',
      'https://example.org/a#next=https%253A%252F%252Fcdn.org%252Fa%253Ffile%253DBearer%252Babcdefghijklmnop',
    ]) assert.throws(() => contract.assertHttpsPublicUrl(url), /HTTPS|userinfo|敏感 query|secret/i);
    assert.equal(contract.assertHttpsPublicUrl('https://example.org/a.epub'), 'https://example.org/a.epub');
    for (const secret of [
      'Authorization: Basic dXNlcjpwYXNz',
      'Cookie: session=abc',
      'Set-Cookie: session=abc',
      'X-Api-Key: abc',
      'Bearer abcdefghijklmnop',
      'sk-proj-abcdefghijklmnop',
    ]) assert.throws(() => contract.assertNoSecretString(secret), /secret/i);

    assert.deepEqual(
      contract.normalizeSelectedFiles(['books/a.epub', 'books/a.epub', 'books/b.pdf']),
      ['books/a.epub', 'books/b.pdf'],
    );
    assert.deepEqual(
      contract.normalizeSelectedFiles([' book.epub', 'book.epub']),
      [' book.epub', 'book.epub'],
      'leading-space archive entries remain distinct filesystem identities',
    );
    assert.deepEqual(
      contract.normalizeSelectedFiles(['é.epub', 'e\u0301.epub']),
      ['é.epub', 'e\u0301.epub'],
      'Unicode normalization variants remain distinct archive entry identities',
    );
    for (const selected of [
      '../a.epub', '/a.epub', 'C:/a.epub', 'a\\b.epub', 'a/../b', 'a//b.epub',
      'a:b.epub', 'CON', `a/${String.fromCharCode(0)}b.epub`,
      'book.epub ', '   ',
    ]) {
      assert.throws(() => contract.normalizeSelectedFiles([selected]), /路径|ADS|设备名|相对|规范|非法|禁止|控制字符/);
    }
    for (const acquisitionRef of [
      '/home/alice/private/book.epub',
      'C:\\Users\\Alice\\private.epub',
      '\\\\server\\share\\private.epub',
      '../relative/file.epub',
    ]) assert.throws(() => contract.deriveTransportIdentity({
      providerId: 'fixture', transport: 'local', acquisitionRef,
    }), /不透明/);
  });

  test('Rights gate cannot turn unknown/restricted evidence into a transport receipt', async () => {
    const rightsFixtures = {
      'public-domain': {
        status: 'public-domain', licenseId: 'PD', rightsStatement: 'Public domain', jurisdiction: 'US',
        evidenceUrl: 'https://example.org/rights/pd', assertedBy: 'fixture', checkedAt: NOW, confidence: 1,
      },
      'open-license': {
        status: 'open-license', licenseId: 'CC0-1.0', rightsStatement: 'Open license', jurisdiction: 'worldwide',
        evidenceUrl: 'https://example.org/rights/cc0', assertedBy: 'fixture', checkedAt: NOW, confidence: 1,
      },
      'user-owned': {
        status: 'user-owned', licenseId: '', rightsStatement: 'User declaration', jurisdiction: '',
        evidenceUrl: '', assertedBy: 'user', checkedAt: NOW, confidence: 1,
      },
      unknown: {
        status: 'unknown', licenseId: '', rightsStatement: '', jurisdiction: '', evidenceUrl: '',
        assertedBy: '', checkedAt: '', confidence: null,
      },
      restricted: {
        status: 'restricted', licenseId: '', rightsStatement: 'Restricted', jurisdiction: 'US', evidenceUrl: '',
        assertedBy: 'fixture', checkedAt: NOW, confidence: 1,
      },
    };
    for (const [status, value] of Object.entries(rightsFixtures)) {
      assert.equal(contract.normalizeRights(value).status, status);
    }
    assert.throws(() => contract.assertNoSecrets({ nested: { apiKey: 'not-persistable' } }), /secret 字段/);
    await withWorkspace(async workspace => {
      const candidate = fixtureCandidate({ rights: {
        status: 'unknown',
        licenseId: '',
        rightsStatement: '',
        jurisdiction: '',
        evidenceUrl: '',
        assertedBy: '',
        checkedAt: '',
        confidence: null,
      } });
      const awaiting = { ...fixtureJob(workspace), state: 'awaiting-rights', rightsReceipt: null };
      awaiting.rightsStatus = 'unknown';
      assert.equal(contract.normalizeJob(awaiting, { candidate }).state, 'awaiting-rights');
      assert.throws(() => contract.normalizeJob({ ...awaiting, state: 'queued' }, { candidate }), /unknown Rights/);
      assert.throws(() => contract.normalizeRightsReceipt({
        decision: 'unknown', authority: 'source', evidenceRef: 'evidence', at: NOW,
      }), /不能通过/);
      assert.throws(() => contract.normalizeRightsReceipt({
        decision: 'user-owned', authority: 'source', evidenceRef: 'claim', at: NOW,
      }), /authority=user/);
      assert.equal(contract.normalizeRightsReceipt({
        decision: 'user-owned', authority: 'user', evidenceRef: 'user-declaration', at: NOW,
      }).decision, 'user-owned');
    });
  });

  test('Job identity is workspace-bound, selection-order invariant and state-machine guarded', async () => {
    await withWorkspace(async workspace => {
      const workspaceIdentity = contract.deriveWorkspaceIdentity(workspace);
      const common = {
        workspaceIdentity,
        intentId: 'intent-order-invariant',
        offerId: 'offer-one',
        transportIdentity: 'btih:0123456789012345678901234567890123456789',
      };
      assert.equal(
        contract.deriveAcquisitionIdempotencyKey({ ...common, selectedFiles: ['b.epub', 'a.pdf'] }),
        contract.deriveAcquisitionIdempotencyKey({ ...common, selectedFiles: ['a.pdf', 'b.epub'] }),
      );
      assert.notEqual(
        contract.deriveAcquisitionIdempotencyKey({ ...common, selectedFiles: ['a.pdf'] }),
        contract.deriveAcquisitionIdempotencyKey({ ...common, selectedFiles: ['b.epub'] }),
      );
      for (const padded of [
        { ...common, offerId: ` ${common.offerId} ` },
        { ...common, transportIdentity: ` ${common.transportIdentity} ` },
      ]) {
        assert.throws(() => contract.deriveAcquisitionIdempotencyKey({
          ...padded, selectedFiles: ['a.pdf'],
        }), /offerId|transportIdentity|非法/,
        'opaque acquisition identities must never be silently trimmed');
      }
      assert.equal(contract.assertJobTransition('queued', 'downloading'), true);
      assert.throws(() => contract.assertJobTransition('queued', 'imported'), /非法/);
      assert.throws(() => contract.assertJobTransition('imported', 'queued'), /终态/);
      assert.equal(contract.assertJobTransition('failed', 'downloading', { retryFrom: 'downloading' }), true);
      assert.equal(contract.assertJobTransition('failed', 'cancelled', { retryFrom: 'downloading' }), true);
      assert.throws(() => contract.assertJobTransition('failed', 'queued', { retryFrom: 'downloading' }), /retryFrom/);
      for (const state of contract.JOB_STATES.filter(state => !contract.TERMINAL_JOB_STATES.includes(state) && state !== 'failed')) {
        assert.equal(contract.assertJobTransition(state, 'failed', { retryFrom: state }), true, `${state} can fail durably`);
        const wrongRetryFrom = state === 'queued' ? 'resolving' : 'queued';
        assert.throws(() => contract.assertJobTransition(state, 'failed', { retryFrom: wrongRetryFrom }), /retryFrom/);
      }
      assert.throws(() => contract.normalizeJob({
        ...fixtureJob(workspace), state: 'queued', retryFrom: 'downloading',
      }, { candidate: fixtureCandidate() }), /retryFrom 只能/);
      assert.throws(() => contract.normalizeJob({
        ...fixtureJob(workspace), state: 'failed', retryFrom: 'queued', error: null,
      }, { candidate: fixtureCandidate() }), /脱敏 error/);
      assert.throws(() => contract.normalizeJob({
        ...fixtureJob(workspace), jobId: ' padded-job-id ',
      }, { candidate: fixtureCandidate() }), /安全 ID/);
      const injectedAlias = `acq-${'f'.repeat(64)}`;
      assert.throws(() => contract.normalizeJob({
        ...fixtureJob(workspace), idempotencyAliases: [injectedAlias],
      }, { candidate: fixtureCandidate() }), /选档前请求键/);

      const candidate = fixtureCandidate();
      const durable = contract.normalizeJob(fixtureJob(workspace), { candidate });
      const durableContext = {
        durableRecord: true,
        workspacePath: durable.workspacePath,
        workspaceIdentity: durable.workspaceIdentity,
      };
      for (const field of [
        'revision', 'idempotencyKey', 'idempotencyAliases', 'selectedFiles', 'bytes',
        'integrity', 'stagingPath', 'finalPath', 'bookId', 'createdAt', 'updatedAt',
      ]) {
        assert.throws(() => contract.normalizeJob({ ...durable, [field]: null }, durableContext),
          /durable|类型|字符串|整数/i);
      }
      assert.throws(() => contract.normalizeJob({
        ...durable, bytes: { received: 0 },
      }, durableContext), /缺少字段/);
      assert.throws(() => contract.normalizeJob({
        ...durable, integrity: { sha256: '', declaredChecksum: '' },
      }, durableContext), /缺少字段/);
      assert.throws(() => contract.normalizeJob({
        ...durable, candidateFingerprint: 'opaque-not-a-digest',
      }, durableContext), /完整 Candidate SHA-256/);
      assert.throws(() => contract.normalizeJob({
        ...fixtureJob(workspace), transportIdentity: 'ref:gutenberg:https:different-resource',
      }, { candidate }), /transportIdentity 与 Offer 不匹配/);
      assert.throws(() => contract.normalizeJob({
        ...fixtureJob(workspace),
        transportIdentity: ` ${fixtureJob(workspace).transportIdentity} `,
      }, { candidate }), /transportIdentity|非法/);
      for (const [field, value] of [
        ['selectedFiles', false],
        ['idempotencyAliases', 0],
        ['idempotencyKey', false],
        ['bytes', null],
        ['integrity', false],
        ['stagingPath', null],
        ['finalPath', 0],
        ['bookId', false],
        ['createdAt', null],
        ['updatedAt', 0],
      ]) {
        assert.throws(() => contract.normalizeJob({
          ...fixtureJob(workspace), [field]: value,
        }, { candidate }), /数组|对象|字符串|路径|时间|idempotency|bytes|integrity|bookId/i,
        `${field} cannot collapse into a non-durable default`);
      }
      assert.throws(() => contract.normalizeJobError({
        code: 'DOWNLOAD_FAILED', message: 'failed at C:\\Users\\alice\\book.epub',
      }), /路径/);
      assert.throws(() => contract.normalizeJobError({
        code: 'DOWNLOAD_FAILED', message: 'failed at \\\\server\\share\\book.epub',
      }), /路径/);
      assert.throws(() => contract.normalizeJobError({
        code: 'DOWNLOAD_FAILED', message: 'failed at /home/alice/book.epub',
      }), /路径/);
      assert.throws(() => contract.normalizeJobError({
        code: 'DOWNLOAD_FAILED', message: 'failed at file:///home/alice/book.epub',
      }), /URL|路径/);
      assert.throws(() => contract.normalizeJobError({
        code: ' DOWNLOAD_FAILED ', message: 'transport failed',
      }), /内部稳定错误标识/);
      for (const message of [
        'failure path=/home/alice/.ssh/id_rsa',
        'failure at[/etc/passwd]',
        'failure path=C:\\Users\\alice\\book.epub',
        'failure path=\\\\server\\share\\book.epub',
        'failure path=C%3A%5CUsers%5Calice%5Csecret.epub',
        'failure path=%2Fhome%2Falice%2Fsecret.epub',
        'failure at file%3A%2F%2F%2Fhome%2Falice%2Fsecret.epub',
        'provider returned data:text/plain,private-response-body',
        'contact mailto:alice@example.org',
        'retry magnet:?xt=urn:btih:0123456789012345678901234567890123456789',
      ]) assert.throws(() => contract.normalizeJobError({ code: 'DOWNLOAD_FAILED', message }), /路径/);
      for (const message of [
        '下载进度 50% 时失败',
        'checksum mismatch: expected 100%',
        'provider returned %PDF header',
      ]) assert.equal(contract.normalizeJobError({ code: 'DOWNLOAD_FAILED', message }).message, message);
      for (const message of [
        'Authorization: Basic dXNlcjpwYXNz', 'Cookie: a=b', 'Set-Cookie: a=b', 'X-Api-Key: abc',
        'server said {"access_token":"supersecretvalue"}',
        'response: {"apiKey":"abcdefghijklmnop"}',
        'credential password=correct-horse-battery',
        'client_secret: abcdefghijklmnop',
        'server%20said%20%7B%22access_token%22%3A%22supersecretvalue%22%7D',
      ]) assert.throws(() => contract.normalizeJobError({ code: 'DOWNLOAD_FAILED', message }), /secret/i);
      for (const code of [
        'mailto:user@example.org', 'urn:secret:thing', 'https:example.org', 'C:UsersAlice',
        'download failed', 'access_token',
      ]) assert.throws(() => contract.normalizeJobError({ code, message: '下载失败' }), /错误标识|secret/i);
      assert.equal(contract.normalizeJobError({
        code: 'ERR_CONNECTION_RESET', message: '连接被远端重置',
      }).code, 'ERR_CONNECTION_RESET');
    });
  });

  test('a missing Rights receipt cannot be escalated into source authority during Store updates', async () => {
    await withWorkspace(async workspace => {
      const store = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW, recoverOnOpen: false });
      const unknownCandidate = fixtureCandidate({ rights: {
        status: 'unknown', licenseId: '', rightsStatement: '', jurisdiction: '', evidenceUrl: '',
        assertedBy: '', checkedAt: '', confidence: null,
      } });
      const unknown = store.createJob({
        ...fixtureJob(workspace),
        jobId: 'job-awaiting-rights',
        state: 'awaiting-rights',
        rightsStatus: 'unknown',
        rightsReceipt: null,
      }, { candidate: unknownCandidate });
      throwsCode(() => store.transitionJob(unknown.jobId, 'inspecting', {
        expectedRevision: 1,
        patch: {
          rightsReceipt: {
            decision: 'public-domain', authority: 'source-evidence', evidenceRef: 'invented', at: NOW,
          },
        },
      }), 'LIBRARY_ACQUISITION_RIGHTS_ESCALATION_FORBIDDEN');
      const userOwned = store.transitionJob(unknown.jobId, 'inspecting', {
        expectedRevision: 1,
        patch: {
          rightsReceipt: {
            decision: 'user-owned', authority: 'user', evidenceRef: 'explicit-user-declaration', at: NOW,
          },
        },
      });
      assert.equal(userOwned.rightsReceipt.decision, 'user-owned');
      throwsCode(() => store.updateJob(userOwned.jobId, {
        expectedRevision: 2,
        patch: { rightsReceipt: { ...userOwned.rightsReceipt, evidenceRef: 'rewritten' } },
      }), 'LIBRARY_ACQUISITION_IMMUTABLE_FIELD');

      const restrictedCandidate = fixtureVariantCandidate('restricted', { rights: {
        status: 'restricted', licenseId: '', rightsStatement: 'Not licensed for acquisition',
        jurisdiction: 'US', evidenceUrl: '', assertedBy: 'source', checkedAt: NOW, confidence: 1,
      } });
      const restricted = store.createJob({
        ...fixtureJobForCandidate(workspace, restrictedCandidate, {
          jobId: 'job-restricted',
          state: 'awaiting-rights', rightsStatus: 'restricted', rightsReceipt: null,
        }),
      }, { candidate: restrictedCandidate });
      throwsCode(() => store.transitionJob(restricted.jobId, 'inspecting', {
        expectedRevision: 1,
        patch: {
          rightsReceipt: {
            decision: 'user-owned', authority: 'user', evidenceRef: 'cannot-upgrade-restricted', at: NOW,
          },
        },
      }), 'LIBRARY_ACQUISITION_RIGHTS_ESCALATION_FORBIDDEN');
      throwsCode(
        () => store.createJob(fixtureJob(workspace, { jobId: 'no-candidate' })),
        'LIBRARY_ACQUISITION_CANDIDATE_REQUIRED',
      );
      const noReceiptCandidate = fixtureVariantCandidate('no-receipt');
      throwsCode(
        () => store.createJob({
          ...fixtureJobForCandidate(workspace, noReceiptCandidate, { jobId: 'public-without-receipt' }),
          state: 'discovered',
          rightsReceipt: null,
        }, { candidate: noReceiptCandidate }),
        'LIBRARY_ACQUISITION_RIGHTS_RECEIPT_REQUIRED',
      );
    });
  });

  test('Store creates an isolated Workspace ledger with create/idempotency/CAS semantics', async () => {
    await withWorkspace(async workspace => {
      let clock = NOW;
      const store = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => clock, recoverOnOpen: false });
      for (const key of ['jobsRoot', 'inboxRoot', 'stagingRoot', 'quarantineRoot']) {
        assert.equal(existsSync(store.paths[key]), true, `${key} must exist`);
      }
      for (const malformedId of [
        new String('boxed-job-id'),
        { toJSON() { return 'tojson-job-id'; } },
      ]) {
        throwsCode(() => store.putJob({
          ...fixtureJob(workspace), jobId: malformedId,
        }, { candidate: fixtureCandidate() }), 'LIBRARY_ACQUISITION_INVALID_RECORD_ID');
      }
      const boxedStagingPath = new String(join(store.paths.stagingRoot, 'payload.part'));
      assert.throws(() => store.putJob({
        ...fixtureJob(workspace), jobId: 'boxed-staging-job', stagingPath: boxedStagingPath,
      }, { candidate: fixtureCandidate() }), /路径字符串|普通对象/);
      assert.equal(readdirSync(store.paths.jobsRoot).length, 0,
        'malformed native protocol types must not reach durable publication');
      const created = store.putJob(fixtureJob(workspace), { candidate: fixtureCandidate() });
      assert.equal(created.created, true);
      assert.equal(created.job.revision, 1);
      assert.equal(created.job.candidateFingerprint,
        contract.deriveCandidateFingerprint(fixtureCandidate()));
      const replay = store.putJob(
        { ...fixtureJob(workspace), jobId: 'different-replay-id' },
        { candidate: fixtureCandidate() },
      );
      assert.equal(replay.idempotent, true);
      assert.equal(replay.job.jobId, created.job.jobId, 'same acquisition replays the durable receipt');

      clock = LATER;
      const downloading = store.transitionJob(created.job.jobId, 'downloading', { expectedRevision: 1 });
      assert.equal(downloading.revision, 2);
      assert.equal(downloading.state, 'downloading');
      throwsCode(() => store.updateJob(created.job.jobId, { expectedRevision: 1, patch: { state: 'paused' } }),
        'LIBRARY_ACQUISITION_REVISION_CONFLICT');
      throwsCode(() => store.updateJob(created.job.jobId, {
        expectedRevision: 2, patch: { workspacePath: resolve(workspace, 'elsewhere') },
      }), 'LIBRARY_ACQUISITION_IMMUTABLE_FIELD');
      throwsCode(() => store.updateJob(created.job.jobId, {
        expectedRevision: 2,
        patch: { rightsReceipt: { ...created.job.rightsReceipt, evidenceRef: 'changed-evidence' } },
      }), 'LIBRARY_ACQUISITION_IMMUTABLE_FIELD');
      assert.throws(() => store.updateJob(created.job.jobId, {
        expectedRevision: 2,
        patch: { stagingPath: boxedStagingPath },
      }), /路径字符串|普通对象|字段类型非法/);

      const persisted = JSON.parse(readFileSync(join(store.paths.jobsRoot, `${created.job.jobId}.json`), 'utf8'));
      assert.equal(persisted.state, 'downloading');
      assert.equal(readdirSync(store.paths.jobsRoot).some(name => name.endsWith('.tmp')), false);
    });
  });

  test('two Workspace stores keep identical offers in separate durable identities', async () => {
    const workspaceA = mkdtempSync(join(tmpdir(), 'mazz-w93a-workspace-a-'));
    const workspaceB = mkdtempSync(join(tmpdir(), 'mazz-w93a-workspace-b-'));
    try {
      const left = new LibraryAcquisitionStore({ workspacePath: workspaceA, now: () => NOW, recoverOnOpen: false });
      const right = new LibraryAcquisitionStore({ workspacePath: workspaceB, now: () => NOW, recoverOnOpen: false });
      throwsCode(() => new LibraryAcquisitionStore({
        workspacePath: workspaceA, workspaceIdentity: { tenant: 'A' }, recoverOnOpen: false,
      }), 'LIBRARY_ACQUISITION_INVALID_WORKSPACE');
      throwsCode(() => new LibraryAcquisitionStore({
        workspacePath: workspaceA, workspaceIdentity: 'workspace-forged', recoverOnOpen: false,
      }), 'LIBRARY_ACQUISITION_INVALID_WORKSPACE');
      const leftJob = left.createJob(fixtureJob(workspaceA), { candidate: fixtureCandidate() });
      const rightJob = right.createJob(fixtureJob(workspaceB), { candidate: fixtureCandidate() });
      assert.notEqual(left.workspaceIdentity, right.workspaceIdentity);
      assert.notEqual(leftJob.idempotencyKey, rightJob.idempotencyKey);
      assert.equal(left.listJobs().length, 1);
      assert.equal(right.listJobs().length, 1);
      assert.equal(left.listJobs()[0].workspacePath, left.workspacePath);
      assert.equal(right.listJobs()[0].workspacePath, right.workspacePath);
    } finally {
      rmSync(workspaceA, { recursive: true, force: true });
      rmSync(workspaceB, { recursive: true, force: true });
    }
  });

  test('filesystem mutation locks fail closed and never auto-delete orphan or replacement owners', async () => {
    await withWorkspace(async workspace => {
      const first = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW, recoverOnOpen: false });
      const second = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW, recoverOnOpen: false });
      const jobInput = fixtureJob(workspace);
      const normalized = contract.normalizeJob(jobInput, { candidate: fixtureCandidate() });
      const idempotencyLock = first._lockPath(`job-idempotency:${normalized.idempotencyKey}`);
      writeFileSync(idempotencyLock, JSON.stringify({ pid: process.pid, token: 'external-live-owner', acquiredAt: NOW }));
      throwsCode(
        () => second.putJob(jobInput, { candidate: fixtureCandidate() }),
        'LIBRARY_ACQUISITION_BUSY',
      );
      unlinkSync(idempotencyLock);
      const created = first.createJob(jobInput, { candidate: fixtureCandidate() });

      const recordLock = first._lockPath(`job-record:${created.jobId}`);
      writeFileSync(recordLock, JSON.stringify({ pid: process.pid, token: 'external-live-owner', acquiredAt: NOW }));
      throwsCode(
        () => second.transitionJob(created.jobId, 'downloading', { expectedRevision: 1 }),
        'LIBRARY_ACQUISITION_BUSY',
      );
      assert.equal(JSON.parse(readFileSync(join(first.paths.jobsRoot, `${created.jobId}.json`), 'utf8')).revision, 1);
      unlinkSync(recordLock);
      assert.equal(second.transitionJob(created.jobId, 'downloading', { expectedRevision: 1 }).revision, 2);

      const replayInput = fixtureJob(workspace, { jobId: 'malformed-lock-replay' });
      const replay = contract.normalizeJob(replayInput, { candidate: fixtureCandidate() });
      const staleLock = first._lockPath(`job-idempotency:${replay.idempotencyKey}`);
      writeFileSync(staleLock, '');
      throwsCode(
        () => second.putJob(replayInput, { candidate: fixtureCandidate() }),
        'LIBRARY_ACQUISITION_LOCK_REPAIR_REQUIRED',
      );
      assert.equal(readFileSync(staleLock, 'utf8'), '', 'orphan evidence is retained for explicit repair');
      unlinkSync(staleLock);

      const ownershipScope = 'release-owner-token-check';
      const ownershipLock = first._lockPath(ownershipScope);
      throwsCode(() => first._withMutationLock(ownershipScope, () => {
        writeFileSync(ownershipLock, JSON.stringify({
          pid: process.pid, token: 'replacement-owner', acquiredAt: NOW,
        }));
      }), 'LIBRARY_ACQUISITION_LOCK_OWNERSHIP_LOST');
      assert.equal(JSON.parse(readFileSync(ownershipLock, 'utf8')).token, 'replacement-owner');
      unlinkSync(ownershipLock);
      assert.deepEqual(readdirSync(first.paths.locksRoot), []);
    });
  });

  test('interleaved coordinators cannot publish duplicate idempotency keys or lose CAS updates', async () => {
    await withWorkspace(async workspace => {
      const second = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW, recoverOnOpen: false });
      const hookedFs = Object.create(nodeFs);
      let phase = 'create';
      let createInterleaveError = null;
      let updateInterleaveError = null;
      let createInjected = false;
      let updateInjected = false;
      let firstJobsRoot = '';
      hookedFs.linkSync = (source, target) => {
        if (phase === 'create' && !createInjected
          && target === join(firstJobsRoot, 'job-interleave-a.json')) {
          createInjected = true;
          try {
            second.putJob(
              { ...fixtureJob(workspace), jobId: 'job-interleave-b' },
              { candidate: fixtureCandidate() },
            );
          } catch (error) { createInterleaveError = error; }
        }
        return nodeFs.linkSync(source, target);
      };
      hookedFs.renameSync = (source, target) => {
        if (phase === 'update' && !updateInjected
          && target === join(firstJobsRoot, 'job-interleave-a.json')) {
          updateInjected = true;
          try {
            second.transitionJob('job-interleave-a', 'downloading', { expectedRevision: 1 });
          } catch (error) { updateInterleaveError = error; }
        }
        return nodeFs.renameSync(source, target);
      };
      const first = new LibraryAcquisitionStore({
        workspacePath: workspace, now: () => NOW, recoverOnOpen: false, fsImpl: hookedFs,
      });
      firstJobsRoot = first.paths.jobsRoot;
      first.putJob(
        { ...fixtureJob(workspace), jobId: 'job-interleave-a' },
        { candidate: fixtureCandidate() },
      );
      assert.equal(createInterleaveError?.code, 'LIBRARY_ACQUISITION_BUSY');
      assert.deepEqual(first.listJobs().map(job => job.jobId), ['job-interleave-a']);

      phase = 'update';
      const updated = first.transitionJob('job-interleave-a', 'downloading', { expectedRevision: 1 });
      assert.equal(updateInterleaveError?.code, 'LIBRARY_ACQUISITION_BUSY');
      assert.equal(updated.revision, 2);
      assert.equal(second.getJob('job-interleave-a').revision, 2);
      assert.deepEqual(readdirSync(first.paths.locksRoot), []);
    });
  });

  test('record creation fails closed when the filesystem cannot publish an atomic hard link', async () => {
    await withWorkspace(async workspace => {
      const hookedFs = Object.create(nodeFs);
      let jobsRoot = '';
      hookedFs.linkSync = (source, target) => {
        if (jobsRoot && target.startsWith(`${jobsRoot}${sep}`)) {
          const error = Object.assign(new Error('hard links unsupported'), { code: 'EPERM' });
          throw error;
        }
        return nodeFs.linkSync(source, target);
      };
      const store = new LibraryAcquisitionStore({
        workspacePath: workspace, now: () => NOW, recoverOnOpen: false, fsImpl: hookedFs,
      });
      jobsRoot = store.paths.jobsRoot;
      throwsCode(
        () => store.createJob(fixtureJob(workspace), { candidate: fixtureCandidate() }),
        'LIBRARY_ACQUISITION_ATOMIC_CREATE_UNSUPPORTED',
      );
      assert.deepEqual(store.listJobs(), []);
      assert.deepEqual(readdirSync(store.paths.jobsRoot), []);
      assert.deepEqual(readdirSync(store.paths.locksRoot), []);
    });
  });

  test('directory fsync keeps the primary I/O failure when descriptor cleanup also fails', async () => {
    await withWorkspace(async workspace => {
      const hookedFs = Object.create(nodeFs);
      hookedFs.fsyncSync = () => {
        throw Object.assign(new Error('primary directory fsync failure'), { code: 'EIO' });
      };
      hookedFs.closeSync = fd => {
        nodeFs.closeSync(fd);
        throw Object.assign(new Error('secondary descriptor close failure'), { code: 'ECLOSE' });
      };
      const store = new LibraryAcquisitionStore({
        workspacePath: workspace, now: () => NOW, recoverOnOpen: false, fsImpl: hookedFs,
      });
      let thrown = null;
      try { store._fsyncDirectory(store.paths.jobsRoot); } catch (error) { thrown = error; }
      assert.equal(thrown?.code, 'EIO');
      assert.equal(thrown?.cleanupError?.code, 'ECLOSE');
      assert.equal(thrown?.cleanupErrors?.some(error => error.code === 'ECLOSE'), true);
    });
  });

  test('Torrent file selection is exactly-once per intent while another intent can select another book', async () => {
    await withWorkspace(async workspace => {
      const store = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW, recoverOnOpen: false });
      const direct = store.createJob(
        fixtureJob(workspace, {
          jobId: 'direct-selected-intent',
          intentId: 'intent-direct-selected',
          selectedFiles: ['books/volume-1.epub'],
        }),
        { candidate: fixtureCandidate() },
      );
      const directPreSelectionKey = contract.deriveAcquisitionIdempotencyKey({
        workspaceIdentity: direct.workspaceIdentity,
        intentId: direct.intentId,
        offerId: direct.offerId,
        transportIdentity: direct.transportIdentity,
        selectedFiles: [],
      });
      assert.deepEqual(direct.idempotencyAliases, [directPreSelectionKey],
        'a direct explicit selection still owns its same-intent pre-selection replay');
      assert.equal(store.putJob(fixtureJob(workspace, {
        jobId: 'direct-empty-replay', intentId: direct.intentId,
      }), { candidate: fixtureCandidate() }).job.jobId, direct.jobId);
      throwsCode(() => store.putJob(fixtureJob(workspace, {
        jobId: 'direct-conflicting-selection',
        intentId: direct.intentId,
        selectedFiles: ['books/volume-2.epub'],
      }), { candidate: fixtureCandidate() }), 'LIBRARY_ACQUISITION_SELECTION_CONFLICT');

      const awaiting = store.createJob(
        { ...fixtureJob(workspace), state: 'awaiting-selection' },
        { candidate: fixtureCandidate() },
      );
      const oldKey = awaiting.idempotencyKey;
      throwsCode(() => store.transitionJob(awaiting.jobId, 'queued', {
        expectedRevision: awaiting.revision,
      }), 'LIBRARY_ACQUISITION_SELECTION_REQUIRED');
      assert.equal(store.getJob(awaiting.jobId).revision, awaiting.revision);
      throwsCode(() => store.putJob(
        { ...fixtureJob(workspace, {
          jobId: 'selected-request-before-commit', selectedFiles: ['books/volume-1.epub'],
        }) },
        { candidate: fixtureCandidate() },
      ), 'LIBRARY_ACQUISITION_SELECTION_TRANSACTION_REQUIRED');
      assert.equal(store.listJobs().length, 2);
      const queued = store.transitionJob(awaiting.jobId, 'queued', {
        expectedRevision: 1,
        patch: { selectedFiles: ['books/volume-1.epub'] },
        candidate: fixtureCandidate(),
      });
      assert.deepEqual(queued.selectedFiles, ['books/volume-1.epub']);
      assert.notEqual(queued.idempotencyKey, oldKey);
      assert.deepEqual(queued.idempotencyAliases, [oldKey]);
      assert.equal(queued.idempotencyKey, contract.deriveAcquisitionIdempotencyKey({
        workspaceIdentity: queued.workspaceIdentity,
        intentId: queued.intentId,
        offerId: queued.offerId,
        transportIdentity: queued.transportIdentity,
        selectedFiles: queued.selectedFiles,
      }));
      throwsCode(() => store.updateJob(queued.jobId, {
        expectedRevision: 2, patch: { selectedFiles: ['books/volume-2.epub'] },
      }), 'LIBRARY_ACQUISITION_SELECTION_IMMUTABLE');
      const reopened = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => LATER });
      assert.equal(reopened.putJob({
        ...fixtureJob(workspace, {
          jobId: 'replay-after-selection',
          selectedFiles: ['books/volume-1.epub'],
        }),
      }, { candidate: fixtureCandidate() }).job.jobId, queued.jobId);
      assert.equal(reopened.putJob({
        ...fixtureJob(workspace, { jobId: 'replay-before-selection' }),
      }, { candidate: fixtureCandidate() }).job.jobId, queued.jobId,
      'the pre-selection request key remains an exactly-once alias');
      throwsCode(() => reopened.putJob(fixtureJob(workspace, {
        jobId: 'same-intent-cannot-change-selection',
        selectedFiles: ['books/volume-2.epub'],
      }), { candidate: fixtureCandidate() }), 'LIBRARY_ACQUISITION_SELECTION_CONFLICT');

      const secondIntent = reopened.createJob(fixtureJob(workspace, {
        jobId: 'second-independent-selection',
        intentId: 'intent-second-selection',
        selectedFiles: ['books/volume-2.epub'],
      }), { candidate: fixtureCandidate() });
      assert.deepEqual(secondIntent.selectedFiles, ['books/volume-2.epub']);
      assert.notEqual(secondIntent.jobId, queued.jobId);
      assert.notEqual(secondIntent.idempotencyKey, queued.idempotencyKey,
        'a new user acquisition intent may take another file from the same torrent Offer');
      assert.equal(reopened.listJobs().length, 3);

      throwsCode(() => store.createJob({
        ...fixtureJob(workspace, {
          jobId: 'alias-injection-job', selectedFiles: ['planted.epub'],
        }),
        idempotencyAliases: [oldKey],
      }, { candidate: fixtureCandidate() }), 'LIBRARY_ACQUISITION_ALIAS_FORBIDDEN_ON_CREATE');
    });
  });

  test('selection rekey holds both old and new request identities against concurrent replay', async () => {
    await withWorkspace(async workspace => {
      const contender = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW, recoverOnOpen: false });
      const hookedFs = Object.create(nodeFs);
      let replayError = null;
      let injected = false;
      let coordinatorJobsRoot = '';
      hookedFs.renameSync = (source, target) => {
        if (!injected && target === join(coordinatorJobsRoot, 'job-selection-lock.json')) {
          injected = true;
          try {
            contender.putJob(
              { ...fixtureJob(workspace), jobId: 'concurrent-preselection-replay' },
              { candidate: fixtureCandidate() },
            );
          } catch (error) { replayError = error; }
        }
        return nodeFs.renameSync(source, target);
      };
      const coordinator = new LibraryAcquisitionStore({
        workspacePath: workspace, now: () => NOW, recoverOnOpen: false, fsImpl: hookedFs,
      });
      coordinatorJobsRoot = coordinator.paths.jobsRoot;
      const awaiting = coordinator.createJob(
        { ...fixtureJob(workspace), jobId: 'job-selection-lock', state: 'awaiting-selection' },
        { candidate: fixtureCandidate() },
      );
      const queued = coordinator.transitionJob(awaiting.jobId, 'queued', {
        expectedRevision: awaiting.revision,
        patch: { selectedFiles: ['selected.epub'] },
        candidate: fixtureCandidate(),
      });
      assert.equal(replayError?.code, 'LIBRARY_ACQUISITION_BUSY');
      assert.deepEqual(coordinator.listJobs().map(job => job.jobId), ['job-selection-lock']);
      assert.deepEqual(queued.idempotencyAliases, [awaiting.idempotencyKey]);
    });
  });

  test('selection finalization remains bound to the validated Candidate file catalog', async () => {
    await withWorkspace(async workspace => {
      const candidate = fixtureVariantCandidate('selection-catalog', {
        offer: { selectableFiles: ['books/allowed.epub'] },
      });
      const store = new LibraryAcquisitionStore({
        workspacePath: workspace, now: () => NOW, recoverOnOpen: false,
      });
      const awaiting = store.createJob(fixtureJobForCandidate(workspace, candidate, {
        jobId: 'job-selection-catalog',
        intentId: 'intent-selection-catalog',
        state: 'awaiting-selection',
      }), { candidate });
      throwsCode(() => store.transitionJob(awaiting.jobId, 'queued', {
        expectedRevision: awaiting.revision,
        patch: { selectedFiles: ['books/allowed.epub'] },
      }), 'LIBRARY_ACQUISITION_CANDIDATE_REQUIRED');
      assert.throws(() => store.transitionJob(awaiting.jobId, 'queued', {
        expectedRevision: awaiting.revision,
        patch: { selectedFiles: ['books/not-offered.epub'] },
        candidate,
      }), /不属于 Offer/);
      const changedCatalog = JSON.parse(JSON.stringify(candidate));
      changedCatalog.offers[0].selectableFiles = ['books/not-inspected.epub'];
      assert.throws(() => store.transitionJob(awaiting.jobId, 'queued', {
        expectedRevision: awaiting.revision,
        patch: { selectedFiles: ['books/not-inspected.epub'] },
        candidate: changedCatalog,
      }), /Candidate 快照不匹配/,
      'same public IDs cannot replace the Candidate file catalog after Job creation');
      assert.equal(store.getJob(awaiting.jobId).revision, awaiting.revision);
      assert.deepEqual(store.getJob(awaiting.jobId).selectedFiles, []);
      const queued = store.transitionJob(awaiting.jobId, 'queued', {
        expectedRevision: awaiting.revision,
        patch: { selectedFiles: ['books/allowed.epub'] },
        candidate,
      });
      assert.deepEqual(queued.selectedFiles, ['books/allowed.epub']);
      assert.equal(queued.state, 'queued');
    });
  });

  test('restart reopens every record and fail-closes active work to a resumable paused receipt', async () => {
    await withWorkspace(async workspace => {
      let clock = NOW;
      const first = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => clock, recoverOnOpen: false });
      first.createJob(fixtureJob(workspace), { candidate: fixtureCandidate() });
      first.transitionJob('job-gutenberg-1342', 'downloading', { expectedRevision: 1 });
      clock = LATER;
      const reopened = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => clock });
      assert.equal(reopened.getJob('job-gutenberg-1342').state, 'downloading',
        'opening a second Store is read-only and cannot impersonate app restart');
      reopened.recoverAfterRestart();
      const recovered = reopened.getJob('job-gutenberg-1342');
      assert.equal(recovered.state, 'paused');
      assert.equal(recovered.retryFrom, 'downloading');
      assert.equal(recovered.error.code, 'APP_RESTART_RECOVERY');
      assert.equal(recovered.revision, 3);
      const resumed = reopened.transitionJob(recovered.jobId, 'downloading', { expectedRevision: 3 });
      assert.equal(resumed.state, 'downloading');
      assert.equal(resumed.retryFrom, null, 'resume consumes the durable retry target');
    });
  });

  test('explicit restart recovery rescans jobs published after the owner Store opened', async () => {
    await withWorkspace(async workspace => {
      const recoveryOwner = new LibraryAcquisitionStore({
        workspacePath: workspace, now: () => LATER, recoverOnOpen: false,
      });
      const lateWriter = new LibraryAcquisitionStore({
        workspacePath: workspace, now: () => NOW, recoverOnOpen: false,
      });
      lateWriter.createJob(fixtureJob(workspace), { candidate: fixtureCandidate() });
      lateWriter.transitionJob('job-gutenberg-1342', 'downloading', { expectedRevision: 1 });
      assert.equal(recoveryOwner.jobs.size, 0, 'the owner begins with a deliberately stale in-memory view');
      const recoveredJobs = recoveryOwner.recoverAfterRestart();
      assert.deepEqual(recoveredJobs.map(job => job.jobId), ['job-gutenberg-1342']);
      const recovered = recoveryOwner.getJob('job-gutenberg-1342');
      assert.equal(recovered.state, 'paused');
      assert.equal(recovered.retryFrom, 'downloading');
      assert.equal(recovered.error.code, 'APP_RESTART_RECOVERY');
    });
  });

  test('restart projection covers every active state and preserves waiting/paused/terminal facts', async () => {
    await withWorkspace(async workspace => {
      const first = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW, recoverOnOpen: false });
      const active = ['downloading', 'verifying', 'materializing', 'awaiting-import'];
      const stable = ['awaiting-selection', 'queued', 'paused', 'imported', 'cancelled'];
      for (const [index, state] of [...active, ...stable].entries()) {
        const candidate = fixtureVariantCandidate(`restart-${index}`);
        first.createJob(fixtureJobForCandidate(workspace, candidate, {
          jobId: `job-restart-${state}`,
          state,
          bookId: state === 'imported' ? 'book-imported' : '',
        }), { candidate });
      }
      const reopened = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => LATER });
      reopened.recoverAfterRestart();
      for (const state of active) {
        const job = reopened.getJob(`job-restart-${state}`);
        assert.equal(job.state, 'paused');
        assert.equal(job.retryFrom, state);
        assert.equal(job.error.code, 'APP_RESTART_RECOVERY');
        assert.equal(job.revision, 2);
      }
      for (const state of stable) {
        const job = reopened.getJob(`job-restart-${state}`);
        assert.equal(job.state, state);
        assert.equal(job.revision, 1);
      }
      const resumedVerification = reopened.transitionJob('job-restart-verifying', 'verifying', {
        expectedRevision: 2,
      });
      assert.equal(resumedVerification.state, 'verifying');
      assert.equal(resumedVerification.retryFrom, null);
      const failedWhilePaused = reopened.transitionJob('job-restart-materializing', 'failed', {
        expectedRevision: 2,
        retryFrom: 'paused',
        patch: { error: { code: 'RECOVERY_FAILED', message: '恢复前检查失败' } },
      });
      assert.equal(failedWhilePaused.retryFrom, 'paused');
      const retriedPaused = reopened.transitionJob(failedWhilePaused.jobId, 'paused', {
        expectedRevision: failedWhilePaused.revision,
      });
      assert.equal(retriedPaused.retryFrom, null);
    });
  });

  test('terminal Job receipts are immutable while exact update replay is harmless', async () => {
    await withWorkspace(async workspace => {
      const store = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW, recoverOnOpen: false });
      let job = store.createJob(fixtureJob(workspace), { candidate: fixtureCandidate() });
      for (const state of ['downloading', 'verifying', 'materializing', 'awaiting-import', 'imported']) {
        const patch = state === 'imported' ? { bookId: 'book-1342' } : {};
        job = store.transitionJob(job.jobId, state, { expectedRevision: job.revision, patch });
      }
      assert.equal(job.state, 'imported');
      assert.equal(store.updateJob(job.jobId, { expectedRevision: job.revision, patch: {} }).revision, job.revision);
      throwsCode(() => store.updateJob(job.jobId, {
        expectedRevision: job.revision, patch: { bookId: 'rewritten-after-import' },
      }), 'LIBRARY_ACQUISITION_TERMINAL_IMMUTABLE');
      throwsCode(() => store.updateJob(job.jobId, {
        expectedRevision: job.revision, patch: { bytes: { received: 99, total: 99 } },
      }), 'LIBRARY_ACQUISITION_TERMINAL_IMMUTABLE');
    });
  });

  test('failed retry target cannot be rewritten to jump over the state machine', async () => {
    await withWorkspace(async workspace => {
      const store = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW, recoverOnOpen: false });
      let job = store.createJob(fixtureJob(workspace), { candidate: fixtureCandidate() });
      job = store.transitionJob(job.jobId, 'failed', {
        expectedRevision: job.revision,
        retryFrom: 'queued',
        patch: { error: { code: 'SOURCE_FAILED', message: '来源暂不可用' } },
      });
      throwsCode(() => store.updateJob(job.jobId, {
        expectedRevision: job.revision,
        patch: { retryFrom: 'awaiting-import' },
      }), 'LIBRARY_ACQUISITION_FAILED_IMMUTABLE');

      const pausedCandidate = fixtureVariantCandidate('paused-no-retry');
      const paused = store.createJob(fixtureJobForCandidate(workspace, pausedCandidate, {
        jobId: 'job-paused-no-retry', state: 'paused',
      }), { candidate: pausedCandidate });
      throwsCode(() => store.updateJob(paused.jobId, {
        expectedRevision: paused.revision,
        patch: {
          retryFrom: 'verifying',
          error: { code: 'APP_RESTART_RECOVERY', message: '应用重启后任务已安全暂停，可继续执行' },
        },
      }), 'LIBRARY_ACQUISITION_RETRY_TARGET_IMMUTABLE');
      throwsCode(() => store.updateJob(job.jobId, {
        expectedRevision: job.revision,
        patch: { error: { code: 'REWRITTEN', message: '覆盖原始失败' } },
      }), 'LIBRARY_ACQUISITION_FAILED_IMMUTABLE');
      assert.equal(store.transitionJob(job.jobId, 'queued', { expectedRevision: job.revision }).retryFrom, null);
    });
  });

  test('Inbox is durable and idempotent even when Library UI was never opened', async () => {
    await withWorkspace(async workspace => {
      mkdirSync(join(workspace, '书库'), { recursive: true });
      writeFileSync(join(workspace, '书库', 'Pride and Prejudice.epub'), 'book-bytes');
      const paddedArtifactPath = fixtureReceipt(workspace);
      paddedArtifactPath.artifact.path = ` ${paddedArtifactPath.artifact.path} `;
      assert.throws(() => contract.normalizeInboxReceipt(paddedArtifactPath), /安全绝对路径/,
        'artifact path identity cannot be trimmed or resolved from a padded relative spelling');
      const store = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW, recoverOnOpen: false });
      for (const malformedReceipt of [
        fixtureReceipt(workspace, { receiptId: new String('boxed-receipt-id') }),
        fixtureReceipt(workspace, { receiptId: { toJSON() { return 'tojson-receipt-id'; } } }),
        fixtureReceipt(workspace, {
          receiptId: 'boxed-artifact-path',
          artifact: {
            ...fixtureReceipt(workspace).artifact,
            path: new String(fixtureReceipt(workspace).artifact.path),
          },
        }),
      ]) {
        assert.throws(() => store.putInboxReceipt(malformedReceipt), /safe id|路径字符串|普通对象/i);
      }
      assert.equal(readdirSync(store.paths.inboxRoot).length, 0);
      const first = store.putInboxReceipt(fixtureReceipt(workspace));
      assert.equal(first.created, true);
      assert.equal(store.putInboxReceipt(fixtureReceipt(workspace)).idempotent, true);
      const ack = store.acknowledgeInboxReceipt(first.receipt.receiptId, {
        expectedRevision: 1, acknowledgedAt: LATER,
      });
      assert.equal(ack.state, 'acknowledged');
      assert.equal(ack.revision, 2);
      assert.equal(store.acknowledgeInboxReceipt(first.receipt.receiptId).revision, 2,
        'ack replay is exactly once');

      const reopened = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => LATER });
      assert.equal(reopened.listInboxReceipts()[0].state, 'acknowledged');
      assert.equal(reopened.putInboxReceipt(fixtureReceipt(workspace)).receipt.state, 'acknowledged');
      throwsCode(() => reopened.putInboxReceipt(fixtureReceipt(workspace, {
        artifact: { ...fixtureReceipt(workspace).artifact, sha256: 'f'.repeat(64) },
      })), 'LIBRARY_ACQUISITION_INBOX_CONFLICT');
    });
  });

  test('corrupt records are retained byte-for-byte, excluded from replay and reported without content', async () => {
    await withWorkspace(async workspace => {
      const store = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW, recoverOnOpen: false });
      store.createJob(fixtureJob(workspace), { candidate: fixtureCandidate() });
      const goodCandidate = fixtureVariantCandidate('corruption-survivor');
      store.createJob(fixtureJobForCandidate(workspace, goodCandidate, {
        jobId: 'job-good', intentId: 'intent-good', state: 'awaiting-selection',
      }), { candidate: goodCandidate });
      const brokenPath = join(store.paths.jobsRoot, 'job-gutenberg-1342.json');
      const brokenBytes = '{"schema":"broken"';
      writeFileSync(brokenPath, brokenBytes);

      const reopened = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => LATER });
      assert.equal(readFileSync(brokenPath, 'utf8'), brokenBytes, 'corrupt source bytes must not be rewritten');
      assert.equal(reopened.listJobs().some(job => job.jobId === 'job-good'), true);
      assert.equal(reopened.listJobs().some(job => job.jobId === 'job-gutenberg-1342'), false);
      const corruption = reopened.listCorruptions()[0];
      assert.equal(corruption.blocked, true);
      assert.equal(corruption.retained, true);
      assert.equal('path' in corruption, false);
      assert.equal('content' in corruption, false);
      throwsCode(() => reopened.getJob('job-gutenberg-1342'), 'LIBRARY_ACQUISITION_RECORD_CORRUPT');
      throwsCode(() => reopened.putJob(fixtureJob(workspace, {
        jobId: 'job-same-intent-after-corruption',
      }), { candidate: fixtureCandidate() }), 'LIBRARY_ACQUISITION_LEDGER_REPAIR_REQUIRED');
      assert.equal(existsSync(join(reopened.paths.jobsRoot, 'job-same-intent-after-corruption.json')), false);
      throwsCode(() => reopened.transitionJob('job-good', 'queued', {
        expectedRevision: 1,
        patch: { selectedFiles: ['books/recovered.epub'] },
        candidate: goodCandidate,
      }), 'LIBRARY_ACQUISITION_LEDGER_REPAIR_REQUIRED');
      const retainedGood = reopened.getJob('job-good');
      assert.equal(retainedGood.revision, 1);
      assert.equal(retainedGood.state, 'awaiting-selection');
      assert.deepEqual(retainedGood.selectedFiles, []);
    });
  });

  test('non-regular JSON ledger entries and non-string record IDs fail closed', async () => {
    await withWorkspace(async workspace => {
      const first = new LibraryAcquisitionStore({
        workspacePath: workspace, now: () => NOW, recoverOnOpen: false,
      });
      first.createJob(fixtureJob(workspace), { candidate: fixtureCandidate() });
      const originalPath = join(first.paths.jobsRoot, 'job-gutenberg-1342.json');
      unlinkSync(originalPath);
      mkdirSync(originalPath);

      const reopened = new LibraryAcquisitionStore({
        workspacePath: workspace, now: () => LATER, recoverOnOpen: false,
      });
      assert.deepEqual(reopened.listJobs(), []);
      assert.equal(reopened.listCorruptions().some(item => (
        item.recordType === 'job' && item.recordId === 'job-gutenberg-1342'
      )), true, 'a directory occupying a Job JSON identity must become a blocking corruption');
      throwsCode(() => reopened.putJob(fixtureJob(workspace, {
        jobId: 'job-second-after-nonregular-ledger-entry',
      }), { candidate: fixtureCandidate() }), 'LIBRARY_ACQUISITION_LEDGER_REPAIR_REQUIRED');
      assert.equal(existsSync(join(
        reopened.paths.jobsRoot, 'job-second-after-nonregular-ledger-entry.json',
      )), false);

      for (const invalidId of [['job-gutenberg-1342'], 1, { id: 'job-gutenberg-1342' }]) {
        throwsCode(() => reopened.getJob(invalidId), 'LIBRARY_ACQUISITION_INVALID_RECORD_ID');
        throwsCode(() => reopened.updateJob(invalidId, {
          expectedRevision: 1, patch: { state: 'queued' },
        }), 'LIBRARY_ACQUISITION_INVALID_RECORD_ID');
        throwsCode(() => reopened.transitionJob(invalidId, 'queued', {
          expectedRevision: 1,
        }), 'LIBRARY_ACQUISITION_INVALID_RECORD_ID');
        throwsCode(() => reopened.acknowledgeInboxReceipt(invalidId),
          'LIBRARY_ACQUISITION_INVALID_RECORD_ID');
      }
    });
  });

  test('a tampered passing-Rights Job without its receipt is corruption-blocked on durable load', async () => {
    await withWorkspace(async workspace => {
      const store = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW, recoverOnOpen: false });
      const job = fixtureJob(workspace, { state: 'inspecting', rightsReceipt: null });
      const target = join(store.paths.jobsRoot, `${job.jobId}.json`);
      const bytes = `${JSON.stringify(job)}\n`;
      writeFileSync(target, bytes);
      const reopened = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => LATER });
      assert.equal(reopened.listJobs().length, 0);
      assert.equal(readFileSync(target, 'utf8'), bytes);
      assert.equal(reopened.listCorruptions().some(item => item.recordId === job.jobId), true);
      throwsCode(() => reopened.getJob(job.jobId), 'LIBRARY_ACQUISITION_RECORD_CORRUPT');
    });
  });

  test('a selected durable Job without its same-intent pre-selection alias is corruption-blocked', async () => {
    await withWorkspace(async workspace => {
      const store = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW, recoverOnOpen: false });
      const candidate = fixtureCandidate();
      const job = contract.normalizeJob(fixtureJob(workspace, {
        jobId: 'job-selected-alias-missing',
        intentId: 'intent-selected-alias-missing',
        selectedFiles: ['books/volume-1.epub'],
      }), { candidate });
      const target = join(store.paths.jobsRoot, `${job.jobId}.json`);
      const bytes = `${JSON.stringify({ ...job, idempotencyAliases: [] })}\n`;
      writeFileSync(target, bytes);

      const paddedCandidate = fixtureVariantCandidate('selected-alias-padded');
      const paddedJob = contract.normalizeJob(fixtureJobForCandidate(workspace, paddedCandidate, {
        jobId: 'job-selected-alias-padded',
        intentId: 'intent-selected-alias-padded',
        selectedFiles: ['books/volume-2.epub'],
      }), { candidate: paddedCandidate });
      const paddedPreSelectionKey = contract.deriveAcquisitionIdempotencyKey({
        workspaceIdentity: paddedJob.workspaceIdentity,
        intentId: paddedJob.intentId,
        offerId: paddedJob.offerId,
        transportIdentity: paddedJob.transportIdentity,
        selectedFiles: [],
      });
      const paddedPath = join(store.paths.jobsRoot, `${paddedJob.jobId}.json`);
      const paddedBytes = `${JSON.stringify({
        ...paddedJob, idempotencyAliases: [` ${paddedPreSelectionKey} `],
      })}\n`;
      writeFileSync(paddedPath, paddedBytes);

      const reopened = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => LATER });
      assert.equal(reopened.listJobs().length, 0);
      assert.equal(readFileSync(target, 'utf8'), bytes);
      assert.equal(reopened.listCorruptions().some(item => item.recordId === job.jobId), true);
      assert.equal(readFileSync(paddedPath, 'utf8'), paddedBytes);
      assert.equal(reopened.listCorruptions().some(item => item.recordId === paddedJob.jobId), true);
      throwsCode(() => reopened.getJob(job.jobId), 'LIBRARY_ACQUISITION_RECORD_CORRUPT');
      throwsCode(() => reopened.getJob(paddedJob.jobId), 'LIBRARY_ACQUISITION_RECORD_CORRUPT');
    });
  });

  test('corrupt Inbox records block same-ID overwrite while orphan temp files never become facts', async () => {
    await withWorkspace(async workspace => {
      mkdirSync(join(workspace, '书库'), { recursive: true });
      writeFileSync(join(workspace, '书库', 'Pride and Prejudice.epub'), 'book-bytes');
      const first = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW, recoverOnOpen: false });
      first.createInboxReceipt(fixtureReceipt(workspace));
      const receiptPath = join(first.paths.inboxRoot, 'receipt-gutenberg-1342.json');
      const brokenBytes = '{"schema":"broken-inbox"';
      writeFileSync(receiptPath, brokenBytes);
      writeFileSync(join(first.paths.inboxRoot, '.receipt-orphan.tmp'), '{"state":"pending"}');
      writeFileSync(join(first.paths.jobsRoot, '.job-orphan.tmp'), '{"state":"queued"}');

      const reopened = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => LATER });
      assert.equal(reopened.listInboxReceipts().length, 0);
      assert.equal(reopened.listJobs().length, 0);
      assert.equal(readFileSync(receiptPath, 'utf8'), brokenBytes);
      assert.equal(reopened.listCorruptions().some(item => item.recordType === 'inbox'), true);
      throwsCode(
        () => reopened.putInboxReceipt(fixtureReceipt(workspace)),
        'LIBRARY_ACQUISITION_RECORD_CORRUPT',
      );
      assert.equal(readFileSync(receiptPath, 'utf8'), brokenBytes);
    });
  });

  test('durable Job and Inbox envelopes cannot synthesize missing revision or audit timestamps', async () => {
    await withWorkspace(async workspace => {
      mkdirSync(join(workspace, '书库'), { recursive: true });
      writeFileSync(join(workspace, '书库', 'Pride and Prejudice.epub'), 'book-bytes');
      const first = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW, recoverOnOpen: false });
      first.createJob(fixtureJob(workspace), { candidate: fixtureCandidate() });
      const nullEnvelopeCandidate = fixtureVariantCandidate('null-envelope');
      first.createJob(fixtureJobForCandidate(workspace, nullEnvelopeCandidate, {
        jobId: 'job-null-envelope', intentId: 'intent-null-envelope',
      }), { candidate: nullEnvelopeCandidate });
      const badFingerprintCandidate = fixtureVariantCandidate('bad-fingerprint');
      first.createJob(fixtureJobForCandidate(workspace, badFingerprintCandidate, {
        jobId: 'job-bad-fingerprint', intentId: 'intent-bad-fingerprint',
      }), { candidate: badFingerprintCandidate });
      first.createInboxReceipt(fixtureReceipt(workspace));

      const jobPath = join(first.paths.jobsRoot, 'job-gutenberg-1342.json');
      const job = JSON.parse(readFileSync(jobPath, 'utf8'));
      delete job.revision;
      delete job.createdAt;
      delete job.updatedAt;
      writeFileSync(jobPath, `${JSON.stringify(job)}\n`);

      const nullJobPath = join(first.paths.jobsRoot, 'job-null-envelope.json');
      const nullJob = JSON.parse(readFileSync(nullJobPath, 'utf8'));
      nullJob.revision = null;
      nullJob.createdAt = null;
      nullJob.updatedAt = null;
      writeFileSync(nullJobPath, `${JSON.stringify(nullJob)}\n`);

      const badFingerprintPath = join(first.paths.jobsRoot, 'job-bad-fingerprint.json');
      const badFingerprintJob = JSON.parse(readFileSync(badFingerprintPath, 'utf8'));
      badFingerprintJob.candidateFingerprint = 'opaque-not-a-digest';
      writeFileSync(badFingerprintPath, `${JSON.stringify(badFingerprintJob)}\n`);

      const inboxPath = join(first.paths.inboxRoot, 'receipt-gutenberg-1342.json');
      const receipt = JSON.parse(readFileSync(inboxPath, 'utf8'));
      receipt.revision = null;
      receipt.createdAt = null;
      writeFileSync(inboxPath, `${JSON.stringify(receipt)}\n`);

      const reopened = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => LATER });
      assert.deepEqual(reopened.listJobs(), []);
      assert.deepEqual(reopened.listInboxReceipts(), []);
      assert.equal(reopened.listCorruptions().some(item => item.recordId === 'job-gutenberg-1342'), true);
      assert.equal(reopened.listCorruptions().some(item => item.recordId === 'job-null-envelope'), true);
      assert.equal(reopened.listCorruptions().some(item => item.recordId === 'job-bad-fingerprint'), true);
      assert.equal(reopened.listCorruptions().some(item => item.recordId === 'receipt-gutenberg-1342'), true);
    });
  });

  test('Store cannot cross workspace, staging, final or Inbox containment boundaries', async () => {
    await withWorkspace(async workspace => {
      const foreign = mkdtempSync(join(tmpdir(), 'mazz-w93a-foreign-'));
      try {
        const store = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW, recoverOnOpen: false });
        assert.throws(() => store.createJob(
          { ...fixtureJob(workspace), workspacePath: foreign },
          { candidate: fixtureCandidate() },
        ), /Store 不一致/);
        assert.throws(() => store.createJob({
          ...fixtureJob(workspace), stagingPath: join(foreign, 'payload.part'),
        }, { candidate: fixtureCandidate() }), /stagingPath/);
        assert.throws(() => store.createJob({
          ...fixtureJob(workspace), finalPath: join(store.paths.resourcesRoot, 'hidden.epub'),
        }, { candidate: fixtureCandidate() }), /finalPath|内部账/);
        for (const leaf of ['book.epub:stream', 'CON', 'book.epub.']) {
          assert.throws(() => store.createJob({
            ...fixtureJob(workspace), finalPath: join(store.paths.libraryRoot, leaf),
          }, { candidate: fixtureCandidate() }), /ADS|设备名|尾随/);
        }
        assert.throws(() => store.createInboxReceipt({
          ...fixtureReceipt(workspace),
          artifact: { ...fixtureReceipt(workspace).artifact, path: join(foreign, 'foreign.epub') },
        }), /artifact.path/);

        const realStaging = join(store.paths.stagingRoot, 'real-staging');
        const linkedStaging = join(store.paths.stagingRoot, 'linked-staging');
        mkdirSync(realStaging);
        writeFileSync(join(realStaging, 'payload.part'), 'partial');
        symlinkSync(realStaging, linkedStaging, 'junction');
        try {
          assert.throws(() => store.createJob({
            ...fixtureJob(workspace), stagingPath: join(linkedStaging, 'payload.part'),
          }, { candidate: fixtureCandidate() }), /link|路径|staging/i);
        } finally {
          if (existsSync(linkedStaging)) unlinkSync(linkedStaging);
        }
      } finally {
        rmSync(foreign, { recursive: true, force: true });
      }
    });
  });

  test('a pre-existing Library junction is rejected before any external ledger directory is created', async () => {
    await withWorkspace(async workspace => {
      const foreign = mkdtempSync(join(tmpdir(), 'mazz-w93a-junction-target-'));
      const libraryLink = join(workspace, '书库');
      try {
        symlinkSync(foreign, libraryLink, 'junction');
        throwsCode(
          () => new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW }),
          'LIBRARY_ACQUISITION_PATH_ESCAPE',
        );
        assert.equal(existsSync(join(foreign, '.resources')), false,
          'validation must happen before mkdir can mutate the junction target');
      } finally {
        if (existsSync(libraryLink)) unlinkSync(libraryLink);
        rmSync(foreign, { recursive: true, force: true });
      }
    });
  });

  test('a Workspace alias cannot create a second identity over the same physical ledger', () => {
    const root = mkdtempSync(join(tmpdir(), 'mazz-w93a-workspace-alias-'));
    const physical = join(root, 'physical');
    const alias = join(root, 'alias');
    try {
      mkdirSync(physical);
      const owner = new LibraryAcquisitionStore({ workspacePath: physical, now: () => NOW, recoverOnOpen: false });
      owner.createJob(fixtureJob(physical), { candidate: fixtureCandidate() });
      symlinkSync(physical, alias, 'junction');
      throwsCode(
        () => new LibraryAcquisitionStore({ workspacePath: alias, now: () => NOW, recoverOnOpen: false }),
        'LIBRARY_ACQUISITION_UNSAFE_WORKSPACE_ALIAS',
      );
      assert.equal(owner.listJobs().length, 1);
      assert.deepEqual(owner.listCorruptions(), []);
    } finally {
      if (existsSync(alias)) unlinkSync(alias);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a linked ancestor is rejected before constructor mkdir can write through it', () => {
    const root = mkdtempSync(join(tmpdir(), 'mazz-w93a-workspace-parent-link-'));
    const foreign = mkdtempSync(join(tmpdir(), 'mazz-w93a-workspace-parent-target-'));
    const alias = join(root, 'alias');
    const requested = join(alias, 'must-not-be-created');
    try {
      symlinkSync(foreign, alias, 'junction');
      throwsCode(
        () => new LibraryAcquisitionStore({ workspacePath: requested, now: () => NOW, recoverOnOpen: false }),
        'LIBRARY_ACQUISITION_UNSAFE_WORKSPACE_ALIAS',
      );
      assert.equal(existsSync(join(foreign, 'must-not-be-created')), false,
        'constructor validation must precede every mkdir below a linked ancestor');
    } finally {
      if (existsSync(alias)) unlinkSync(alias);
      rmSync(root, { recursive: true, force: true });
      rmSync(foreign, { recursive: true, force: true });
    }
  });

  test('canonical realpath collapses alternate filesystem spellings onto one Workspace identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'mazz-w93a-canonical-workspace-'));
    try {
      const first = new LibraryAcquisitionStore({ workspacePath: root, now: () => NOW, recoverOnOpen: false });
      throwsCode(() => new LibraryAcquisitionStore({
        workspacePath: root,
        workspaceIdentity: ` ${first.workspaceIdentity} `,
        now: () => NOW,
        recoverOnOpen: false,
      }), 'LIBRARY_ACQUISITION_INVALID_WORKSPACE');
      first.createJob(fixtureJob(root), { candidate: fixtureCandidate() });
      const alternate = realpathSync.native ? realpathSync.native(root) : realpathSync(root);
      const second = new LibraryAcquisitionStore({ workspacePath: alternate, now: () => NOW, recoverOnOpen: false });
      assert.equal(second.workspacePath, first.workspacePath);
      assert.equal(second.workspaceIdentity, first.workspaceIdentity);
      assert.equal(second.listJobs().length, 1);
      assert.deepEqual(second.listCorruptions(), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a post-bind Library reparse swap is rejected before any external mutation', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'mazz-w93a-layout-swap-'));
    const foreign = mkdtempSync(join(tmpdir(), 'mazz-w93a-layout-swap-target-'));
    const store = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW, recoverOnOpen: false });
    const libraryRoot = store.paths.libraryRoot;
    const retainedRoot = `${libraryRoot}.retained`;
    try {
      renameSync(libraryRoot, retainedRoot);
      symlinkSync(foreign, libraryRoot, 'junction');
      throwsCode(
        () => store.createJob(fixtureJob(workspace), { candidate: fixtureCandidate() }),
        'LIBRARY_ACQUISITION_LAYOUT_CHANGED',
      );
      assert.equal(existsSync(join(foreign, '.resources')), false);
    } finally {
      if (existsSync(libraryRoot)) unlinkSync(libraryRoot);
      if (existsSync(retainedRoot)) renameSync(retainedRoot, libraryRoot);
      rmSync(workspace, { recursive: true, force: true });
      rmSync(foreign, { recursive: true, force: true });
    }
  });

  test('internal acquisition ledgers are watcher-silent while actual Library assets stay observable', () => {
    assert.equal(shouldIgnoreWatchPath('D:/Workspace/书库/.resources/jobs/job-1.json'), true);
    assert.equal(shouldIgnoreWatchPath('D:/Workspace/书库/.resources/inbox/receipt-1.json'), true);
    assert.equal(shouldIgnoreWatchPath('D:\\Workspace\\书库\\.resources\\staging\\payload.part'), true);
    assert.equal(shouldIgnoreWatchPath('D:/Workspace/书库/Pride and Prejudice.epub'), false);
    assert.equal(shouldIgnoreWatchPath('D:/Workspace/书库/.covers/cover.webp'), false);
    assert.equal(shouldIgnoreWatchPath('D:/Workspace/notes/resource.md'), false);
    const watcherSource = readFileSync(new URL('../../main/file-watcher.js', import.meta.url), 'utf8');
    assert.doesNotMatch(watcherSource, /\bdepth\s*:\s*\d+/,
      'deep Library assets must not disappear behind a fixed watcher depth');
  });

  test('the foundation has no business count, text, token or file-size admission limit', () => {
    const source = [
      readFileSync(new URL('../../main/library-resource-contract.js', import.meta.url), 'utf8'),
      readFileSync(new URL('../../main/library-acquisition-store.js', import.meta.url), 'utf8'),
    ].join('\n');
    assert.doesNotMatch(source, /max(?:Candidates|Jobs|Offers|Files|Bytes)|too many (?:candidates|jobs|offers|files)|数量上限|大小上限/i);

    const candidate = fixtureCandidate();
    candidate.editions = [];
    candidate.offers = [];
    for (let index = 0; index < 257; index += 1) {
      const identifiers = { gutenberg: [String(10_000 + index)] };
      const editionId = contract.deriveEditionId({ identifiers });
      candidate.editions.push({
        editionId, title: `Edition ${index}`, language: 'en', publisher: '', publishedAt: '',
        identifiers, description: '',
      });
      const offer = {
        ...fixtureCandidate().offers[0],
        editionId,
        resourceId: `resource-${index}`,
        acquisitionRef: `resource-${index}`,
      };
      offer.offerId = contract.deriveOfferId(offer);
      candidate.offers.push(offer);
    }
    const normalized = contract.normalizeCandidate(candidate);
    assert.equal(normalized.editions.length, 257);
    assert.equal(normalized.offers.length, 257);
  });
});
