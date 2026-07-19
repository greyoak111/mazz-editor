// tests/e2e/smoke.js —— 冒烟测试运行器：xvfb 下拉起真 Electron，断言关键能力
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const electron = require(path.join(root, 'node_modules', 'electron'));

const hasDisplay = !!process.env.DISPLAY;
const cmd = hasDisplay ? electron : 'xvfb-run';
const args = hasDisplay
  ? [path.join(root, 'tests', 'e2e', 'smoke-main.js'), '--no-sandbox']
  : ['-a', electron, path.join(root, 'tests', 'e2e', 'smoke-main.js'), '--no-sandbox'];

console.log('[smoke] 启动 Electron…');
const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60000, cwd: root });
const out = (r.stdout || '') + (r.stderr || '');

const m = out.match(/SMOKE_RESULT (\{.*\})/) || out.match(/SMOKE_TIMEOUT (\{.*\})/);
if (!m) {
  console.error('[smoke] 未拿到结果，原始输出：\n' + out.slice(-3000));
  process.exit(1);
}
const { checks, errors } = JSON.parse(m[1]);

const expects = {
  bridge: true,
  tabsAfterNew: 1,
  editorMounted: true,
  roundtrip: true,
  paletteMounted: true,
  ipcReadback: true,
  whitelistBlocked: true,
  pwRoundtrip: true,
  mindmapKeys: true,
  mindmapSplitKeys: true,
};
let fail = 0;
for (const [k, v] of Object.entries(expects)) {
  const ok = checks[k] === v;
  console.log(`  ${ok ? '✓' : '✗'} ${k} = ${checks[k]}（期望 ${v}）`);
  if (!ok) fail++;
}
if (!(checks.commandCount >= 60)) { console.log(`  ✗ commandCount = ${checks.commandCount}（期望 ≥60）`); fail++; }
else console.log(`  ✓ commandCount = ${checks.commandCount}`);
if (!checks.modules?.includes('markdown') || !checks.modules?.includes('text')) { console.log('  ✗ modules 注册不全'); fail++; }
else console.log(`  ✓ modules = [${checks.modules.join(', ')}]`);
if (errors.length) { console.log('  ⚠ 渲染进程报错：'); errors.slice(0, 5).forEach(e => console.log('    - ' + e)); }
if (checks.pwError) console.log('  ⚠ pw 错误：' + checks.pwError);
if (checks.mmError) console.log('  ⚠ mm 错误：' + checks.mmError);

console.log(fail ? `\n[smoke] 失败 ${fail} 项` : '\n[smoke] 全部通过');
process.exit(fail ? 1 : 0);
