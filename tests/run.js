// tests/run.js —— 测试入口：单元 + 契约 全量跑
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const files = [
  'tests/unit/core.test.mjs',
  'tests/unit/formula.test.mjs',
  'tests/contract/module-contract.test.mjs',
  'tests/contract/markdown-roundtrip.test.mjs',
  'tests/contract/browser-history.test.mjs',
  'tests/contract/notes-search.test.mjs',
  'tests/contract/notes-ui.test.mjs',
  'tests/contract/search-ui.test.mjs',
  'tests/contract/terminal-panel.test.mjs',
  'tests/contract/mindmap-draw.test.mjs',
  'tests/contract/mindmap-draw-ui.test.mjs',
  'tests/contract/library.test.mjs',
  'tests/contract/library-ui.test.mjs',
  'tests/contract/word-v2-plugins.test.mjs',
  'tests/contract/lansync.test.mjs',
  'tests/contract/help.test.mjs',
  'tests/contract/ui-theme.test.mjs',
  'tests/contract/i18n.test.mjs',
  'tests/contract/save-formats.test.mjs',
  'tests/contract/save-filters.test.mjs',
  'tests/roundtrip/docx.test.mjs',
  'tests/roundtrip/xlsx.test.mjs',
  'tests/roundtrip/pptx.test.mjs',
];

let failed = 0;
for (const f of files) {
  console.log(`\n━━━ ${f} ━━━`);
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', f)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(`\n═══ 总计：${files.length - failed}/${files.length} 个测试文件通过 ═══`);
process.exit(failed ? 1 : 0);
