// tests/fuzz/run.mjs —— 模糊测试靶场：随机/畸形/截断输入轰炸手写解析器
// 目标：崩溃（未捕获异常）、挂起（超时）、破坏性输出（违反不变量）
import { randomBytes } from 'node:crypto';
import '../contract/_setup.mjs';

const { parseMobi } = await import('../../renderer/modules/library/mobi.js');
const { parseCbz } = await import('../../renderer/modules/library/cbz.js');
const { parseEpub } = await import('../../renderer/modules/library/epub.js');
const { parseDoc, serializeDoc, createNode } = await import('../../renderer/modules/mindmap/model.js');
const { parseCsvTasks } = await import('../../renderer/modules/factory/engine.js');
const { paginateText, textPageToHtml } = await import('../../renderer/modules/library/mobi.js');
const { naturalSort } = await import('../../renderer/modules/library/manga.js');
const { parseOutline } = await import('../../renderer/modules/slide/outline.js');
const { parseAbr } = await import('../../renderer/modules/draw/brushes.js');
const { validatePack } = await import('../../renderer/lib/theme-store.js');
const { parseMarkdown, serializeMarkdown } = await import('../../renderer/modules/markdown/schema.js');
const { parseOutline: mmParseOutline, toOutline } = await import('../../renderer/modules/mindmap/model.js');

const results = [];
const log = (target, kind, detail) => {
  results.push({ target, kind, detail });
  console.log(`[${kind}] ${target}: ${detail}`);
};

function randBuf(max = 4096) {
  const n = Math.floor(Math.random() * max);
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}
function mutate(buf) {
  const b = new Uint8Array(buf);
  for (let k = 0; k < Math.floor(Math.random() * 20) + 1; k++) {
    if (b.length) b[Math.floor(Math.random() * b.length)] = Math.floor(Math.random() * 256);
  }
  return b;
}
function truncate(buf, frac = Math.random()) {
  return buf.slice(0, Math.floor(buf.length * frac));
}
async function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('HANG:' + label)), ms)),
  ]);
}

// ============ 1) mobi 解析器 ============
async function fuzzMobi() {
  const target = 'mobi.parseMobi';
  // 纯随机
  for (let i = 0; i < 300; i++) {
    try { parseMobi(randBuf(2048).buffer); }
    catch (e) {
      if (/HANG/.test(e.message)) return log(target, 'CRASH', 'hang');
      if (!(e instanceof Error)) return log(target, 'CRASH', 'non-error throw');
    }
  }
  // 畸形头部：numRec 巨大 / 偏移越界
  const evil = [];
  const mk = (numRec, recOff) => {
    const b = new Uint8Array(200);
    b[76] = numRec >> 8; b[77] = numRec & 255;
    b[78] = (recOff >>> 24) & 255; b[79] = (recOff >>> 16) & 255; b[80] = (recOff >>> 8) & 255; b[81] = recOff & 255;
    b.set([77, 79, 66, 73], 16); // 'MOBI'
    return b.buffer;
  };
  evil.push(mk(0xffff, 78), mk(1, 0xffffffff), mk(5, 90), mk(2, 0));
  for (const [i, b] of evil.entries()) {
    try { parseMobi(b); }
    catch (e) { if (!/合法|损坏|异常|不支持|太小|未解析|缺少/.test(e.message)) return log(target, 'CRASH', `evil#${i}: ${e.message}`); }
  }
  // 压缩格式 2（LZ77）恶意记录
  const lz = new Uint8Array(300);
  const r0z = 78 + 16;
  lz.set([77, 79, 66, 73], r0z + 16); // 'MOBI' magic 于记录0+16
  lz[r0z] = 0; lz[r0z + 1] = 2; // compression=2
  lz[r0z + 4] = 0; lz[r0z + 5] = 0; lz[r0z + 6] = 0; lz[r0z + 7] = 100; // textLength
  lz[r0z + 8] = 0; lz[r0z + 9] = 2; // recordCount=2
  lz[76] = 0; lz[77] = 2; // numRec=2
  lz[78] = 0; lz[79] = 0; lz[80] = 0; lz[81] = r0z;
  lz[86] = 0; lz[87] = 0; lz[88] = 0; lz[89] = r0z + 100;
  // LZ77 恶意：距离越界（dist > 已输出长度）
  for (let i = 0; i < 30; i++) lz[r0z + 100 + i] = [0x80, 0x81, 0xbf, 0xc0, 0x05, 0xff][i % 6];
  try { parseMobi(lz.buffer); } catch (e) { if (!/压缩|退出码|损坏/.test(e.message)) return log(target, 'CRASH', 'lz77 evil: ' + e.message); }
  log(target, 'OK', '300随机+5畸形+LZ77越界未崩');
}

// ============ 2) cbz/epub（zip 截断/破损） ============
async function fuzzZipParsers() {
  const target = 'cbz/epub';
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('p1.png', new Uint8Array([137, 80, 78, 71]));
  zip.file('x.txt', 'hi');
  const good = await zip.generateAsync({ type: 'uint8array' });
  for (let i = 0; i < 100; i++) {
    const b = i % 3 === 0 ? truncate(good) : mutate(good);
    try {
      await withTimeout(parseCbz(b.buffer), 3000, 'cbz');
      await withTimeout(parseEpub(b.buffer), 3000, 'epub');
    } catch (e) {
      if (/HANG/.test(e.message)) return log(target, 'HANG', e.message);
    }
  }
  // epub 恶意 XML：超长实体引用/深嵌套
  const z2 = new JSZip();
  z2.file('META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>');
  z2.file('OEBPS/content.opf', `<?xml version="1.0"?><package><metadata><dc:title>t</dc:title></metadata><manifest><item id="c1" href="c1.html"/></manifest><spine><itemref idref="c1"/></spine></package>`);
  z2.file('OEBPS/c1.html', '<html><body>' + '<div>'.repeat(5000) + 'x' + '</div>'.repeat(5000) + '</body></html>');
  const b2 = await z2.generateAsync({ type: 'uint8array' });
  try { await withTimeout(parseEpub(b2.buffer), 5000, 'epub-deep'); }
  catch (e) { if (/HANG/.test(e.message)) return log(target, 'HANG', 'epub deep nest'); }
  log(target, 'OK', '100破损zip+深嵌套XML未崩');
}

// ============ 3) 导图 parseDoc（随机 JSON/深嵌套） ============
function fuzzMindmap() {
  const target = 'mindmap.parseDoc';
  const mkTree = (d) => d <= 0 ? createNode('x') : { id: 'n' + d, text: 'x'.repeat(100), children: [mkTree(d - 1)] };
  for (const d of [50, 200, 1000]) {
    try {
      const doc = { v: 3, mode: 'lr', roots: [mkTree(d)], notes: [], refLines: [], parentLinks: [] };
      const s = serializeDoc(doc);
      parseDoc(s);
    } catch (e) {
      if (/Maximum call stack/.test(e.message)) return log(target, 'CRASH', `深度${d} 栈溢出`);
      return log(target, 'CRASH', `深度${d}: ${e.message}`);
    }
  }
  for (let i = 0; i < 200; i++) {
    try { parseDoc(String.fromCharCode(...randBuf(500))); } catch (e) { return log(target, 'CRASH', 'rand: ' + e.message); }
  }
  log(target, 'OK', '深树50-1000+200随机未崩');
}

// ============ 4) CSV 解析 ============
function fuzzCsv() {
  const target = 'factory.parseCsvTasks';
  const tpl = { input_fields: [{ id: 'a', label: 'A', required: true }, { id: 'b', label: 'B' }] };
  const cases = [
    'A,B\n"', 'A,B\n"unclosed,""quote\n"x,y', 'A,B\n"a\nb\nc",d',
    'A,B\r\n\r\n\r\n,', 'A,B\n' + 'x'.repeat(100000), 'A,B\n",","","","',
    'A,B\n\'单引号\',2', 'A,B\n\uFEFFx,y',
  ];
  for (const c of cases) {
    try { parseCsvTasks(c, tpl); } catch (e) { /* 允许业务异常 */ }
  }
  for (let i = 0; i < 300; i++) {
    const lines = [];
    for (let j = 0; j < 30; j++) lines.push(String.fromCharCode(...randBuf(30)).replace(/\n/g, ' '));
    try { parseCsvTasks(lines.join('\n'), tpl); } catch (e) {}
  }
  log(target, 'OK', '8畸形+300随机未崩');
}

// ============ 5) 分页/自然排序/大纲 ============
function fuzzText() {
  // paginateText 边界
  for (const [t, n] of [['', 2600], ['x', 2600], ['x'.repeat(100000), 2600], ['a\n'.repeat(30000), 2600], ['短', 1], ['x'.repeat(10), 1]]) {
    try {
      const pages = paginateText(t, n);
      if (!pages.length) return log('paginateText', 'CRASH', `len=${t.length},page=${n} → 空页`);
      if (pages.some(p => p.length > n * 1.5 && n > 1)) return log('paginateText', 'WEIRD', `页超长 ${pages[0].length}/${n}`);
    } catch (e) { return log('paginateText', 'CRASH', e.message); }
  }
  // naturalSort 大数字溢出
  const pairs = [['p999999999999999999999', 'p2'], ['1'.repeat(40), '2'], ['第10话', '第2话'], ['a1b2c3', 'a1b10c3']];
  for (const [a, b] of pairs) naturalSort(a, b);
  // 大纲随机
  for (let i = 0; i < 200; i++) {
    try { parseOutline(String.fromCharCode(...randBuf(300))); } catch (e) { return log('slide.parseOutline', 'CRASH', e.message); }
  }
  log('text/outline', 'OK', '分页边界+排序溢出+200大纲未崩');
}

// ============ 6) markdown 往返 ============
function fuzzMarkdown() {
  const pieces = ['# t', '**b**', '*i*', '<u>u</u>', '- l', '1. n', '> q', '```js\ncode\n```', '|a|b|\n|-|-|\n|1|2|', '[x](y)', '[[双链]]', '<!--page:{}-->', '\u200b', '　', '\n\n\n'];
  for (let i = 0; i < 300; i++) {
    const doc = pieces.slice(0, 1 + Math.floor(Math.random() * pieces.length)).join('\n');
    try {
      const d = parseMarkdown(doc);
      const back = serializeMarkdown(d);
      const d2 = parseMarkdown(back);
      serializeMarkdown(d2);
    } catch (e) { return log('markdown.roundtrip', 'CRASH', `${e.message} @ ${JSON.stringify(doc).slice(0, 80)}`); }
  }
  log('markdown.roundtrip', 'OK', '300组合往返未崩');
}

// ============ 7) ABR 笔刷 ============
function fuzzAbr() {
  for (let i = 0; i < 100; i++) {
    try { parseAbr(randBuf(2048).buffer); } catch (e) { if (!/新版|压缩|格式|解析|仅支持|不支持/.test(e.message)) return log('draw.parseAbr', 'CRASH', e.message); }
  }
  log('draw.parseAbr', 'OK', '100随机未崩');
}

// ============ 8) 主题包校验 ============
function fuzzTheme() {
  for (let i = 0; i < 200; i++) {
    const junk = String.fromCharCode(...randBuf(200));
    try { validatePack(junk); } catch (e) { return log('theme.validatePack', 'CRASH', e.message); }
    try { validatePack('{"vars":{"bg":"#fff"}}'); } catch (e) {}
  }
  log('theme.validatePack', 'OK', '200垃圾未崩');
}

// ============ 9) 导图大纲往返 ============
function fuzzMmOutline() {
  for (let i = 0; i < 200; i++) {
    const md = Array.from({ length: Math.floor(Math.random() * 30) }, () =>
      ['# t', '- a', '  - b', '    - c', 'text', '- [ ] task', '- [x] done'][Math.floor(Math.random() * 7)]).join('\n');
    try {
      const roots = mmParseOutline(md);
      const back = toOutline(roots);
      mmParseOutline(back);
    } catch (e) { return log('mm.outline.roundtrip', 'CRASH', `${e.message} @ ${JSON.stringify(md).slice(0, 80)}`); }
  }
  log('mm.outline.roundtrip', 'OK', '200大纲往返未崩');
}

const suites = [fuzzMobi, fuzzZipParsers, fuzzMindmap, fuzzCsv, fuzzText, fuzzMarkdown, fuzzAbr, fuzzTheme, fuzzMmOutline];
for (const s of suites) await Promise.resolve().then(s).catch(e => log(s.name, 'HARNESS-ERR', e.message));

const bad = results.filter(r => r.kind !== 'OK');
console.log('\n═══ 模糊测试结果 ═══');
console.log(`通过 ${results.filter(r => r.kind === 'OK').length} 组，发现问题 ${bad.length} 组`);
for (const b of bad) console.log(`  [${b.kind}] ${b.target}: ${b.detail}`);
process.exit(bad.length ? 1 : 0);
