// tests/e2e/scenes65.mjs —— W58b 实证批（解压缩工具+集成三条）
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { spawnSync } from 'child_process';

// —— 手工 GBK zip（STORE 无压缩：名字写 GBK 裸字节+UTF-8 位 11 不置——复刻国产老压缩包） ——
function crc32(buf) {
  if (zlib.crc32) return zlib.crc32(buf) >>> 0;
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  }
  c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function makeGbkZip(entries) {
  const iconv = (s) => { // GBK 编码（Node 无 iconv——汉字走 GB18030 双字节表？用 TextEncoder 不行。最小集：用预置 GBK 字节）
    const map = { '中': [0xd6, 0xd0], '文': [0xce, 0xc4], '名': [0xc3, 0xfb], '字': [0xd7, 0xd6], '压': [0xd1, 0xb9], '缩': [0xcb, 0xf5], '包': [0xb0, 0xfc], '测': [0xb2, 0xe2], '试': [0xca, 0xd4], '档': [0xb5, 0xb5], '内': [0xc4, 0xda] };
    const out = [];
    for (const ch of s) { const m = map[ch]; if (m) out.push(...m); else out.push(...Buffer.from(ch, 'utf8')); }
    return Buffer.from(out);
  };
  const parts = [], centrals = [];
  let off = 0;
  for (const [name, content] of entries) {
    const nb = iconv(name), data = Buffer.from(content, 'utf8'), crc = crc32(data);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(20, 4); lfh.writeUInt16LE(0, 6); lfh.writeUInt16LE(0, 8);
    lfh.writeUInt16LE(0, 10); lfh.writeUInt16LE(0, 12); lfh.writeUInt32LE(crc, 14); lfh.writeUInt32LE(data.length, 18);
    lfh.writeUInt32LE(data.length, 22); lfh.writeUInt16LE(nb.length, 26); lfh.writeUInt16LE(0, 28);
    parts.push(lfh, nb, data);
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); cdh.writeUInt16LE(20, 4); cdh.writeUInt16LE(20, 6); cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(0, 10); cdh.writeUInt16LE(0, 12); cdh.writeUInt16LE(0, 14); cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(data.length, 20); cdh.writeUInt32LE(data.length, 24); cdh.writeUInt16LE(nb.length, 28);
    cdh.writeUInt32LE(off, 42);
    centrals.push(Buffer.concat([cdh, nb]));
    off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, eocd]);
}

export async function scenes65({ app, win, human, WS, WS2, scenario }) {
  const wait = (ms) => win.waitForTimeout(ms);
  const evaluate = (fn, arg) => win.evaluate(fn, arg);

  // 造档：GBK zip（中文名）/ 普通 zip / 文件夹（打包料）/ 图片（拖插料）
  fs.writeFileSync(WS + '/老包.zip', makeGbkZip([['中文名测试档.txt', 'GBK 正文一'], ['压缩包内.md', '# 包内文档']]));
  const JSZip = (await import(path.resolve('node_modules/jszip/dist/jszip.min.js'))).default;
  const z = new JSZip();
  z.file('hello.txt', 'hi');
  fs.writeFileSync(WS + '/普通.zip', await z.generateAsync({ type: 'nodebuffer' }));
  fs.mkdirSync(WS + '/打包料', { recursive: true });
  fs.writeFileSync(WS + '/打包料/a.txt', '甲');
  fs.writeFileSync(WS + '/打包料/b.txt', '乙');
  fs.writeFileSync(WS + '/四色.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"><rect width="60" height="40" fill="#4a86e8"/></svg>`);

  // ==================== 1：面板列表+GBK 名修复 ====================
  await scenario('压缩包·GBK 名修复列表', async () => {
    await evaluate((p) => {
      window.mazz.invoke('panel:action', { type: 'archiveStash', path: p }).catch(() => {});
      window.mazz.invoke('panel:open', { kind: 'archive' }).catch(() => {});
    }, WS + '/老包.zip');
    await wait(2600);
    const pw = app.windows().find(w => w.url().includes('/panels/archive.html'));
    await human.assert(!!pw, '压缩包面板必须开');
    const st = await pw.evaluate(() => ({
      meta: document.getElementById('meta')?.textContent,
      rows: [...document.querySelectorAll('.row .n')].map(x => x.textContent),
      bg: getComputedStyle(document.querySelector('.pwin')).backgroundColor,
    })).catch(() => null);
    human.log('面板:', JSON.stringify(st));
    await human.assert(st && st.meta?.includes('zip'), `格式必须识别（实拿 ${st?.meta}）`);
    await human.assert(st.rows.some(x => x.includes('中文名测试档.txt')), `GBK 名必须修复（实拿 ${JSON.stringify(st.rows)}）`);
    await human.assert(st.bg && st.bg !== 'rgba(0, 0, 0, 0)', '面板必须不透明');
    human._archPanel = pw;
  });

  // ==================== 2：面板解压到子文件夹+进度+落盘 ====================
  await scenario('解压·子文件夹落盘', async () => {
    const pw = human._archPanel;
    await pw.evaluate(() => document.getElementById('b-sub')?.click());
    await wait(2500);
    const st = await evaluate(async (ws) => ({
      f1: await window.mazz.invoke('fs:readFile', { path: ws + '/老包/中文名测试档.txt' }).catch(() => null),
      f2: await window.mazz.invoke('fs:stat', { path: ws + '/老包/压缩包内.md' }).then(s => s?.size || 0).catch(() => 0),
    }), WS);
    human.log('解压落盘:', JSON.stringify(st));
    await human.assert(st.f1 === 'GBK 正文一', `GBK 名文件必须按修复名落盘（实拿 ${JSON.stringify(st)}）`);
    await human.assert(st.f2 > 0, '第二项必须落盘');
  });

  // ==================== 3：右键加项（真右键菜单实证） ====================
  await scenario('右键·压缩包菜单族', async () => {
    // 树上真右键老包.zip（preferDom 菜单——用户同路径）
    const node = await evaluate((ws) => {
      const n = [...document.querySelectorAll('.ft-node')].find(x => (x.dataset.path || '').endsWith('老包.zip'));
      if (!n) return false;
      const r = n.getBoundingClientRect();
      n.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 40, clientY: r.y + 4 }));
      return true;
    }, WS);
    await human.assert(node, '老包.zip 树节点必须在');
    await wait(1400);
    // Electron 强制 ctxmenu 子窗格（preferDom 已废——W56 定版）——菜单在面板窗不在主窗
    const ctx = app.windows().find(w => w.url().includes('/panels/ctxmenu.html'));
    await human.assert(!!ctx, '右键必须开 ctxmenu 子窗格');
    const items = await ctx.evaluate(() => [...document.querySelectorAll('.mi .t, .mi')].map(x => x.textContent.trim()).filter(Boolean));
    human.log('右键菜单:', JSON.stringify(items));
    await human.assert(items.some(t => t.includes('查看压缩包内容')), `查看项必须在（实拿 ${JSON.stringify(items)}）`);
    await human.assert(items.some(t => t.includes('解压缩到此处')) && items.some(t => t.includes('子文件夹')), `解压两项必须在`);
    await human.assert(items.some(t => t.includes('压缩为 zip')), `打包项必须在`);
    await win.keyboard.press('Escape');
    await wait(400);
  });

  // ==================== 4：压缩打包（文件夹→zip） ====================
  await scenario('打包·文件夹成 zip', async () => {
    const r = await evaluate(async (ws) => await window.mazz.invoke('archive:pack', { sources: [ws + '/打包料'], out: ws + '/打包料.zip' }).catch(e => ({ error: e.message })), WS);
    human.log('打包回执:', JSON.stringify(r));
    await human.assert(r?.jobId, '打包必须入队');
    await wait(2200);
    const st = await evaluate(async (ws) => await window.mazz.invoke('fs:stat', { path: ws + '/打包料.zip' }).then(s => s?.size || 0).catch(() => 0), WS);
    await human.assert(st > 100, `zip 必须落盘（实拿 ${st}B）`);
    const lst = await evaluate(async (ws) => await window.mazz.invoke('archive:list', { path: ws + '/打包料.zip' }).catch(() => null), WS);
    await human.assert(lst && lst.entries?.length >= 2, `包内必须双件（实拿 ${lst?.entries?.length}）`);
  });

  // ==================== 5：树拖即开 ====================
  await scenario('树拖即开·落格直开', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.closeTab')).catch(() => {});
    await wait(400);
    await evaluate((p) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', p);
      const panes = document.querySelector('.panes');
      panes.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      panes.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, WS + '/四色.svg');
    await wait(2200);
    const st = await evaluate(() => ({
      mod: window.MazzShell?.paneTree?.tabs?.active?.moduleId,
      title: window.MazzShell?.paneTree?.tabs?.active?.title,
    }));
    human.log('拖开:', JSON.stringify(st));
    await human.assert(st.mod === 'viewer' && (st.title || '').includes('四色'), `拖开必须直开查看器（实拿 ${JSON.stringify(st)}）`);
  });

  // ==================== 6：树拖图即插 ====================
  await scenario('树拖图即插·图片落档', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.new'));
    await wait(1800);
    await evaluate((p) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', p);
      const panes = document.querySelector('.panes');
      const pm = document.querySelector('.ProseMirror');
      const r = (pm || panes).getBoundingClientRect();
      panes.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.x + 200, clientY: r.y + 100 }));
      panes.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.x + 200, clientY: r.y + 100 }));
    }, WS + '/四色.svg');
    await wait(1500);
    const st = await evaluate(() => {
      const img = document.querySelector('.ProseMirror img');
      return { has: !!img, src: (img?.src || '').slice(0, 40) };
    });
    human.log('插图:', JSON.stringify(st));
    await human.assert(st.has && st.src.includes('mazz-res'), `图片必须插进文档（实拿 ${JSON.stringify(st)}）`);
    // 插图后文档已脏——先标净再关（脏签关=弹保存闸挂死实锤）
    await evaluate(() => {
      const t = window.MazzShell?.paneTree?.tabs?.active;
      if (t) window.MazzShell?.tabs.setDirty(t.id, false);
    });
    await evaluate(() => window.MazzCommands?.execute('file.closeTab')).catch(() => {});
    await wait(300);
  });

  // ==================== 7：7z 兜底（7za 引擎） ====================
  await scenario('7z·7za 兜底列表', async () => {
    const seven = path.resolve('node_modules/7zip-bin/linux/x64/7za');
    try { fs.chmodSync(seven, 0o755); } catch {} // 挂载丢执行位（沙箱实锤）
    fs.writeFileSync('/tmp/z7src.txt', '7z 内容');
    const r = spawnSync(seven, ['a', '-y', WS + '/兜底.7z', '/tmp/z7src.txt'], { timeout: 15000 });
    human.log('7za 造包:', r.status);
    await human.assert(fs.existsSync(WS + '/兜底.7z'), '7z 包必须造出');
    const lst = await evaluate(async (ws) => await window.mazz.invoke('archive:list', { path: ws + '/兜底.7z' }).catch(e => ({ error: e.message })), WS);
    human.log('7z 列表:', JSON.stringify(lst?.engine), '项数', lst?.entries?.length);
    await human.assert(lst && !lst.error && lst.engine === '7za', `7z 必须走 7za 兜底（实拿 ${JSON.stringify(lst?.engine || lst?.error)}）`);
    await human.assert(lst.entries.length >= 1, '7z 必须列出项');
  });

  // ==================== 8：取消令牌（排队确定性） ====================
  await scenario('作业·取消即停', async () => {
    // 三连发：前两个占满 2 并发，第三个必排队——取消排队件=确定性（小 zip 秒完取消赛跑实锤）
    const rs = await evaluate(async (ws) => {
      const out = [];
      for (let i = 1; i <= 3; i++) out.push(await window.mazz.invoke('archive:extract', { path: ws + '/老包.zip', dest: ws + '/取消档' + i }));
      return out;
    }, WS);
    human.log('三连发:', JSON.stringify(rs));
    await human.assert(rs.every(r => r?.jobId), '三作业必须全入队');
    // 找排队中的（或任一仍挂着的）取消
    const c = await evaluate(async (ids) => {
      for (const id of [...ids].reverse()) {
        const r = await window.mazz.invoke('archive:cancel', { jobId: id });
        if (r?.ok) return { ok: true, id };
      }
      return { ok: false };
    }, rs.map(r => r.jobId));
    human.log('取消回执:', JSON.stringify(c));
    await human.assert(c.ok === true, '排队/在途作业取消必须受理');
  });
}
