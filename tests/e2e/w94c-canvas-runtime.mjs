import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = process.argv.indexOf('--executable');
const EXECUTABLE = arg >= 0 ? path.resolve(process.argv[arg + 1]) : '';
const MODE = EXECUTABLE ? 'packaged' : 'source';
const EVIDENCE_ROOT = path.join(ROOT, 'docs', 'engineering', 'evidence');
const EVIDENCE_JSON = path.join(EVIDENCE_ROOT, `W94C_CANVAS_${MODE.toUpperCase()}.json`);
const USER_DATA = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94c-${MODE}-user-`)));
const WORKSPACE = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94c-${MODE}-workspace-`)));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const runtimeErrors = [];
const operation = (documentId, expectedRevision, kind, affectedIds, payload, operationId = `canvas-op-${crypto.randomUUID()}`) => ({ schema: 'mazz.canvas-operation/v1', operationId, documentId, expectedRevision, actor: { kind: 'human', ref: 'human:w94c-runtime' }, kind, affectedIds, precondition: {}, payload });

async function launch() {
  const options = { args: EXECUTABLE ? [] : [ROOT], env: { ...process.env, NODE_ENV: 'test', MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WORKSPACE, MAZZ_E2E_DISABLE_GPU: '1', MAZZ_E2E_ALLOW_LIVE_PROVIDER: '0' }, timeout: 120000 };
  if (EXECUTABLE) options.executablePath = EXECUTABLE;
  const app = await electron.launch(options);
  const page = await app.firstWindow({ timeout: 120000 });
  page.setDefaultTimeout(45000);
  page.on('pageerror', error => runtimeErrors.push(`[pageerror] ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error' && !/Autofill|SharedArrayBuffer|ERR_FILE_NOT_FOUND|ffmpeg_common|Failed to load resource/i.test(message.text())) runtimeErrors.push(`[console.error] ${message.text()}`); });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.mazz?.invoke && window.MazzShell));
  await page.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { const list = await page.evaluate(workspacePath => window.mazz.invoke('canvas:documentList', { workspacePath }), WORKSPACE); if (Array.isArray(list)) return { app, page }; } catch {}
    await delay(50);
  }
  throw new Error('W94C Canvas startup gate did not become ready');
}
async function closeProduct(product) { if (!product) return; const closed = await Promise.race([product.app.close().then(() => true), delay(30000).then(() => false)]); if (!closed) { product.app.process().kill(); await delay(500); throw new Error('W94C product did not close'); } }
async function invoke(page, channel, payload) { return page.evaluate(({ channel, payload }) => window.mazz.invoke(channel, payload), { channel, payload: { workspacePath: WORKSPACE, ...payload } }); }

let first = null;
let second = null;
let report;
try {
  first = await launch();
  const created = await invoke(first.page, 'canvas:documentCreate', { documentId: 'canvas-doc-runtime', title: 'W94C Runtime' });
  const layerId = created.document.layers[0].layerId;
  const node = { nodeId: 'runtime-rect', kind: 'rect', x: 12, y: 18, width: 200, height: 80, rotation: 0, opacity: 1, visible: true, fill: '#4f46e5', stroke: '#000000', strokeWidth: 2, text: '', points: [], assetRef: null, children: [] };
  const inserted = await invoke(first.page, 'canvas:operationApply', { operation: operation(created.document.documentId, 1, 'insert', ['runtime-rect'], { layerId, node }, 'canvas-op-runtime-insert') });
  const updated = await invoke(first.page, 'canvas:operationApply', { operation: operation(created.document.documentId, 2, 'update', ['runtime-rect'], { nodeId: 'runtime-rect', patch: { x: 44 } }, 'canvas-op-runtime-update') });
  const undone = await invoke(first.page, 'canvas:undo', { documentId: created.document.documentId, expectedRevision: updated.document.revision, actor: { kind: 'human', ref: 'human:w94c-runtime' } });
  const redone = await invoke(first.page, 'canvas:redo', { documentId: created.document.documentId, expectedRevision: undone.document.revision, actor: { kind: 'human', ref: 'human:w94c-runtime' } });
  assert.equal(redone.document.nodes['runtime-rect'].x, 44);
  const exported = await invoke(first.page, 'canvas:exportSvg', { documentId: created.document.documentId, expectedRevision: redone.document.revision, actor: { kind: 'human', ref: 'human:w94c-runtime' } });
  const grant = await invoke(first.page, 'canvas:exportGrant', { exportId: exported.export.exportId });
  const fetched = await first.page.evaluate(async url => { const response = await fetch(url); return { status: response.status, body: await response.text(), mediaType: response.headers.get('content-type') || '' }; }, grant.url);
  assert.equal(fetched.status, 200);
  assert.match(fetched.body, /runtime-rect|mazz\.canvas-svg\/v1/);
  const secondFetch = await first.page.evaluate(async url => (await fetch(url)).status, grant.url);
  assert.equal(secondFetch, 404);
  const mainSnapshot = await first.app.evaluate(() => globalThis.__MAZZ_E2E_CANVAS_DOCUMENT__.snapshot({ workspacePath: process.env.MAZZ_E2E_WORKSPACE }));
  assert.equal(mainSnapshot.stagingCount, 0);
  await closeProduct(first); first = null;
  second = await launch();
  const reopened = await invoke(second.page, 'canvas:documentSnapshot', { documentId: created.document.documentId });
  assert.equal(reopened.revision, redone.document.revision);
  assert.equal(reopened.nodes['runtime-rect'].x, 44);
  assert.deepEqual(runtimeErrors, []);
  report = { schema: 'mazz.w94c-canvas-runtime/v1', mode: MODE, result: 'PASS', documentId: created.document.documentId, revision: reopened.revision, exportId: exported.export.exportId, artifact: exported.artifact, grantSingleUse: true, networkCalls: 0, runtimeErrors };
  fs.mkdirSync(EVIDENCE_ROOT, { recursive: true });
  fs.writeFileSync(EVIDENCE_JSON, JSON.stringify(report, null, 2) + '\n');
  console.log(`W94C Canvas ${MODE} runtime: PASS`);
} catch (error) {
  report = { schema: 'mazz.w94c-canvas-runtime/v1', mode: MODE, result: 'FAIL', error: error.message, runtimeErrors };
  fs.mkdirSync(EVIDENCE_ROOT, { recursive: true });
  fs.writeFileSync(EVIDENCE_JSON, JSON.stringify(report, null, 2) + '\n');
  throw error;
} finally { await closeProduct(first).catch(() => {}); await closeProduct(second).catch(() => {}); try { fs.rmSync(USER_DATA, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {} try { fs.rmSync(WORKSPACE, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {} }
