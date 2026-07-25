// tests/contract/web-sync.test.mjs —— 移动端同步/存储契约
// 覆盖：帧编解码 · 配对码密钥派生与 Node 互操作 · diffWant 一致性 · 工作区冲突写入 · Capacitor 后端路径映射
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import {
  encodeFrameU8, makeDecoderU8, sha256hex, derivePairKey, encryptBytes, decryptBytes,
  safeRel, diffWant, makeWorkspace,
} from '../../renderer/lib/sync-web.js';
import { installBrowserBridge } from '../../renderer/lib/browser-bridge.js';
import nodeCrypto from 'node:crypto';

// jsdom 全局垫片：browser-bridge 直接使用裸 localStorage/sessionStorage
if (!globalThis.localStorage) globalThis.localStorage = window.localStorage;
if (!globalThis.sessionStorage) globalThis.sessionStorage = window.sessionStorage;

describe('帧编解码（Uint8Array，与桌面 4 字节前缀一致）', () => {
  test('单帧往返', () => {
    const buf = encodeFrameU8({ op: 'hello', n: 1 });
    const got = [];
    makeDecoderU8((m) => got.push(m))(buf);
    assert.equal(got.length, 1);
    assert.equal(got[0].op, 'hello');
  });
  test('粘包 + 拆包', () => {
    const a = encodeFrameU8({ op: 'a' });
    const b = encodeFrameU8({ op: 'b', big: 'x'.repeat(70000) }); // 触发 16 位以上长度
    const joined = new Uint8Array(a.length + b.length);
    joined.set(a); joined.set(b, a.length);
    const got = [];
    const feed = makeDecoderU8((m) => got.push(m));
    feed(joined.slice(0, 3)); // 先喂半个头
    feed(joined.slice(3));
    assert.deepEqual(got.map(m => m.op), ['a', 'b']);
  });
});

describe('配对码加密：WebCrypto ↔ Node crypto 互操作', () => {
  test('sha256hex 与 Node 一致', async () => {
    assert.equal(await sha256hex('272799'), nodeCrypto.createHash('sha256').update('272799').digest('hex'));
  });
  test('密钥派生与 AES-GCM 加解密跨端互通', async () => {
    const pairCode = '482916';
    const salt = nodeCrypto.randomBytes(16);
    const saltB64 = salt.toString('base64');
    // Web 端派生
    const webKey = await derivePairKey(pairCode, saltB64);
    // Node 端按桌面 lansync.js 同参数派生
    const nodeKey = nodeCrypto.pbkdf2Sync(nodeCrypto.createHash('sha256').update(pairCode).digest(), salt, 100000, 32, 'sha256');
    // Web 加密 → Node 解密
    const plain = encodeFrameU8({ op: 'manifest', files: [{ path: 'a.md' }] });
    const encMsg = await encryptBytes(webKey, plain);
    const raw = Buffer.from(encMsg.data, 'base64');
    const d = nodeCrypto.createDecipheriv('aes-256-gcm', nodeKey, Buffer.from(encMsg.iv, 'base64'));
    d.setAuthTag(raw.slice(raw.length - 16));
    const dec = Buffer.concat([d.update(raw.slice(0, raw.length - 16)), d.final()]);
    assert.ok(dec.equals(Buffer.from(plain)));
    // Node 加密 → Web 解密
    const iv = nodeCrypto.randomBytes(12);
    const c = nodeCrypto.createCipheriv('aes-256-gcm', nodeKey, iv);
    const ct = Buffer.concat([c.update(Buffer.from(plain)), c.final()]);
    const back = await decryptBytes(webKey, { op: 'enc', iv: iv.toString('base64'), data: Buffer.concat([ct, c.getAuthTag()]).toString('base64') });
    assert.deepEqual([...back], [...plain]);
    // 错误口令 → GCM 校验必须失败
    const badKey = await derivePairKey('000000', saltB64);
    await assert.rejects(() => decryptBytes(badKey, encMsg));
  });
});

describe('safeRel / diffWant（与桌面同语义）', () => {
  test('路径穿越拒绝', () => {
    assert.equal(safeRel('../x'), null);
    assert.equal(safeRel('/abs'), null);
    assert.equal(safeRel('C:/win'), null);
    assert.equal(safeRel('a/b.md'), 'a/b.md');
  });
  test('diffWant 双方结论一致', () => {
    const mine = [{ path: 'a', hash: 'h1', mtime: 1 }, { path: 'b', hash: 'hb', mtime: 5 }];
    const remote = [{ path: 'a', hash: 'h1', mtime: 1 }, { path: 'b', hash: 'h2', mtime: 9 }, { path: 'c', hash: 'hc', mtime: 1 }];
    assert.deepEqual(diffWant(mine, remote), ['b', 'c']);
    assert.deepEqual(diffWant(remote, mine), []); // 对方视角：b 较旧、c 对方没有对方也不给
  });
});

describe('工作区适配（localStorage 后端）', () => {
  installBrowserBridge();
  const mazz = window.mazz;
  const ws = makeWorkspace(mazz);

  test('扫描/读取/同步写入 + 文本可编辑性', async () => {
    await mazz.invoke('fs:writeFile', { path: '/workspace/t1.md', content: '旧内容\n' });
    const files = await ws.scanFiles();
    assert.ok(files.some(f => f.path === 't1.md'));
    const item = await ws.readItem('t1.md');
    assert.ok(item.hash && item.data);
    // 模拟来件覆盖（本地未偏离基线）
    const b64 = btoa(unescape(encodeURIComponent('新内容\n')));
    const r = await ws.writeIncoming({ path: 't1.md', hash: 'x', data: b64, mtime: Date.now() }, { 't1.md': item.hash });
    assert.equal(r.status, 'ok');
    assert.equal(await mazz.invoke('fs:readFile', { path: '/workspace/t1.md' }), '新内容\n'); // 非 base64 乱码
  });

  test('冲突：本地偏离基线 → 保留 .conflict 副本', async () => {
    const b64 = btoa(unescape(encodeURIComponent('服务器版\n')));
    const r = await ws.writeIncoming({ path: 't1.md', hash: 'y', data: b64, mtime: Date.now() }, {});
    assert.equal(r.status, 'conflict');
    assert.equal(await mazz.invoke('fs:readFile', { path: '/workspace/t1.md' }), '服务器版\n');
    const names = (await mazz.invoke('fs:listDir', { path: '/workspace' })).map(f => f.name);
    assert.ok(names.some(n => n.startsWith('t1.conflict-')));
  });

  test('内容一致 → skip', async () => {
    const cur = await ws.readItem('t1.md');
    const r = await ws.writeIncoming({ path: 't1.md', hash: cur.hash, data: cur.data, mtime: Date.now() }, {});
    assert.equal(r.status, 'skip');
  });
});

describe('Capacitor 文件后端（伪插件验证路径映射）', () => {
  test('读写/列目录/重命名/删除', async () => {
    // 内存版 @capacitor/filesystem 伪实现
    const disk = new Map();
    const FS = {
      async mkdir({ path }) { disk.set(path, 'dir'); },
      async writeFile({ path, data, encoding }) { disk.set(path, encoding ? 'T:' + data : 'B:' + data); },
      async readFile({ path, encoding }) {
        const v = disk.get(path);
        if (v == null || v === 'dir') throw new Error('ENOENT');
        return { data: v.slice(2) };
      },
      async readdir({ path }) {
        const prefix = path + '/';
        const files = [];
        for (const k of disk.keys()) {
          if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) {
            files.push({ name: k.slice(prefix.length), type: disk.get(k) === 'dir' ? 'directory' : 'file' });
          }
        }
        return { files };
      },
      async stat({ path }) {
        const v = disk.get(path);
        if (v == null) throw new Error('ENOENT');
        return { type: v === 'dir' ? 'directory' : 'file', size: v.length, mtime: 123 };
      },
      async rename({ from, to }) {
        for (const k of [...disk.keys()]) {
          if (k === from || k.startsWith(from + '/')) { disk.set(to + k.slice(from.length), disk.get(k)); disk.delete(k); }
        }
      },
      async deleteFile({ path }) { disk.delete(path); },
      async rmdir({ path }) { for (const k of [...disk.keys()]) if (k === path || k.startsWith(path + '/')) disk.delete(k); },
    };
    const { createCapBackendForTest } = await import('../../renderer/lib/browser-bridge.js');
    const b = createCapBackendForTest(FS);
    await b.mkdir('/workspace/docs');
    await b.writeFile('/workspace/docs/a.md', '你好');
    assert.equal(await b.readFile('/workspace/docs/a.md'), '你好');
    assert.ok(disk.has('workspace/docs/a.md')); // 路径映射：/workspace/x → workspace/x
    const list = await b.listDir('/workspace/docs');
    assert.deepEqual(list.map(f => f.name), ['a.md']);
    assert.equal((await b.stat('/workspace/docs/a.md')).exists, true);
    await b.rename('/workspace/docs/a.md', '/workspace/docs/b.md');
    assert.equal(await b.readFile('/workspace/docs/b.md'), '你好');
    await b.delete('/workspace/docs');
    assert.equal((await b.stat('/workspace/docs')).exists, false);
  });
});
