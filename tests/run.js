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
  'tests/contract/web-sync.test.mjs',
  'tests/contract/tree-ops.test.mjs',
  'tests/contract/ws-host.test.mjs',
  'tests/contract/pane-zoom.test.mjs',
  'tests/contract/share.test.mjs',
  'tests/contract/agreement.test.mjs',
  'tests/contract/theme-store.test.mjs',
  'tests/contract/import-split.test.mjs',
  'tests/contract/icon-config.test.mjs',
  'tests/contract/startmenu.test.mjs',
  'tests/contract/quicklaunch-v2.test.mjs',
  'tests/contract/print-preview.test.mjs',
  'tests/contract/format-v2.test.mjs',
  'tests/contract/draw-v2.test.mjs',
  'tests/contract/mm-v3.test.mjs',
  'tests/contract/v21.test.mjs',
  'tests/contract/v22.test.mjs',
  'tests/contract/v26-fixes.test.mjs',
  'tests/contract/factory.test.mjs',
  'tests/contract/v31-extreme.test.mjs',
  'tests/contract/factory-v2.test.mjs',
  'tests/contract/mm-formats.test.mjs',
  'tests/contract/sidebar-panels.test.mjs',
  'tests/contract/v45-fixes.test.mjs',
  'tests/contract/library-w18.test.mjs',
  'tests/contract/library-w19.test.mjs',
  'tests/contract/browser-views.test.mjs',
  'tests/contract/player-w22.test.mjs',
  'tests/contract/player-w23.test.mjs',
  'tests/contract/player-w24.test.mjs',
  'tests/contract/player-w25.test.mjs',
  'tests/contract/player-w26.test.mjs',
  'tests/contract/player-w27.test.mjs',
  'tests/contract/player-w28.test.mjs',
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
