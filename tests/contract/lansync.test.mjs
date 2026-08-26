// tests/contract/lansync.test.mjs —— 局域网同步：双实例全量同步（100 文件零丢失）/ 冲突 / 配对码 / 路径防御
import { describe, test, assert } from '../harness.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import tls from 'node:tls';

const require = createRequire(import.meta.url);
const LanSync = require('../../main/lansync.js');
const { semverCompare } = require('../../main/updater.js');
const { safeRel, encodeFrame, makeDecoder } = LanSync;

const memStore = () => {
  const m = new Map();
  return { get: (k, d) => (m.has(k) ? m.get(k) : d), set: (k, v) => m.set(k, v) };
};

function mkWorkspace(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-sync-' + name + '-'));
  return dir;
}
function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}
function allFiles(root) {
  const out = {};
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(root, p).replace(/\\/g, '/')] = fs.readFileSync(p, 'utf8');
    }
  })(root);
  return out;
}

describe('局域网同步', () => {
  test('双实例全量同步：60+40=100 文件两边一致（验收：零丢失）', async () => {
    const wsA = mkWorkspace('a');
    const wsB = mkWorkspace('b');
    const filesA = {}, filesB = {};
    for (let i = 1; i <= 60; i++) filesA[`笔记/甲系列/笔记${String(i).padStart(2, '0')}.md`] = `# A 笔记 ${i}\n\n内容 ${i}（甲）\n`;
    for (let i = 61; i <= 100; i++) filesB[`笔记/乙系列/笔记${String(i).padStart(2, '0')}.md`] = `# B 笔记 ${i}\n\n内容 ${i}（乙）\n`;
    filesA['每日笔记/2026-07-18.md'] = '# 今天\n\n甲的记录\n';
    filesB['书摘/测试书.md'] = '# 《测试书》书摘\n\n> 摘录\n';
    writeFiles(wsA, filesA);
    writeFiles(wsB, filesB);

    const syncA = new LanSync({ store: memStore(), workspace: wsA });
    const syncB = new LanSync({ store: memStore(), workspace: wsB });
    const { port, pairCode } = await syncA.host({ port: 0 });
    assert.ok(pairCode.length === 6);
    const result = await syncB.join({ host: '127.0.0.1', port, pairCode });

    assert.equal(result.received, 61, 'B 应接收 A 的 61 个文件');
    assert.equal(result.sent, 41, 'B 应发出自己的 41 个文件');
    const afterA = allFiles(wsA);
    const afterB = allFiles(wsB);
    assert.equal(Object.keys(afterA).length, 102, 'A 应有 102 个文件');
    assert.equal(Object.keys(afterB).length, 102, 'B 应有 102 个文件');
    for (const [rel, content] of Object.entries(afterA)) {
      assert.equal(afterB[rel], content, `两边内容一致: ${rel}`);
    }
    // 二次同步应全 skip（增量：无变化不传）
    await syncA.stopHost();
    const { port: port2, pairCode: code2 } = await syncA.host({ port: 0 });
    const r2 = await syncB.join({ host: '127.0.0.1', port: port2, pairCode: code2 });
    assert.equal(r2.sent, 0, '二次同步无增量');
    assert.equal(r2.received, 0, '二次同步无接收');
    await syncA.stopHost();
  });

  test('冲突：两边同改一个文件，新版本生效 + 本地版保留副本', async () => {
    const wsA = mkWorkspace('ca');
    const wsB = mkWorkspace('cb');
    writeFiles(wsA, { '共享.md': 'A 的旧版本' });
    writeFiles(wsB, { '共享.md': 'B 的旧版本' });
    // 第一次同步对齐
    const sA = new LanSync({ store: memStore(), workspace: wsA });
    const sB = new LanSync({ store: memStore(), workspace: wsB });
    let h = await sA.host({ port: 0 });
    await sB.join({ host: '127.0.0.1', port: h.port, pairCode: h.pairCode });
    await sA.stopHost();
    // 对齐后两边都修改（B 的 mtime 更新 → B 胜出；A 的应保留为冲突副本）
    const future = Date.now() + 5000;
    fs.writeFileSync(path.join(wsA, '共享.md'), 'A 的修改');
    fs.writeFileSync(path.join(wsB, '共享.md'), 'B 的修改');
    const t = new Date(future);
    fs.utimesSync(path.join(wsB, '共享.md'), t, t);
    h = await sA.host({ port: 0 });
    const r = await sB.join({ host: '127.0.0.1', port: h.port, pairCode: h.pairCode });
    await sA.stopHost();
    const filesA = allFiles(wsA);
    assert.equal(filesA['共享.md'], 'B 的修改', '新版本（B）应覆盖 A');
    const conflicts = Object.keys(filesA).filter(k => k.startsWith('共享.conflict-'));
    assert.ok(conflicts.length >= 1, '应存在冲突副本');
    assert.ok(conflicts.some(k => filesA[k] === 'A 的修改'), 'A 的修改应保留为冲突副本');
    assert.ok(r.conflicts.length >= 0, '冲突统计字段存在');
  });

  test('配对码错误被拒绝', async () => {
    const wsA = mkWorkspace('ra');
    const wsB = mkWorkspace('rb');
    const sA = new LanSync({ store: memStore(), workspace: wsA });
    const sB = new LanSync({ store: memStore(), workspace: wsB });
    const h = await sA.host({ port: 0 });
    const wrongCode = String((parseInt(h.pairCode, 10) + 1) % 900000 + 100000);
    let threw = false;
    try {
      await sB.join({ host: '127.0.0.1', port: h.port, pairCode: wrongCode });
    } catch (e) { threw = /配对码|中断/.test(e.message); }
    assert.ok(threw, '错误配对码应被拒绝');
    await sA.stopHost();
  });

  test('safeRel 路径穿越防御', () => {
    assert.equal(safeRel('../etc/passwd'), null);
    assert.equal(safeRel('a/../../b'), null);
    assert.equal(safeRel('/abs/path'), null);
    assert.equal(safeRel('C:/win/abs'), null);
    assert.equal(safeRel('笔记/正常.md'), '笔记/正常.md');
  });

  test('帧协议编解码（含拆包/粘包）', () => {
    const msgs = [];
    const feed = makeDecoder(m => msgs.push(m));
    const f1 = encodeFrame({ op: 'hello', n: 1 });
    const f2 = encodeFrame({ op: 'done', n: 2 });
    // 粘包：两帧一起到达
    feed(Buffer.concat([f1, f2]));
    // 拆包：一帧分两次
    const f3 = encodeFrame({ op: 'want', paths: ['x.md', 'y.md'] });
    feed(f3.subarray(0, 5));
    feed(f3.subarray(5));
    assert.equal(msgs.length, 3);
    assert.equal(msgs[0].op, 'hello');
    assert.equal(msgs[1].op, 'done');
    assert.deepEqual(msgs[2].paths, ['x.md', 'y.md']);
  });

  test('身份持久化：同 store 复用证书', () => {
    const store = memStore();
    const s = new LanSync({ store, workspace: '/tmp' });
    const id1 = s.identity();
    const s2 = new LanSync({ store, workspace: '/tmp' });
    const id2 = s2.identity();
    assert.equal(id1.cert, id2.cert, '同 store 应复用同一证书');
    assert.ok(s.fingerprint().includes('-'), '指纹应格式化');
  });

  test('R1 位置键：不同工作区根的同一相对路径必须会合', () => {
    const wsA = mkWorkspace('pos-key-a');
    const wsB = mkWorkspace('pos-key-b');
    const a = new LanSync({ store: memStore(), workspace: wsA });
    const b = new LanSync({ store: memStore(), workspace: wsB });
    assert.equal(
      a.positionKey('editor', path.join(wsA, '文稿', '同一篇.md')),
      b.positionKey('editor', path.join(wsB, '文稿', '同一篇.md')),
      '工作区根不同也应按相对路径归一',
    );
  });

  test('R1 LWW：新时间胜、同毫秒设备号裁决、陈旧位置不得倒灌', () => {
    const ws = mkWorkspace('pos-lww');
    const store = memStore();
    const s = new LanSync({ store, workspace: ws });
    const key = s.positionKey('player', path.join(ws, '媒体', '片.mp4'));
    s.mergePositions([{ key, kind: 'player', value: { seconds: 90 }, updatedAt: 200, deviceId: 'dev-b' }]);
    s.mergePositions([{ key, kind: 'player', value: { seconds: 12 }, updatedAt: 100, deviceId: 'dev-z' }]);
    assert.equal(s.positions()[key].value.seconds, 90, '旧时间不得覆盖新位置');
    s.mergePositions([{ key, kind: 'player', value: { seconds: 91 }, updatedAt: 200, deviceId: 'dev-a' }]);
    assert.equal(s.positions()[key].value.seconds, 90, '同毫秒较小设备号不得覆盖');
    s.mergePositions([{ key, kind: 'player', value: { seconds: 92 }, updatedAt: 200, deviceId: 'dev-z' }]);
    assert.equal(s.positions()[key].value.seconds, 92, '同毫秒较大设备号应胜出并收敛');
  });

  test('R1 双实例只交换位置：零文件传输也能把编辑光标接到对端', async () => {
    const wsA = mkWorkspace('pos-sync-a');
    const wsB = mkWorkspace('pos-sync-b');
    const sA = new LanSync({ store: memStore(), workspace: wsA });
    const sB = new LanSync({ store: memStore(), workspace: wsB });
    sA.putPosition({ kind: 'editor', path: path.join(wsA, '文稿', '接力.md'), value: { from: 321, to: 321 } });
    const h = await sA.host({ port: 0 });
    const result = await sB.join({ host: '127.0.0.1', port: h.port, pairCode: h.pairCode });
    await sA.stopHost();
    assert.equal(result.sent, 0);
    assert.equal(result.received, 0);
    assert.ok(result.positions >= 1, '位置对象应随 manifest 合入');
    const got = sB.getPosition({ kind: 'editor', path: path.join(wsB, '文稿', '接力.md') });
    assert.equal(got.value.from, 321, '对端按自己的工作区根应取到同一光标');
  });

  test('W94E 真 TCP state-fact 轨：冲突保留、乱序重复重连收敛且坏签名拒绝', async () => {
    const ws = mkWorkspace('state-facts');
    const storeA = memStore();
    const storeB = memStore();
    const sA = new LanSync({ store: storeA, workspace: ws });
    const sB = new LanSync({ store: storeB, workspace: ws });
    try {
      const a = sA.putStateFact({ factKind: 'branch', factId: 'branch:shared', revision: 'rev:a', payloadRef: 'artifact:a' }).fact;
      const b = sB.putStateFact({ factKind: 'branch', factId: 'branch:shared', revision: 'rev:b', payloadRef: 'artifact:b' }).fact;
      assert.equal(a.workspaceId, b.workspaceId, '同一工作区的两端必须共享 state-fact identity');
      const host = await sA.host({ port: 0 });
      const first = await sB.join({ host: '127.0.0.1', port: host.port, pairCode: host.pairCode });
      await sA.stopHost();
      assert.equal(first.sent, 0);
      assert.equal(first.received, 0);
      assert.ok(first.stateFactConflicts.some(row => row.key === 'branch:branch:shared'), '真实 TCP 合并必须保留冲突');
      assert.equal(sB.stateFacts().length, 2, '冲突两份事实都必须耐久保留');

      const host2 = await sA.host({ port: 0 });
      const replay = await sB.join({ host: '127.0.0.1', port: host2.port, pairCode: host2.pairCode });
      await sA.stopHost();
      assert.equal(replay.stateFactConflicts.length, 0, '重连乱序重复只应产生 duplicate，不应制造二次冲突');
      assert.equal(sB.stateFacts().length, 2);
      const rejected = sB.mergeStateFacts([{ ...a, signature: 'tampered' }]);
      assert.equal(rejected.rejected.length, 1, '坏签名必须在 state-fact 轨拒绝');
    } finally {
      await sA.stop();
      await sB.stop();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('W94E 真 TCP 中途断线 fail-closed；跨帧乱序仍可重放收敛', async () => {
    const ws = mkWorkspace('state-facts-disconnect');
    const sA = new LanSync({ store: memStore(), workspace: ws });
    try {
      const host = await sA.host({ port: 0 });
      const raw = tls.connect({ host: '127.0.0.1', port: host.port, rejectUnauthorized: false });
      await new Promise((resolve, reject) => {
        raw.once('secureConnect', resolve);
        raw.once('error', reject);
      });
      const closed = new Promise(resolve => raw.once('close', resolve));
      raw.write(encodeFrame({ op: 'hello', pairCode: host.pairCode, deviceId: 'fixture-disconnect' }));
      const decoder = makeDecoder(msg => {
        // Destroy after the host has entered the real sync session and sent
        // its first frame. This is an actual TLS socket interruption, not a
        // direct callback shortcut.
        if (msg.op === 'manifest' || msg.op === 'state-facts') raw.destroy();
      });
      raw.on('data', decoder);
      await closed;
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(sA.lastResult?.error, '连接中断', '中途断线必须进入明确失败事实');

      // Protocol-level reorder fixture: state-facts is delivered before the
      // manifest, then duplicate/out-of-order control frames are replayed.
      const fact = sA.putStateFact({ factKind: 'event', factId: 'event:reorder', revision: 'rev:1', payloadRef: 'artifact:reorder' }).fact;
      const writes = [];
      const listeners = new Map();
      const socket = {
        write(frame) { writes.push(JSON.parse(frame.subarray(4).toString('utf8'))); },
        on(name, cb) { listeners.set(name, cb); return this; },
      };
      let settled;
      let failed;
      const session = sA.createSyncSession(socket, value => { settled = value; }, error => { failed = error; });
      session.push({ op: 'state-facts', workspaceId: sA.workspaceIdentity(), facts: [fact] });
      session.push({ op: 'manifest', files: [], positions: [] });
      session.push({ op: 'state-facts', workspaceId: sA.workspaceIdentity(), facts: [fact] });
      session.push({ op: 'want', paths: [] });
      session.push({ op: 'files', items: [] });
      session.push({ op: 'done', result: { stateFacts: 1 } });
      assert.equal(failed, undefined);
      assert.ok(settled, '重排控制帧仍应完成会话');
      assert.ok(writes.some(row => row.op === 'state-fact-ack'));
      assert.equal(sA.stateFacts().filter(row => row.factId === 'event:reorder').length, 1, '重复事实只保留一份');
    } finally {
      await sA.stop();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe('自动更新：版本比较', () => {
  test('semverCompare 各分支', () => {
    assert.equal(semverCompare('0.2.0', '0.1.0'), 1);
    assert.equal(semverCompare('0.1.0', '0.2.0'), -1);
    assert.equal(semverCompare('1.0.0', '1.0.0'), 0);
    assert.equal(semverCompare('v1.2.1', '1.2.0'), 1);
    assert.equal(semverCompare('0.1.0', '0.1.1'), -1);
    assert.equal(semverCompare('2.0', '1.9.9'), 1);
  });
});
