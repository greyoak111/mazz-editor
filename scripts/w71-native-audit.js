// scripts/w71-native-audit.js —— W71 Windows 原生二进制分类与安全 staging 计划
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const slash = value => String(value).replace(/\\/g, '/');

function walk(dir, accept = () => true) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) stack.push(full);
      else if (item.isFile() && accept(full)) out.push(full);
    }
  }
  return out.sort();
}

function packageNameOf(file) {
  const normalized = slash(file);
  const marker = '/node_modules/';
  const index = normalized.lastIndexOf(marker);
  if (index < 0) return 'unknown';
  const parts = normalized.slice(index + marker.length).split('/');
  return parts[0]?.startsWith('@') ? `${parts[0]}/${parts[1] || ''}` : parts[0] || 'unknown';
}

function classifyNative(file, { platform = 'win32', arch = 'x64' } = {}) {
  const normalized = slash(file);
  const packageName = packageNameOf(normalized);
  const prebuild = /\/prebuilds\/([^/]+)\/[^/]+\.node$/i.exec(normalized);
  if (prebuild) {
    const target = prebuild[1].toLowerCase();
    return {
      package: packageName,
      status: target === `${platform}-${arch}` ? 'target' : 'foreign',
      platformArch: target,
      reason: target === `${platform}-${arch}` ? 'exact-prebuild' : 'foreign-prebuild',
    };
  }
  if (/\/build\/Release\/[^/]+\.node$/i.test(normalized)) {
    return { package: packageName, status: 'ambiguous', platformArch: 'current-build', reason: 'generic-build-output' };
  }
  return { package: packageName, status: 'ambiguous', platformArch: 'unknown', reason: 'unclassified-path' };
}

function summarize(records) {
  const out = { count: records.length, bytes: 0, target: 0, foreign: 0, ambiguous: 0, packages: {} };
  for (const record of records) {
    out.bytes += record.bytes;
    out[record.status]++;
    const pkg = out.packages[record.package] || { count: 0, bytes: 0, target: 0, foreign: 0, ambiguous: 0 };
    pkg.count++;
    pkg.bytes += record.bytes;
    pkg[record.status]++;
    out.packages[record.package] = pkg;
  }
  return out;
}

function inventory(dir, options) {
  return walk(dir, file => file.endsWith('.node')).map(file => {
    const classification = classifyNative(file, options);
    return {
      path: slash(path.relative(ROOT, file)), bytes: fs.statSync(file).size,
      ...classification,
    };
  });
}

function auditNative({ platform = 'win32', arch = 'x64' } = {}) {
  const sourceDir = path.join(ROOT, 'node_modules');
  const packagedDir = path.join(ROOT, 'release', 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules');
  const source = inventory(sourceDir, { platform, arch });
  const packaged = inventory(packagedDir, { platform, arch });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    target: { platform, arch },
    source: { summary: summarize(source), files: source },
    packaged: { present: fs.existsSync(packagedDir), summary: summarize(packaged), files: packaged },
    stagingPlan: {
      keep: packaged.filter(row => row.status !== 'foreign').map(row => row.path),
      removeCandidate: packaged.filter(row => row.status === 'foreign').map(row => row.path),
      manualReview: packaged.filter(row => row.status === 'ambiguous').map(row => row.path),
      rule: 'Only foreign prebuild paths are automatic staging-removal candidates; generic build/Release outputs stay until ABI/runtime proof exists.',
    },
  };
}

function main() {
  const report = auditNative();
  const index = process.argv.indexOf('--out');
  if (index >= 0 && process.argv[index + 1]) {
    const target = path.resolve(ROOT, process.argv[index + 1]);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
    console.log(slash(path.relative(ROOT, target)));
    return;
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

if (require.main === module) main();

module.exports = { auditNative, classifyNative, packageNameOf, summarize, walk };
