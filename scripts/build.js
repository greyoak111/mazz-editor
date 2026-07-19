// scripts/build.js —— 渲染进程打包（esbuild：ESM 分片 + 动态导入懒加载 + Monaco workers）
'use strict';
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const watch = process.argv.includes('--watch');
const root = path.join(__dirname, '..');

async function build() {
  // 先清空 outdir：esbuild 不会自动清理旧哈希 chunk，长期累积会夹带过时代码
  const outdirPath = path.join(root, 'renderer', 'dist');
  fs.rmSync(outdirPath, { recursive: true, force: true });
  fs.mkdirSync(outdirPath, { recursive: true });

  const ctx = await esbuild.context({
    entryPoints: [
      { in: path.join(root, 'renderer', 'app.js'), out: 'app' },
      // Monaco workers（模块 Worker，主线程零负担）
      { in: require.resolve('monaco-editor/esm/vs/editor/editor.worker.js', { paths: [root] }), out: 'editor.worker' },
      { in: require.resolve('monaco-editor/esm/vs/language/typescript/ts.worker.js', { paths: [root] }), out: 'ts.worker' },
    ],
    outdir: outdirPath,
    bundle: true,
    format: 'esm',
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    platform: 'browser',
    target: ['chrome120'],
    sourcemap: true,
    logLevel: 'info',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: {
      '.css': 'text', // CSS 以文本内联（运行时 <style> 注入，免外链 404）
      '.ttf': 'file', '.woff': 'file', '.woff2': 'file',
      '.png': 'file', '.gif': 'file', '.svg': 'file',
    },
  });
  if (watch) {
    await ctx.watch();
    console.log('[build] watching…');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    // Monaco codicon 字体（CSS 文本内联后按固定名引用）
    const fs = require('fs');
    try {
      fs.copyFileSync(
        path.join(root, 'node_modules', 'monaco-editor', 'esm', 'vs', 'base', 'browser', 'ui', 'codicons', 'codicon', 'codicon.ttf'),
        path.join(root, 'renderer', 'dist', 'codicon.ttf'),
      );
    } catch {}
    console.log('[build] renderer/dist/ 打包完成（ESM 分片 + Monaco workers）');
  }
}

build().catch((e) => { console.error(e); process.exit(1); });
