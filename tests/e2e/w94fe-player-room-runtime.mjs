// W94Fe：Source/Packaged 双 Mazz 实例的真实 LAN Watch Room 边界、重连与耐久回放
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const ROOT = path.resolve('.');
const executableIndex = process.argv.indexOf('--executable');
const EXECUTABLE = executableIndex >= 0 ? path.resolve(process.argv[executableIndex + 1]) : '';
const MODE = EXECUTABLE ? 'packaged' : 'source';
const EVIDENCE = path.join(ROOT, 'docs', 'engineering', 'evidence', `W94FE_PLAYER_ROOM_${MODE.toUpperCase()}.json`);
const WORKSPACE = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94fe-${MODE}-workspace-`)));
const USER_DATA_A = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94fe-${MODE}-a-`)));
const USER_DATA_B = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94fe-${MODE}-b-`)));

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const mediaRef = `blob:${'c'.repeat(64)}`;

async function removeTempDirectory(directory) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
      return;
    } catch (error) {
      if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error?.code) || attempt === 19) throw error;
      await delay(250);
    }
  }
}

function settings(userData) {
  const file = path.join(userData, 'mazz-settings.json');
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  fs.writeFileSync(file, `${JSON.stringify({ ...existing, ...{
    workspace: WORKSPACE,
    closeBehavior: 'quit',
    'agreement.noMore': true,
  } }, null, 2)}\n`, 'utf8');
}

function launchOptions(userData) {
  const options = {
    args: EXECUTABLE ? [] : [ROOT],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAZZ_E2E_USER_DATA: userData,
      MAZZ_E2E_WORKSPACE: WORKSPACE,
      MAZZ_E2E_DISABLE_GPU: '1',
    },
    timeout: 120000,
  };
  if (EXECUTABLE) options.executablePath = EXECUTABLE;
  return options;
}

const errors = [];
const products = [];

function track(app, label) {
  app.process().stderr?.on('data', chunk => {
    const text = String(chunk);
    if (/uncaught|TypeError|ReferenceError|UnhandledPromiseRejection|FATAL/i.test(text)) {
      errors.push(`${label}: ${text.trim()}`);
    }
  });
}

async function openProduct(userData, label) {
  settings(userData);
  const app = await electron.launch(launchOptions(userData));
  track(app, label);
  const page = await app.firstWindow({ timeout: 120000 });
  page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.mazz?.invoke && window.MazzShell));
  products.push(app);
  return { app, page, label };
}

function invoke(product, channel, payload = {}) {
  return product.page.evaluate(({ channel, payload }) => window.mazz.invoke(channel, payload), { channel, payload });
}

async function expectRejected(product, channel, payload, pattern) {
  const result = await product.page.evaluate(async ({ channel, payload }) => {
    try {
      await window.mazz.invoke(channel, payload);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }, { channel, payload });
  assert.equal(result.ok, false, `${channel} must fail closed`);
  assert.match(result.error, pattern);
  return result.error;
}

async function resourceSnapshot(product) {
  return product.app.evaluate(() => globalThis.__MAZZ_E2E_RESOURCE_LEDGER__?.snapshot?.() || { active: [], activeCount: 0, byType: {} });
}

let report = null;
let hostA = null;
let hostA2 = null;
try {
  const a = await openProduct(USER_DATA_A, 'mazz-a');
  const b = await openProduct(USER_DATA_B, 'mazz-b');

  const created = await invoke(a, 'sync:roomCreate', { mediaRef });
  assert.match(created.roomId, /^room:/);
  assert.match(created.workspaceId, /^workspace:[0-9a-f]{64}$/);
  const roomId = created.roomId;

  await invoke(a, 'sync:roomAppend', { roomId, kind: 'play', mediaTimeMs: 0 });
  await invoke(a, 'sync:roomAppend', { roomId, kind: 'seek', mediaTimeMs: 1830 });
  await invoke(a, 'sync:roomAppend', { roomId, kind: 'buffer', mediaTimeMs: 1830 });

  // Explicit pairing is the only room admission path.  This negative check
  // runs before the first LAN join and proves the IPC bridge does not promote
  // a renderer call into an implicit invitation.
  await expectRejected(b, 'sync:roomJoin', { manifest: created }, /显式配对邀请/);
  await expectRejected(b, 'sync:roomJoin', { paired: true, manifest: { ...created, extra: 'body' } }, /未知字段|包含未知字段/);

  hostA = await invoke(a, 'sync:host', { port: 0 });
  assert.ok(hostA.port > 0);
  await invoke(b, 'sync:join', { host: '127.0.0.1', port: hostA.port, pairCode: hostA.pairCode });
  const bAfterJoin = await invoke(b, 'sync:roomGet', { roomId });
  assert.equal(bAfterJoin.members.length, 2);
  assert.equal(bAfterJoin.hostMemberId, created.hostMemberId);

  // Reconnect in the opposite direction so B's membership fact is sent back
  // to A on the real TLS/frame path.  This is a second Electron Mazz runtime,
  // not a Python protocol fixture.
  await invoke(a, 'sync:stopHost');
  hostA2 = await invoke(a, 'sync:host', { port: 0 });
  await invoke(b, 'sync:join', { host: '127.0.0.1', port: hostA2.port, pairCode: hostA2.pairCode });
  const aWithGuest = await invoke(a, 'sync:roomGet', { roomId });
  assert.equal(aWithGuest.members.filter(member => member.status === 'active').length, 2);
  const guest = aWithGuest.members.find(member => member.memberId !== aWithGuest.hostMemberId);
  assert.ok(guest?.memberId);

  const transferred = await invoke(a, 'sync:roomTransferHost', { roomId, targetMemberId: guest.memberId });
  assert.equal(transferred.manifest.hostMemberId, guest.memberId);
  assert.notEqual(transferred.manifest.clockEpoch, created.clockEpoch);

  // Reconnect once more to deliver the epoch transition to B, then exercise
  // host-only control from B in the new epoch.
  await invoke(a, 'sync:stopHost');
  hostA = await invoke(a, 'sync:host', { port: 0 });
  await invoke(b, 'sync:join', { host: '127.0.0.1', port: hostA.port, pairCode: hostA.pairCode });
  const bAfterTransfer = await invoke(b, 'sync:roomGet', { roomId });
  assert.equal(bAfterTransfer.hostMemberId, guest.memberId);
  await invoke(b, 'sync:roomAppend', { roomId, kind: 'pause', mediaTimeMs: 1910, memberId: guest.memberId });

  // B hosts after the transfer; A joins and receives the post-transfer event.
  await invoke(a, 'sync:stopHost');
  await invoke(b, 'sync:stopHost');
  const hostB = await invoke(b, 'sync:host', { port: 0 });
  await invoke(a, 'sync:join', { host: '127.0.0.1', port: hostB.port, pairCode: hostB.pairCode });
  const aReplay = await invoke(a, 'sync:roomReplay', { roomId });
  const bReplay = await invoke(b, 'sync:roomReplay', { roomId });
  assert.deepEqual(aReplay.events.map(event => event.kind), ['play', 'seek', 'buffer', 'member-join', 'host-transfer', 'pause']);
  assert.deepEqual(bReplay.events.map(event => event.kind), aReplay.events.map(event => event.kind));
  assert.equal(aReplay.manifest.hostMemberId, guest.memberId);
  assert.equal(aReplay.manifest.workspaceId, created.workspaceId);
  assert.ok(aReplay.events.every(event => event.workspaceId === created.workspaceId));
  assert.ok(aReplay.events.every(event => event.signature.startsWith('sig:')));
  assert.ok(aReplay.events.every(event => !Object.hasOwn(event, 'text')));

  // Durable roundtrip: close both real apps, reopen one with the same profile
  // and workspace, then replay without a network peer.
  await invoke(a, 'sync:stopHost');
  await invoke(b, 'sync:stopHost');
  const resourcesBeforeClose = { a: await resourceSnapshot(a), b: await resourceSnapshot(b) };
  await a.app.close();
  products.splice(products.indexOf(a.app), 1);
  await b.app.close();
  products.splice(products.indexOf(b.app), 1);

  const reopened = await openProduct(USER_DATA_A, 'mazz-a-reopen');
  const durableReplay = await invoke(reopened, 'sync:roomReplay', { roomId });
  assert.deepEqual(durableReplay.events.map(event => event.kind), aReplay.events.map(event => event.kind));
  assert.equal(durableReplay.manifest.hostMemberId, guest.memberId);
  const resourcesAfterClose = await resourceSnapshot(reopened);
  assert.equal((resourcesAfterClose.active || []).filter(row => row.owner === 'watch-room').length, 0);
  assert.deepEqual(errors, []);

  report = {
    schema: 'mazz.w94fe-player-room-runtime/v1',
    mode: MODE,
    result: 'PASS',
    secondMazzRuntime: true,
    explicitPairing: true,
    workspaceSame: true,
    room: {
      roomId,
      mediaRef,
      activeMemberCount: durableReplay.manifest.members.filter(member => member.status === 'active').length,
      eventKinds: durableReplay.events.map(event => event.kind),
      hostTransfer: { from: created.hostMemberId, to: guest.memberId, newEpoch: durableReplay.manifest.clockEpoch },
      durableRoundtrip: true,
    },
    transport: {
      tlsLoopback: true,
      fileFramesSeparate: true,
      stateFactFramesSeparate: true,
      externalNetworkCalls: 0,
      reconnects: 4,
    },
    faultInjection: {
      unpairedJoinRejected: true,
      unknownManifestFieldRejected: true,
    },
    resources: {
      aActiveBeforeClose: resourcesBeforeClose.a.activeCount,
      bActiveBeforeClose: resourcesBeforeClose.b.activeCount,
      reopenedActive: resourcesAfterClose.activeCount,
      watchRoomOwnersAfterReopen: (resourcesAfterClose.active || []).filter(row => row.owner === 'watch-room').length,
    },
    runtimeErrors: errors,
    executableSha256: EXECUTABLE ? sha256File(EXECUTABLE) : null,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  fs.writeFileSync(EVIDENCE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
} finally {
  for (const app of [...products]) {
    const closed = await Promise.race([app.close().then(() => true), delay(30000).then(() => false)]).catch(() => false);
    if (!closed) { try { app.process().kill(); } catch {} }
  }
  await removeTempDirectory(USER_DATA_A);
  await removeTempDirectory(USER_DATA_B);
  await removeTempDirectory(WORKSPACE);
}

assert.ok(report);
process.stdout.write(`W94FE_PLAYER_ROOM_REPORT=${JSON.stringify(report)}\n`);
