// mobile/prepare.mjs —— 构建渲染层并组装 Capacitor 的 www 目录
// 用法：node prepare.mjs   （在 mobile/ 目录下执行）
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const www = path.join(here, 'www');

console.log('[1/3] 构建渲染层（esbuild）…');
const build = spawnSync('node', [path.join(root, 'scripts', 'build.js')], { stdio: 'inherit' });
if (build.status !== 0) { console.error('渲染层构建失败'); process.exit(1); }

console.log('[2/3] 清空 mobile/www …');
fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });

console.log('[3/3] 拷贝运行所需文件 …');
// index.html 引用的全部相对路径：dist/、styles/、lib/mobile-env.js
const copies = [
  ['renderer/index.html', 'index.html'],
  ['renderer/dist', 'dist'],
  ['renderer/styles', 'styles'],
  ['renderer/lib/mobile-env.js', 'lib/mobile-env.js'],
  ['renderer/vendor', 'vendor'], // ffmpeg.wasm 本地包（媒体转码；31MB，按需懒加载）
];
for (const [src, dst] of copies) {
  const from = path.join(root, src);
  const to = path.join(www, dst);
  if (!fs.existsSync(from)) { console.error('缺失：' + src); process.exit(1); }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
  console.log('  ✓', src, '→', 'www/' + dst);
}

// —— 平台工程自动修补（幂等；cap add/sync 后可反复执行）——
// Android：ws:// 局域网同步属明文流量，API 28+ 需显式允许
function fixAndroidManifest() {
  const f = path.join(here, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  if (!fs.existsSync(f)) return;
  let xml = fs.readFileSync(f, 'utf8');
  if (xml.includes('usesCleartextTraffic')) return;
  xml = xml.replace('<application ', '<application android:usesCleartextTraffic="true" ');
  fs.writeFileSync(f, xml);
  console.log('  ✓ AndroidManifest 已允许明文流量（局域网同步需要）');
}
// iOS：局域网权限说明 + 标准加密免出口合规申报
function fixIosPlist() {
  const f = path.join(here, 'ios', 'App', 'App', 'Info.plist');
  if (!fs.existsSync(f)) return;
  let xml = fs.readFileSync(f, 'utf8');
  let changed = false;
  if (!xml.includes('NSLocalNetworkUsageDescription')) {
    xml = xml.replace('</dict>\n</plist>',
      '\t<key>NSLocalNetworkUsageDescription</key>\n\t<string>用于与局域网内的电脑同步工作区文件</string>\n</dict>\n</plist>');
    changed = true;
  }
  if (!xml.includes('ITSAppUsesNonExemptEncryption')) {
    xml = xml.replace('</dict>\n</plist>',
      '\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n</dict>\n</plist>');
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(f, xml);
    console.log('  ✓ Info.plist 已补局域网权限与加密合规键');
  }
}
fixAndroidManifest();
fixIosPlist();

console.log('\n完成。Android：npx cap sync android → Android Studio 编译；iOS：npx cap sync ios → Xcode 编译');
