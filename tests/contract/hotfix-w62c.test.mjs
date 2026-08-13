import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rankQuickCandidates, scoreQuickCandidate } from '../../renderer/core/quick-switcher.js';

const samePath = 'D:/workspace/alpha-notes.md';
const ranked = rankQuickCandidates('alpha', [
  { kind: 'file', title: 'alpha-notes.md', path: samePath, detail: samePath },
  { kind: 'recent', title: 'alpha-notes.md', path: samePath, detail: samePath, recentOrder: 0 },
  { kind: 'command', id: 'alpha.run', title: 'Alpha 命令', detail: '测试' },
  { kind: 'content', title: 'other.md', path: 'D:/workspace/other.md', line: 12, preview: '这里正文命中 alpha 关键字' },
]);
assert.deepEqual(ranked.map(item => item.kind), ['recent', 'command', 'content'], '同路径去重并保留最近身份，四路进入同一排序');
assert.equal(ranked[0].sourceLabel, '最近');
assert.equal(ranked[2].sourceLabel, '全文');
assert.ok(scoreQuickCandidate('alpha', { kind: 'file', title: 'alpha.md' })
  > scoreQuickCandidate('alpha', { kind: 'file', title: 'my-alpha.md' }), '标题前缀必须高于中段包含');
assert.ok(scoreQuickCandidate('alpha', { kind: 'recent', title: 'alpha-recent.md', detail: 'D:/alpha-recent.md', recentOrder: 0 })
  > scoreQuickCandidate('alpha', { kind: 'content', title: 'alpha-content.md', detail: 'D:/alpha-content.md', preview: 'alpha 正文' }), '最近+前缀不得被全文附加分反超');
assert.equal(scoreQuickCandidate('missing', { kind: 'command', title: '导出 PDF', id: 'file.exportPDF' }), null, '无命中候选不得混入');
assert.equal(rankQuickCandidates('', [
  { kind: 'file', title: '普通文件', path: 'D:/a.md' },
  { kind: 'recent', title: '最近文件', path: 'D:/b.md', recentOrder: 0 },
  { kind: 'command', id: 'x', title: '命令' },
])[0].kind, 'recent', '空查询默认最近优先');

const shell = fs.readFileSync(new URL('../../renderer/shell/shell.js', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('../../renderer/panels/palette.html', import.meta.url), 'utf8');
const shared = fs.readFileSync(new URL('../../renderer/modules/search/shared-index.js', import.meta.url), 'utf8');
const panelWindows = fs.readFileSync(new URL('../../main/panel-windows.js', import.meta.url), 'utf8');

assert.match(shell, /K\('ctrl\+p', 'file\.quickOpen'\)/, 'Ctrl+P 必须切到 Quick Switcher');
assert.match(shell, /K\('ctrl\+alt\+p', 'file\.print'\)/, '打印迁至 Ctrl+Alt+P');
assert.match(shell, /ensureSharedSearchIndex/);
assert.match(shell, /kind: 'content'/);
assert.match(shell, /quickSwitcherQuery/);
assert.match(shell, /quickSwitcherRun/);
assert.match(panel, /文件、命令、最近打开和全文内容/);
assert.match(panel, /p\.requestId < issued/, '异步查询必须拒绝旧响应覆盖');
assert.match(panel, /items = \[\]; render\(\); ask\(\)/, '输入换词须立即撤掉旧结果，防抖期不可误执行');
assert.match(panel, /kind-content/);
assert.match(panel, /it\.preview/);
assert.match(shared, /let building = null/, '全文索引并发构建必须合流');
assert.match(panelWindows, /kind === 'palette' \? 720/);

console.log('✓ W62c 四路统一排序 / 最近与前缀加权 / 全文预览 / Ctrl+P / 异步防串答契约');
