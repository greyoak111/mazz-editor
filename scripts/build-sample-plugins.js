// scripts/build-sample-plugins.js —— 把 plugins-samples/ 打成 samples/*.maz（zip：plugin.json + main.js）
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'plugins-samples');
const outDir = path.join(root, 'samples');

async function main() {
  const JSZip = require('jszip');
  fs.mkdirSync(outDir, { recursive: true });
  const names = fs.readdirSync(srcDir).filter(n => fs.statSync(path.join(srcDir, n)).isDirectory());
  for (const name of names) {
    const dir = path.join(srcDir, name);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
    const zip = new JSZip();
    zip.file('plugin.json', JSON.stringify(manifest, null, 2));
    zip.file(manifest.main || 'main.js', fs.readFileSync(path.join(dir, manifest.main || 'main.js'), 'utf8'));
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const out = path.join(outDir, `${name}.maz`);
    fs.writeFileSync(out, buf);
    console.log(`[samples] ${name}.maz (${buf.length}B)`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
