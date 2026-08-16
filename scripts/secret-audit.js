'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_ROOTS = ['main', 'preload', 'renderer', 'scripts', 'build'];
const ROOT_FILES = ['package.json', 'package-lock.json'];
const EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.nsh', '.yml', '.yaml']);
const EXCLUDED_PARTS = new Set(['dist', 'vendor']);
const RULES = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['openai-key', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/g],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ['hardcoded-secret', /\b(?:apiKey|api_key|password|secret|accessToken|authToken)\s*[:=]\s*['"][^'"\r\n]{8,}['"]/gi],
];

const slash = value => String(value).replace(/\\/g, '/');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.isDirectory() && EXCLUDED_PARTS.has(item.name)) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full, out);
    else if (item.isFile() && EXTENSIONS.has(path.extname(item.name).toLowerCase())) out.push(full);
  }
  return out;
}

function auditSecrets() {
  const files = [
    ...SCAN_ROOTS.flatMap(name => walk(path.join(ROOT, name))),
    ...ROOT_FILES.map(name => path.join(ROOT, name)).filter(file => fs.existsSync(file)),
  ].sort();
  const findings = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      for (const [rule, pattern] of RULES) {
        pattern.lastIndex = 0;
        if (!pattern.test(line)) continue;
        findings.push({ rule, path: slash(path.relative(ROOT, file)), line: index + 1 });
      }
    }
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: { roots: SCAN_ROOTS, rootFiles: ROOT_FILES, excludedDirectoryNames: [...EXCLUDED_PARTS], scannedFiles: files.length },
    privacy: 'Matched values are never written to the report.',
    findings,
    gate: findings.length ? 'FAIL_CURRENT_TREE_SECRET_CANDIDATES' : 'PASS_NO_CURRENT_TREE_SECRET_CANDIDATES',
    history: 'Previously revoked credentials in Git history remain a history-hygiene item and are not reprinted by this audit.',
  };
}

function main() {
  const report = auditSecrets();
  const index = process.argv.indexOf('--out');
  if (index >= 0 && process.argv[index + 1]) {
    const target = path.resolve(ROOT, process.argv[index + 1]);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
    console.log(slash(path.relative(ROOT, target)));
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
  if (report.findings.length) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { auditSecrets };
