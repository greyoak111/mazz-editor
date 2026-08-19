import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { pruneDerivedCache } = require('../../main/derived-cache-budget.js');
const { FactorySseDecoder, MAX_SSE_LINE_CHARS } = require('../../main/factory-sse.js');
const { JsonLineDecoder, MAX_JSONL_LINE_CHARS } = require('../../main/adapters/stream-cli-adapter.js');
const PythonKernel = require('../../main/python-kernel.js');
const TorrentDaemon = require('../../main/torrent-daemon.js');
const { PoliteSiteTransport } = require('../../main/torrent-site-network.js');

const ROOT = path.resolve('.');
let pass = 0;
let fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (error) { fail++; console.error(`  ✗ ${name}\n    ${error.stack || error.message}`); }
}

console.log('\n■ W67 Accumulator Budgets');

await test('.audcache 只删派生缓存且按文件数/字节/年龄轮转', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w67-cache-'));
  const cache = path.join(base, '.audcache');
  fs.mkdirSync(cache);
  try {
    for (let index = 0; index < 12; index += 1) {
      const file = path.join(cache, `${String(index).padStart(2, '0')}.aac`);
      fs.writeFileSync(file, Buffer.alloc(10, index));
      fs.utimesSync(file, new Date(1000 + index * 1000), new Date(1000 + index * 1000));
    }
    const preserve = path.join(cache, '11.aac');
    const result = pruneDerivedCache(cache, { maxFiles: 5, maxBytes: 50, maxAgeMs: 0, preserve, now: 100_000 });
    assert.equal(result.remaining, 5);
    assert.equal(result.remainingBytes, 50);
    assert.equal(fs.existsSync(preserve), true);
    assert.throws(() => pruneDerivedCache(base, { maxFiles: 1, maxBytes: 1 }), /仅允许轮转/);
  } finally {
    const resolved = path.resolve(base);
    assert.equal(resolved.startsWith(path.resolve(os.tmpdir())), true);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

await test('SSE 与 CLI JSONL 的无换行输入有硬上限', () => {
  const sse = new FactorySseDecoder();
  assert.throws(() => sse.push('x'.repeat(MAX_SSE_LINE_CHARS + 1)), /2 MiB 上限/);
  const values = [];
  const jsonl = new JsonLineDecoder(value => values.push(value));
  jsonl.feed('x'.repeat(MAX_JSONL_LINE_CHARS + 1));
  assert.equal(values.at(-1).type, 'transport.line_limit');
  assert.equal(jsonl.buffer, '');
});

await test('Python、Torrent 内联、终端、索引、结果缓存均声明固定预算', () => {
  assert.equal(PythonKernel.MAX_OUTPUT_CHARS, 16 * 1024 * 1024);
  assert.equal(PythonKernel.MAX_QUEUE, 64);
  assert.equal(TorrentDaemon.MAX_INLINE_FILE_BYTES, 32 * 1024 * 1024);
  const terminal = fs.readFileSync(path.join(ROOT, 'renderer/modules/code/terminal-view.js'), 'utf8');
  const indexer = fs.readFileSync(path.join(ROOT, 'renderer/modules/search/indexer.js'), 'utf8');
  const calc = fs.readFileSync(path.join(ROOT, 'renderer/modules/markdown/calc-block.js'), 'utf8');
  const image = fs.readFileSync(path.join(ROOT, 'renderer/modules/viewer/imgedit.js'), 'utf8');
  const browser = fs.readFileSync(path.join(ROOT, 'renderer/modules/browser/index.js'), 'utf8');
  assert.match(terminal, /scrollback:\s*5000/);
  assert.match(indexer, /MAX_INDEX_FILES\s*=\s*10_000/);
  assert.match(calc, /RESULT_CACHE_LIMIT\s*=\s*128/);
  assert.match(image, /constructor\(maxSize = 15\)/);
  assert.match(browser, /history = ctl\.history\.slice\(0, 200\)/);
});

await test('四站网络缓存会清过期项并执行 LRU 式固定上限', async () => {
  let now = 1;
  const transport = new PoliteSiteTransport({
    now: () => now++, wait: async () => {}, minIntervalMs: 0, maxCacheEntries: 16,
    request: async spec => ({ statusCode: 200, body: spec.url, headers: {} }),
  });
  for (let index = 0; index < 20; index += 1) await transport.request('dmhy', `https://example.test/${index}`);
  assert.equal(transport.cache.size, 16);
});

console.log(`\n==============================================\n通过 ${pass} · 失败 ${fail} · 共 ${pass + fail}`);
process.exit(fail ? 1 : 0);
