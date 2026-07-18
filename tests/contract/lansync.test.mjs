// tests/contract/lansync.test.mjs —— 局域网同步：双实例全量同步（100 文件零丢失）/ 冲突 / 配对码 / 路径防御
import { describe, test, assert } from '../harness.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
