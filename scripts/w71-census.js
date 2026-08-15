// scripts/w71-census.js —— W71 Wave 0 可重复 Census：只读源码并生成审计证据
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const auditDir = path.join(root, '.mazz', 'audit');
const slash = value => value.replace(/\\/g, '/');
const rel = value => slash(path.relative(root, value));

function walk(dir, { extensions = null, exclude = [] } = {}) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    const relative = rel(full);
    if (exclude.some(prefix => relative === prefix || relative.startsWith(`${prefix}/`))) continue;
    if (entry.isDirectory()) out.push(...walk(full, { extensions, exclude }));
    else if (!extensions || extensions.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

function sourceLines(files) {
  const records = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((text, index) => records.push({ file: rel(file), line: index + 1, text }));
  }
  return records;
}

function scan(records, rules) {
  const findings = [];
  for (const record of records) {
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      if (!rule.pattern.test(record.text)) continue;
      const provisionalClass = typeof rule.provisionalClass === 'function'
        ? rule.provisionalClass(record.text)
        : rule.provisionalClass;
      findings.push({
        rule: rule.id,
        ...(provisionalClass ? { provisionalClass } : {}),
        file: record.file,
        line: record.line,
        sample: record.text.trim().slice(0, 320),
      });
    }
  }
  return findings;
}

function summarize(findings, key = 'rule') {
  const byRule = {};
  const byFile = {};
  for (const item of findings) {
    byRule[item[key]] = (byRule[item[key]] || 0) + 1;
    byFile[item.file] = (byFile[item.file] || 0) + 1;
  }
  return {
    totalFindings: findings.length,
    filesWithFindings: Object.keys(byFile).length,
    byRule,
    topFiles: Object.entries(byFile).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30)
      .map(([file, count]) => ({ file, count })),
  };
}

const uiFiles = walk(path.join(root, 'renderer'), {
  extensions: new Set(['.css', '.html', '.js', '.svg']),
  exclude: ['renderer/dist', 'renderer/vendor'],
});
const uiLines = sourceLines(uiFiles);

const layoutRules = [
  { id: 'width-100vw', pattern: /\bwidth\s*:\s*100vw\b/i, provisionalClass: 'D' },
  { id: 'fixed-width-px', pattern: /(?<![-\w])width\s*:\s*(?:['"`])?\d{2,4}px\b/i,
    provisionalClass: line => /(?:ico|icon|avatar|grip|handle|caret|dot|badge|checkbox|radio|resize)/i.test(line) ? 'A' : 'D' },
  { id: 'fixed-min-width', pattern: /\b(?:min-width|minWidth)\s*[:=]\s*(?:['"`])?\d{2,4}(?:px)?\b/i, provisionalClass: 'B' },
  { id: 'fixed-left-right', pattern: /(?:^|[;{]\s*)(?:left|right)\s*:\s*-?\d{2,4}px\b/i, provisionalClass: 'C' },
  { id: 'calc-viewport-or-container', pattern: /calc\(\s*100(?:vw|%)\s*-/i, provisionalClass: 'E' },
  { id: 'position-absolute', pattern: /\bposition\s*:\s*absolute\b/i,
    provisionalClass: line => /(?:overlay|mask|menu|tooltip|popover|grip|handle|caret|badge|progress|resize|selection|cursor)/i.test(line) ? 'A' : 'D' },
  { id: 'flex-shrink-zero', pattern: /\bflex-shrink\s*:\s*0\b/i, provisionalClass: 'A' },
  { id: 'white-space-nowrap', pattern: /\bwhite-space\s*:\s*nowrap\b/i,
    provisionalClass: line => /text-overflow\s*:\s*ellipsis/i.test(line) && /overflow\s*:\s*hidden/i.test(line) ? 'A' : 'D' },
  { id: 'overflow-x-visible', pattern: /\boverflow-x\s*:\s*visible\b/i, provisionalClass: 'D' },
  { id: 'resize-js-layout', pattern: /\b(?:ResizeObserver|addEventListener\(\s*['"]resize|onresize\b)/, provisionalClass: 'E' },
  { id: 'sidebar-pixel-coupling', pattern: /sidebar.{0,100}\b\d{2,4}px\b/i, provisionalClass: 'E' },
];
const layoutFindings = scan(uiLines, layoutRules);
const layoutByClass = {};
for (const finding of layoutFindings) layoutByClass[finding.provisionalClass] = (layoutByClass[finding.provisionalClass] || 0) + 1;

const visualRules = [
  { id: 'inline-style-attribute', pattern: /\bstyle\s*=\s*['"]/i },
  { id: 'inline-css-text', pattern: /\.style\.cssText\s*=/ },
  { id: 'native-form-control', pattern: /<(?:button|select|input|textarea)\b/i },
  { id: 'loading-state-term', pattern: /\b(?:loading|spinner|skeleton|加载中)\b/i },
  { id: 'empty-state-term', pattern: /\b(?:empty-state|emptyState|空状态|暂无)\b/i },
  { id: 'error-state-term', pattern: /\b(?:error-state|errorState|错误|失败)\b/i },
  { id: 'tooltip-or-title', pattern: /\b(?:title\s*=|tooltip)\b/i },
];
const iconRules = [
  { id: 'emoji-or-symbol-literal', pattern: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u },
  { id: 'inline-svg', pattern: /<svg\b/i },
  { id: 'icon-html-adapter', pattern: /\biconHtml\s*\(/ },
  { id: 'icon-metadata', pattern: /\bicon\s*:\s*['"`]/ },
  { id: 'current-color', pattern: /currentColor/i },
  { id: 'hardcoded-svg-color', pattern: /(?:fill|stroke)\s*=\s*['"](?:#[0-9a-f]{3,8}|black|white)/i },
  { id: 'icon-registry', pattern: /\b(?:IconRegistry|iconId)\b/ },
];
const themeRules = [
  { id: 'semantic-token-use', pattern: /var\(\s*--[\w-]+/i },
  { id: 'hardcoded-hex-color', pattern: /#[0-9a-f]{3,8}\b/i },
  { id: 'hardcoded-rgb-hsl', pattern: /\b(?:rgb|rgba|hsl|hsla)\s*\(/i },
  { id: 'border-radius', pattern: /\bborder-radius\s*:/i },
  { id: 'box-shadow', pattern: /\bbox-shadow\s*:/i },
  { id: 'font-family', pattern: /\bfont-family\s*:/i },
  { id: 'theme-selector', pattern: /(?:data-theme|theme:changed|themeId|nativeTheme)/i },
];
const visualFindings = scan(uiLines, visualRules);
const iconFindings = scan(uiLines, iconRules);
const themeFindings = scan(uiLines, themeRules);

const uiCensus = {
  schemaVersion: 1,
  scope: {
    root: 'renderer', ownership: 'first-party only',
    excluded: ['renderer/dist', 'renderer/vendor'],
    extensions: ['.css', '.html', '.js', '.svg'],
    scannedFiles: uiFiles.length, scannedLines: uiLines.length,
  },
  thresholds: {
    normalTextContrast: 4.5,
    largeTextKeyIconFocusContrast: 3,
    note: 'Wave 0 frozen baseline; runtime computed-style verification remains a later gate.',
  },
  visual: { summary: summarize(visualFindings), findings: visualFindings },
  icon: { summary: summarize(iconFindings), findings: iconFindings },
  theme: { summary: summarize(themeFindings), findings: themeFindings },
  layout: { summary: { ...summarize(layoutFindings), byProvisionalClass: layoutByClass }, findings: layoutFindings },
  limitations: [
    'Counts are matched source lines, not distinct runtime controls.',
    'Emoji in user-facing prose and content samples are candidates, not automatic violations.',
    'Hardcoded colors may be semantic/content colors; Wave 5B must review before replacement.',
    'Layout A-E classes are deterministic provisional triage and require module-owner confirmation.',
  ],
};

const mainFiles = walk(path.join(root, 'main'), { extensions: new Set(['.js']) });
const mainLines = sourceLines(mainFiles);
const surfaceRules = [
  { id: 'browser-window-construction', pattern: /new BrowserWindow\s*\(/ },
  { id: 'web-contents-view-construction', pattern: /new WebContentsView\s*\(/ },
  { id: 'browser-window-registry', pattern: /BrowserWindow\.fromWebContents|BrowserWindow\.getAllWindows/ },
  { id: 'native-content-view-ownership', pattern: /contentView\.(?:addChildView|removeChildView)/ },
  { id: 'session-partition', pattern: /session\.fromPartition\s*\(/ },
  { id: 'window-close-hook', pattern: /\.on\(\s*['"]closed['"]/ },
  { id: 'render-gone-hook', pattern: /render-process-gone/ },
];
const surfaceFindings = scan(mainLines, surfaceRules);

const workaroundDefinitions = [
  { id: 'WKR-BV-INVALIDATE', owner: 'BrowserViews', status: 'KEEP', pattern: /webContents\.invalidate\s*\(/, reason: 'Windows D3D WebContentsView hide/show repaint loss.' },
  { id: 'WKR-BV-BOUNDS-OSCILLATION', owner: 'BrowserViews', status: 'KEEP', pattern: /R\.(?:width|height) - 1/, reason: 'Second-frame compositor recovery after a hidden native surface returns.' },
  { id: 'WKR-BACKGROUND-THROTTLING', owner: 'WindowManager/BrowserViews', status: 'KEEP', pattern: /backgroundThrottling\s*:\s*false/, reason: 'Recorder and occluded native-surface continuity.' },
  { id: 'WKR-RELOAD-CONVERGENCE', owner: 'Browser module', status: 'KEEP', pattern: /reloadTab\s*\(/, reason: 'about:blank home document cannot use a raw webContents reload path.' },
  { id: 'WKR-DRAG-CLOAK', owner: 'Shell/Browser module', status: 'KEEP', pattern: /dragCloak\s*\(/, reason: 'Native WebContentsView consumes drag hit-testing above DOM drop targets.' },
  { id: 'WKR-PANE-MOVE-RESYNC', owner: 'Shell/Browser module', status: 'KEEP', pattern: /pane:tabMoved/, reason: 'Native view host move requires post-layout bounds/reload convergence.' },
  { id: 'WKR-NATIVE-CONTEXT-MENU', owner: 'BrowserViews', status: 'KEEP', pattern: /Menu\.buildFromTemplate\s*\(/, reason: 'DOM menu layering conflicts with native WebContentsView.' },
  { id: 'WKR-HOST-AWARE-DESTROY', owner: 'WindowManager/BrowserViews', status: 'KEEP', pattern: /destroyByHost\s*\(/, reason: 'A child window must not leave native views alive after host destruction.' },
  { id: 'WKR-PER-SESSION-PROTOCOL', owner: 'Main/session setup', status: 'KEEP', pattern: /browserSess\.protocol\.handle/, reason: 'Persisted browser partition does not inherit the default-session custom protocol handler.' },
  { id: 'WKR-SAFE-GRAPHICS', owner: 'Main startup', status: 'KEEP', pattern: /detectUnsafeGraphicsHost|disable-direct-composition/, reason: 'Remote/virtual display drivers can crash the Chromium GPU process.' },
];
const allFirstPartyLines = sourceLines([...mainFiles, ...uiFiles]);
const workarounds = workaroundDefinitions.map(item => ({
  id: item.id, owner: item.owner, status: item.status, reason: item.reason,
  removalGate: 'Only after an equivalent Windows packaged-runtime probe passes without the mechanism and rollback is documented.',
  evidence: scan(allFirstPartyLines, [{ id: item.id, pattern: item.pattern }]).map(({ file, line, sample }) => ({ file, line, sample })),
}));

const panelSource = fs.readFileSync(path.join(root, 'main', 'panel-windows.js'), 'utf8');
const allowMatch = panelSource.match(/if \(!\/\^\(([^)]+)\)\$\/.test\(kind\)\)/);
const panelKinds = allowMatch ? allowMatch[1].split('|') : [];
const surfaceCensus = {
  schemaVersion: 1,
  scope: { scannedFiles: mainFiles.length, scannedLines: mainLines.length },
  inventory: {
    managedWindowFamilies: ['main', 'child', 'quick-note'], panelKinds,
    nativeBrowserViewFamily: 'BrowserViews / WebContentsView per browser tab',
    sessionPartitions: [...new Set(surfaceFindings.filter(x => x.rule === 'session-partition').map(x => x.sample))],
  },
  protocolReality: {
    ownership: 'WindowManager owns shell windows; PanelWindows owns panel windows; BrowserViews owns WebContentsView records.',
    host: 'BrowserViews resolves BrowserWindow.fromWebContents(event.sender), records hostWin and mounts through host.contentView.',
    move: 'Renderer pane/window handoff emits layout state; browser native bounds are resynchronized after host changes.',
    destroy: 'Window/panel closed hooks and BrowserViews destroy/destroyByHost paths are authoritative; ResourceLedger observes but does not own resources.',
  },
  findings: surfaceFindings,
  workaroundRegister: workarounds,
  surfaceV1InterfaceDraft: {
    status: 'DRAFT_ONLY_NO_MIGRATION',
    methods: ['create(spec, host)', 'attach(host)', 'setBounds(rect, visible)', 'focus()', 'snapshot()', 'move(nextHost)', 'dispose(reason)'],
    events: ['ready', 'state', 'crashed', 'unresponsive', 'disposed'],
    invariants: [
      'One authoritative owner and one current host.',
      'Dispose is idempotent and returns the resource ledger to baseline.',
      'Move is observable, generation-guarded and rollback-capable.',
      'Existing workarounds remain adapter-local until packaged Windows evidence permits removal.',
    ],
  },
  decision: 'NO SurfaceManager implementation or migration is authorized by this census.',
};

function whereCommand(command) {
  const result = spawnSync('where.exe', [command], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
  if (result.error || result.status !== 0) return [];
  return String(result.stdout || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
}

function versionProbe(foundPaths) {
  const executable = foundPaths.find(value => /\.exe$/i.test(value));
  if (!executable) return { status: 'NOT_RUN', reason: foundPaths.length ? 'Only a shell wrapper was found.' : 'Executable not found.' };
  const result = spawnSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  if (result.error) return { status: 'FAILED', error: String(result.error.message || result.error).slice(0, 500) };
  return {
    status: result.status === 0 ? 'OK' : 'FAILED', exitCode: result.status,
    stdout: String(result.stdout || '').trim().slice(0, 500), stderr: String(result.stderr || '').trim().slice(0, 500),
  };
}

const agentCandidates = ['codex', 'kimi', 'claude', 'gemini'].map(id => {
  const foundPaths = whereCommand(id);
  return {
    id, foundPaths, detection: foundPaths.length ? 'FOUND' : 'NOT_FOUND', versionProbe: versionProbe(foundPaths),
    authentication: { status: 'NOT_PROBED', reason: 'Wave 0 census does not launch interactive login or read vendor credential stores.' },
    permission: { status: 'NOT_PROBED', reason: 'No real Adapter session is registered; command execution approval remains adapter-specific.' },
  };
});
const harnessSource = fs.readFileSync(path.join(root, 'main', 'agent-harness.js'), 'utf8');
const registrationMatches = harnessSource.match(/\b(?:this|registry)\.registerAdapter\s*\(/g) || [];
const agentCensus = {
  schemaVersion: 1,
  harnessContract: {
    requiredMethods: ['detect', 'probe', 'capabilities', 'createSession', 'send', 'interrupt', 'dispose', 'events'],
    registeredAdapterCount: registrationMatches.length,
    note: 'Count is static production registration and excludes tests.',
  },
  candidates: agentCandidates,
  gate: 'W66 remains PARTIAL until at least two real adapters complete detect/probe/session/send/interrupt/dispose packaged-runtime evidence.',
};

fs.mkdirSync(auditDir, { recursive: true });
fs.writeFileSync(path.join(auditDir, 'ui-census.json'), `${JSON.stringify(uiCensus, null, 2)}\n`);
fs.writeFileSync(path.join(auditDir, 'layout-debt.json'), `${JSON.stringify({
  schemaVersion: 1,
  classification: {
    A: '合理固定值', B: '合理 min/max constraint', C: '历史 magic-number workaround',
    D: 'structural layout debt', E: 'resize/sidebar/split 动态计算债',
  },
  summary: uiCensus.layout.summary, findings: layoutFindings,
  reviewState: 'PROVISIONAL_OWNER_REVIEW_REQUIRED',
}, null, 2)}\n`);
fs.writeFileSync(path.join(auditDir, 'surface-census.json'), `${JSON.stringify(surfaceCensus, null, 2)}\n`);
fs.writeFileSync(path.join(auditDir, 'agent-runtime-census.json'), `${JSON.stringify(agentCensus, null, 2)}\n`);

console.log(JSON.stringify({
  uiFiles: uiFiles.length,
  visual: uiCensus.visual.summary.totalFindings,
  icon: uiCensus.icon.summary.totalFindings,
  theme: uiCensus.theme.summary.totalFindings,
  layout: uiCensus.layout.summary.totalFindings,
  surfaces: surfaceFindings.length,
  workarounds: workarounds.length,
  agents: agentCandidates.map(x => ({ id: x.id, detection: x.detection, probe: x.versionProbe.status })),
}, null, 2));
