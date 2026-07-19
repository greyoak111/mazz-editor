#!/bin/bash
# scripts/package-windows.sh —— Windows 三架构安装包一条龙：恢复环境→解包→打包→分卷→慢拷交付区
# 用法：bash scripts/package-windows.sh
set -e
ROOT=/tmp/mazz-build
WORK=/mnt/agents/work/mazz-editor
OUT=/mnt/agents/output/安装包

echo "=== 1/6 恢复源码到 /tmp ==="
rsync -a "$WORK/" "$ROOT/"
cd "$ROOT"

echo "=== 2/6 安装依赖并构建渲染层 ==="
npm install --no-audit --no-fund 2>&1 | tail -1
node scripts/build.js 2>&1 | tail -1
node scripts/build-sample-plugins.js

echo "=== 3/6 三架构解包 ==="
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
for a in x64 ia32 arm64; do
  npx electron-builder --win --$a --dir 2>&1 | grep -c "updating asar" && echo "  $a unpacked"
done

echo "=== 4/6 准备 makensis ==="
rm -rf /tmp/nsis
cp -r /mnt/agents/work/nsis-3.0.4.1 /tmp/nsis
chmod +x /tmp/nsis/linux/makensis
export NSISDIR=/tmp/nsis

echo "=== 5/6 打安装包 ==="
cd /tmp/nsis
for A in "win-unpacked x64" "win-ia32-unpacked x86" "win-arm64-unpacked arm64"; do
  set -- $A
  ./linux/makensis -DAPP_DIR="$ROOT/release/$1" -DOUT_FILE="/tmp/MazzEditor-Setup-$2.exe" -DARCH=$2 "$WORK/scripts/installer.nsi" > /tmp/nsis-$2.log 2>&1
  echo "  $2 OK ($(stat -c%s /tmp/MazzEditor-Setup-$2.exe) bytes)"
done

echo "=== 6/6 分卷并慢拷交付区 ==="
mkdir -p "$OUT"
rm -f "$OUT"/MazzEditor-Setup-* "$OUT"/校验-md5.txt 2>/dev/null || true
cd /tmp
for n in x64 x86 arm64; do
  split -b 40m -d "MazzEditor-Setup-$n.exe" "vol-$n.part"
done
python3 - << 'PYEOF'
import os, time, hashlib
out = '/mnt/agents/output/安装包'
os.makedirs(out, exist_ok=True)
for f in sorted(os.listdir('/tmp')):
    if not f.startswith('vol-'): continue
    arch = f.split('-')[1].split('.')[0]
    suffix = f.split('.')[1]
    src = os.path.join('/tmp', f)
    dst = os.path.join(out, f'MazzEditor-Setup-{arch}.exe.{suffix}')
    for attempt in range(4):
        try:
            with open(src, 'rb') as fi, open(dst, 'wb') as fo:
                while True:
                    b = fi.read(8*1024*1024)
                    if not b: break
                    fo.write(b); fo.flush()
            break
        except OSError:
            time.sleep(4)
    else:
        raise SystemExit(f'拷贝失败: {dst}')
    time.sleep(1.2)
    print('  OK', os.path.basename(dst), os.path.getsize(dst))
md5s = {}
for exe in ['x64', 'x86', 'arm64']:
    md5s[exe] = hashlib.md5(open(f'/tmp/MazzEditor-Setup-{exe}.exe', 'rb').read()).hexdigest()
with open(os.path.join(out, '校验-md5.txt'), 'w') as f:
    for k, v in md5s.items():
        f.write(f'{v}  MazzEditor-Setup-{k}.exe\n')
print('MD5:', md5s)
PYEOF
echo "=== 全部完成 ==="
ls -la "$OUT"
