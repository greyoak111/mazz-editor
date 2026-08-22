import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const require = createRequire(import.meta.url);

function ordered(source, needles, label) {
  let cursor = -1;
  for (const needle of needles) {
    const next = source.indexOf(needle, cursor + 1);
    assert.ok(next > cursor, `${label}: missing/out-of-order ${needle}`);
    cursor = next;
  }
}

describe('W88 window handoff atomicity', () => {
  test('source freezes before fail-closed capture and detaches only after strict recovery', () => {
    const shell = read('renderer/shell/shell.js');
    const transfer = shell.slice(shell.indexOf('async transferTabAtomically'), shell.indexOf('async moveTabToNewWindow'));
    ordered(transfer, [
      'this.freezeHandoffSource(tab)',
      'this.buildTabHandoff(tab)',
      'this.handoffOwnershipStillCurrent(tab, snapshot)',
      'snapshots.writePayloadStrict',
      'this.snapshotPayloadStrict(tab, sourceInst)',
      'await modules.detach(tab.id)',
      "window.mazz.invoke('window:handoffCommit'",
      'this.closeTransferredSource(tab)',
    ], 'source transaction');
    const build = shell.slice(shell.indexOf('async buildTabHandoff'), shell.indexOf('freezeHandoffSource'));
    assert.match(build, /inst\.def\.getContent\(inst\.state\)/);
    assert.match(build, /throw new Error\(`无法取得/);
    assert.doesNotMatch(build, /safeGet\(\(\) => inst\.def\.getContent/);
    assert.match(shell, /await snapshots\.untrackStrict\(tab\.id\)/);
  });

  test('target reserves before its first await, precommits inertly, then publishes without fallible work', () => {
    const shell = read('renderer/shell/shell.js');
    const prepare = shell.slice(shell.indexOf('async prepareHandoff(snapshot)'), shell.indexOf('/** Target phase 2'));
    ordered(prepare, [
      'this.openTab(snapshot.moduleId',
      'this._provisionalHandoffs.set(transferId, record)',
      "invoke('workspace:get')",
      'await record.ready',
      "record.stage = 'prepared'",
    ], 'target prepare');
    const commit = shell.slice(shell.indexOf('async commitHandoff(transferId)'), shell.indexOf('finalizeHandoff(transferId)'));
    ordered(commit, [
      "record.stage = 'committing'",
      'await inst.def.applyProgress',
      'assertLive();',
      'await modules.prepareHandoffCommit',
      'snapshots.writePayloadStrict',
      "invoke('recent:add'",
      "record.stage = 'commit-ready'",
    ], 'target precommit');
    assert.doesNotMatch(commit, /commitProvisional|tabs\.commitProvisional/);
    const publish = shell.slice(shell.indexOf('finalizeHandoff(transferId)'), shell.indexOf('/** Legacy one-phase'));
    ordered(publish, [
      'modules.commitProvisional(tab.id)',
      'pane.tabs.commitProvisional(tab.id)',
      'snapshots.track(tab.id',
      'modules.finalizeHandoff',
      'this._publishedHandoffs.add(transferId)',
    ], 'target publish');
    assert.doesNotMatch(publish, /\bawait\b|recent:add|snapshot:write/);
  });

  test('rollback cancels slow commit, clears target recovery strictly and uses resource-only discard', () => {
    const shell = read('renderer/shell/shell.js');
    const rollback = shell.slice(shell.indexOf('async discardProvisionalHandoffRecord'), shell.indexOf('/** Target phase 1'));
    ordered(rollback, [
      'record.cancelled = true',
      'await snapshots.untrackStrict(record.tab.id)',
      'await modules.discard(record.tab.id)',
      'record.pane.tabs.close',
    ], 'target rollback');
    assert.match(rollback, /if \(record\.commitPromise\)[\s\S]*await record\.commitPromise/);
    assert.doesNotMatch(rollback, /closeTabFlow|modules\.detach/);
    const main = read('main/main.js');
    const transactionRollback = main.slice(main.indexOf('const rollbackHandoffTransaction'), main.indexOf('const prepareHandoffTransaction'));
    assert.match(transactionRollback, /sendHandoffPhase\(record, 'rollback'\)/);
    assert.doesNotMatch(transactionRollback, /stage !== 'preparing'/);
  });

  test('main waits for idempotent publish ACK before showing any target or reporting success', () => {
    const main = read('main/main.js');
    const handler = main.slice(main.indexOf("bus.handle('window:handoffCommit'"), main.indexOf("bus.handle('window:handoffRollback'"));
    ordered(handler, [
      "sendHandoffPhase(record, 'commit')",
      'crashRecovery?.clearOwnedSnapshot',
      "record.stage = 'publish-ready'",
      'publishIdempotently',
      "record.stage = 'committed'",
      'settleHandoffTransaction(record',
      'record.target.show()',
      'return true',
    ], 'main publish handshake');
    assert.match(read('main/handoff-transaction.js'), /lastPhaseTimeout !== 'finalize'/);
    assert.match(main, /rollbackHandoffTransaction[\s\S]*sendHandoffPhase\(record, 'rollback'\)/);
    assert.match(main, /workspace:setCurrent[\s\S]*pendingHandoffTransactions\.size/);
  });

  test('a lost first finalize ACK retries the idempotent published receipt', async () => {
    const { publishIdempotently } = require('../../main/handoff-transaction.js');
    const record = { settled: false, lastPhaseTimeout: null };
    let calls = 0;
    const result = await publishIdempotently({
      record,
      isAlive: () => true,
      send: async () => {
        calls++;
        if (calls === 1) { record.lastPhaseTimeout = 'finalize'; return false; }
        record.lastPhaseTimeout = null;
        return true;
      },
    });
    assert.equal(result, true);
    assert.equal(calls, 2);
  });

  test('Browser prepare has no native/network owner; precommit materializes and discard releases every listener/view', () => {
    const browser = read('renderer/modules/browser/index.js');
    const open = browser.slice(browser.indexOf('function openTab('), browser.indexOf('function activate('));
    assert.match(open, /if \(!ctl\._handoffProvisional\) ensureNativeView\(tab\)/);
    assert.match(open, /tab\.pendingNavigation = url/);
    const materialize = browser.slice(browser.indexOf('ctl.prepareHandoffCommit = async'), browser.indexOf('ctl._storeReady'));
    ordered(materialize, [
      'ensureNativeView(tab, { strict: true })',
      "window.mazz.invoke('bv:nav'",
      'tab.pendingNavigation = null',
    ], 'browser materialization');
    const dispose = browser.slice(browser.indexOf('async function disposeBrowserController'), browser.indexOf('// ==================== 模块契约'));
    assert.match(dispose, /_resizeObserver\?\.disconnect/);
    assert.match(dispose, /removeEventListener\('resize'/);
    assert.match(dispose, /ctl\._offs\.splice\(0\)/);
    assert.match(dispose, /tab\._nativeCreated/);
    assert.match(dispose, /results\.every/);
  });

  test('Library and target commit prove the same canonical workspace owner', () => {
    const shell = read('renderer/shell/shell.js');
    assert.match(shell, /ownerIdentity: ownerIdentity \|\| null/);
    assert.match(shell, /captureHandoffOwner/);
    assert.match(shell, /目标模块绑定了错误的工作区 owner/);
    const library = read('renderer/modules/library/index.js');
    assert.match(library, /async captureHandoffOwner\(state\)/);
    assert.match(library, /ctl\.repository\.identity\?\.canonical/);
    assert.match(library, /if \(ctl\._handoffProvisional\) return Promise\.resolve\(false\)/);
  });

  test('strict snapshot API rejects ambiguous receipts and skipped target payloads', async () => {
    globalThis.window = {
      mazz: {
        isElectron: true,
        invoke: async () => undefined,
      },
    };
    const { SnapshotService } = await import(`../../renderer/core/snapshot-service.js?w88=${Date.now()}`);
    const service = new SnapshotService();
    await assert.rejects(() => service.writePayloadStrict('tab-x', { content: 'x' }), /rejected/);
    window.mazz.invoke = async () => true;
    assert.deepEqual(await service.writePayloadStrict('tab-x', { content: 'x' }), { ok: true });
    service.track('tab-x', () => { throw new Error('capture failed'); });
    await assert.rejects(() => service.writeOneStrict('tab-x'), /capture failed/);
    delete globalThis.window;
  });

  test('main-process rollback tombstone prevents a late target snapshot from becoming a ghost owner', async () => {
    const CrashRecovery = require('../../main/crash-recovery.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w88-handoff-seal-'));
    const handlers = new Map();
    const app = { getPath: () => dir, on: () => {} };
    const recovery = new CrashRecovery({ app, bus: { handle: (name, fn) => handlers.set(name, fn) } });
    const event = { sender: { id: 77 } };
    try {
      await handlers.get('snapshot:write')({ tabId: 'target-tab', moduleId: 'library', content: 'A' }, event);
      assert.equal(recovery.clearOwnedSnapshot('target-tab', 77), true);
      assert.equal(await handlers.get('snapshot:write')({ tabId: 'target-tab', moduleId: 'library', content: 'late' }, event), false);
      assert.equal((await handlers.get('snapshot:list')()).length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
