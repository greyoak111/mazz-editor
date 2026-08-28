import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const SCRIPT = path.join(ROOT, 'tests', 'e2e', 'w94fe-player-room-runtime.mjs');
const evidence = mode => JSON.parse(fs.readFileSync(path.join(
  ROOT, 'docs', 'engineering', 'evidence', `W94FE_PLAYER_ROOM_${mode}.json`,
), 'utf8'));

describe('W94Fe Source/Packaged Watch Room boundary', () => {
  test('定向 E2E 使用第二个 Electron Mazz、真实 TLS 配对和 durable replay', () => {
    const source = fs.readFileSync(SCRIPT, 'utf8');
    for (const marker of [
      "import { _electron as electron } from 'playwright'",
      "sync:roomCreate", "sync:roomTransferHost", "sync:roomReplay",
      "sync:host", "sync:join", "secondMazzRuntime: true",
      "MAZZ_E2E_USER_DATA", "MAZZ_E2E_WORKSPACE", "--executable",
    ]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(source, /ELECTRON_RUN_AS_NODE|http\.createServer\(/i);
  });

  for (const mode of ['SOURCE', 'PACKAGED']) {
    test(`${mode} evidence：room/epoch/重连/资源/隐私均为 PASS`, () => {
      const report = evidence(mode);
      assert.equal(report.schema, 'mazz.w94fe-player-room-runtime/v1');
      assert.equal(report.mode, mode.toLowerCase());
      assert.equal(report.result, 'PASS');
      assert.equal(report.secondMazzRuntime, true);
      assert.equal(report.explicitPairing, true);
      assert.equal(report.workspaceSame, true);
      assert.equal(report.room.durableRoundtrip, true);
      assert.deepEqual(report.room.eventKinds, ['play', 'seek', 'buffer', 'member-join', 'host-transfer', 'pause']);
      assert.equal(report.room.activeMemberCount, 2);
      assert.equal(report.transport.tlsLoopback, true);
      assert.equal(report.transport.fileFramesSeparate, true);
      assert.equal(report.transport.stateFactFramesSeparate, true);
      assert.equal(report.transport.externalNetworkCalls, 0);
      assert.ok(report.transport.reconnects >= 4);
      assert.equal(report.faultInjection.unpairedJoinRejected, true);
      assert.equal(report.faultInjection.unknownManifestFieldRejected, true);
      assert.equal(report.resources.watchRoomOwnersAfterReopen, 0);
      assert.deepEqual(report.runtimeErrors, []);
      assert.match(report.room.roomId, /^room:/);
      assert.match(report.room.mediaRef, /^blob:[0-9a-f]{64}$/);
    });
  }
});
