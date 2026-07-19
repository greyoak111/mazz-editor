// tests/harness.mjs —— 极简测试框架（自动执行：测试文件只需 describe/test）
import assert from 'node:assert/strict';

const suites = [];
let current = null;

export function describe(name, fn) {
  const prev = current;
  current = { name, tests: [], failures: 0 };
  suites.push(current);
  fn();
  current = prev;
}

export function test(name, fn) {
  if (!current) throw new Error('test() 必须在 describe() 内');
  current.tests.push({ name, fn });
}

export { assert };

export async function runAll() {
  let pass = 0, fail = 0;
  for (const suite of suites) {
    console.log(`\n■ ${suite.name}`);
    for (const t of suite.tests) {
      try {
        await t.fn();
        pass++;
        console.log(`  ✓ ${t.name}`);
      } catch (e) {
        fail++;
        suite.failures++;
        const msg = (e && e.message ? e.message : String(e)).split('\n').slice(0, 6).join('\n    ');
        console.error(`  ✗ ${t.name}\n    ${msg}`);
      }
    }
  }
  console.log(`\n${'='.repeat(46)}\n通过 ${pass} · 失败 ${fail} · 共 ${pass + fail}`);
  return fail;
}

// 自动执行（进程事件循环排空后；防重入——异步期间 beforeExit 会重复触发）
let started = false;
process.on('beforeExit', () => {
  if (started) return;
  started = true;
  runAll().then((fail) => { process.exitCode = fail ? 1 : 0; });
});
