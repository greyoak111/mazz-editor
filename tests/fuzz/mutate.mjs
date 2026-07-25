// tests/fuzz/mutate.mjs —— 变异测试：对核心函数做受控变异，验证现有测试能否逮住变异体
// 用法：node tests/fuzz/mutate.mjs（对每组变异体跑相关契约测试）
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const MUTANTS = [
  {
    file: 'renderer/modules/library/manga.js',
    name: 'naturalSort 数字比较反号',
    find: "if (an !== bn) return an - bn;",
    repl: "if (an !== bn) return bn - an;",
    test: 'tests/contract/v31-extreme.test.mjs',
  },
  {
    file: 'renderer/modules/library/mobi.js',
    name: 'paginateText 页大小除二',
    find: "export function paginateText(text, pageChars = 2600) {",
    repl: "export function paginateText(text, pageChars = 1300) {",
    test: 'tests/contract/v31-extreme.test.mjs',
  },
  {
    file: 'renderer/modules/library/mobi.js',
    name: 'LZ77 距离计算错一位',
    find: "      dist = (dist & 0x3fff) >>> 2;",
    repl: "      dist = ((dist & 0x3fff) >>> 2) + 1;",
    test: 'tests/contract/v31-extreme.test.mjs',
  },
  {
    file: 'renderer/modules/mindmap/model.js',
    name: 'moveNode 防环判断反转',
    find: "  if (isDesc) return false;",
    repl: "  if (isDesc) return true;",
    test: 'tests/contract/v31-extreme.test.mjs',
  },
  {
    file: 'renderer/modules/library/mobi.js',
    name: 'stripMarkup 去标签正则去掉',
    find: ".replace(/<[^>]+>/g, '')",
    repl: "",
    test: 'tests/contract/v31-extreme.test.mjs',
  },
];

const results = [];
for (const m of MUTANTS) {
  const src = readFileSync(m.file, 'utf8');
  if (!src.includes(m.find)) { results.push({ ...m, status: 'SKIP(定位失败)' }); continue; }
  writeFileSync(m.file, src.replace(m.find, m.repl));
  try {
    if (m.test) {
      execSync(`node ${m.test}`, { stdio: 'pipe', timeout: 60000 });
      results.push({ ...m, status: '⚠ 漏网（测试未发现变异体！）' });
    } else {
      results.push({ ...m, status: '⚠ 无测试覆盖' });
    }
  } catch (e) {
    results.push({ ...m, status: '✓ 被逮住' });
  } finally {
    writeFileSync(m.file, src); // 还原
  }
}
console.log(JSON.stringify(results, null, 1));
