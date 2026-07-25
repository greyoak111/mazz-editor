// renderer/bridge.js —— 无感桥接引擎：9 种内置桥接的注册中心（阶段一：引擎 + 示例桥接）
// 公共能力：桥接通知条 3s 自消失、插件可注册新桥接
import { toast, modal } from './shell/shell.js';
import { bus } from './core/events.js';

// ==================== 桥接目标文件（桥接/ 文件夹 + 同窗更新 + 自选文件名） ====================
// 规则：首次桥接弹出目标选择（自动新建到 桥接/、选工作区已有同类型文件、或自定新名）；
// 之后同一窗格的桥接内容全部更新到该文件，直到窗格关闭
const bridgeTargets = new Map(); // `${tabId}:${ext}` -> path
bus.on('tab:requestClose', (id) => {
  for (const k of [...bridgeTargets.keys()]) if (k.startsWith(id + ':')) bridgeTargets.delete(k);
});

async function listWsFilesByExt(ext) {
  const out = [];
  const walk = async (dir, depth) => {
    if (depth > 3) return;
    const entries = await window.mazz.invoke('fs:listDir', { path: dir }).catch(() => []);
    for (const e of entries) {
      if (e.isDir) {
        if (e.name.startsWith('.')) continue;
        await walk(e.path, depth + 1);
      } else if (e.name.toLowerCase().endsWith(ext)) out.push(e.path);
    }
  };
  const ws = await window.mazz.invoke('workspace:get');
  await walk(ws, 0);
  return out;
}

/** 首次桥接的目标选择器：自动新建 / 选已有文件 / 自定新名 */
async function pickBridgeTarget(tabId, ext, defaultName) {
  const key = `${tabId}:${ext}`;
  if (bridgeTargets.has(key)) return bridgeTargets.get(key);
  const ws = await window.mazz.invoke('workspace:get');
  const existing = await listWsFilesByExt(ext);
  return new Promise((resolve) => {
    const m = modal('桥接目标文件');
    m.body.innerHTML = `
      <div style="min-width:420px;max-width:560px">
        <div style="font-size:12.5px;color:#83817a;margin-bottom:10px">本窗格后续桥接内容将持续更新到同一文件（关闭窗格后失效）。选择目标：</div>
        <div class="bt-opt" data-v="__auto__" style="padding:9px 12px;border:1px solid var(--acc,#4f46e5);border-radius:8px;margin-bottom:8px;cursor:pointer;background:color-mix(in srgb, var(--acc,#4f46e5) 6%, transparent)">
          ✨ 自动新建到「桥接/」（推荐）：桥接/${defaultName}${ext}</div>
        ${existing.slice(0, 12).map(f => `
          <div class="bt-opt" data-v="${f}" style="padding:8px 12px;border:1px solid var(--bd,#e0ded8);border-radius:8px;margin-bottom:6px;cursor:pointer;font-size:12.5px">📄 ${f.replace(ws + '/', '')}</div>`).join('')}
        <div style="display:flex;gap:6px;margin-top:10px">
          <input id="bt-name" class="rb-input" style="flex:1" placeholder="或自定新文件名（不含后缀）" spellcheck="false">
          <button id="bt-new" class="rb-btn" style="flex-direction:row">新建到 桥接/</button>
        </div>
      </div>`;
    m.body.querySelectorAll('.bt-opt').forEach(el => el.addEventListener('click', () => {
      const v = el.dataset.v;
      m.close();
      const path = v === '__auto__' ? `${ws}/桥接/${defaultName}${ext}` : v;
      bridgeTargets.set(key, path);
      resolve(path);
    }));
    m.body.querySelector('#bt-new').addEventListener('click', () => {
      const name = (m.body.querySelector('#bt-name').value.trim() || defaultName).replace(/[\\/:*?"<>|]/g, '-');
      m.close();
      const path = `${ws}/桥接/${name}${ext}`;
      bridgeTargets.set(key, path);
      resolve(path);
    });
    m.el.addEventListener('mousedown', (e) => { if (e.target === m.el) resolve(null); }, true);
  });
}

/** 桥接目标文件：合并式更新（不是覆盖）——已有内容保留，新内容接续其后 */
async function upsertBridgeFile(tabId, ext, defaultName, content) {
  const path = await pickBridgeTarget(tabId, ext, defaultName);
  if (!path) return null;
  await window.mazz.invoke('fs:mkdir', { path: path.split('/').slice(0, -1).join('/') }).catch(() => {});
  let merged = content;
  try {
    const old = await window.mazz.invoke('fs:readFile', { path }).catch(() => '');
    if (old?.trim()) {
      if (ext === '.mazzslide') {
        // 演示大纲：新页续在末尾（--- 分页）
        merged = old.replace(/\s*$/, '') + '\n---\n' + content.replace(/^\s+/, '');
      } else {
        // Markdown：分隔线续接
        merged = old.replace(/\s*$/, '') + '\n\n---\n\n' + content.replace(/^\s+/, '');
      }
    }
  } catch {}
  await window.mazz.invoke('fs:writeFile', { path, content: merged });
  // 打开目标窗格必须带上合并后的内容（只给 filePath 模块会用默认空内容，桥接了个寂寞）
  window.MazzHost?.openTab(ext === '.mazzslide' ? 'slide' : 'markdown', { title: path.split('/').pop(), filePath: path, content: merged });
  return path;
}

class BridgeEngine {
  constructor() {
    this.bridges = []; // {id, from, to, label, run(ctx), source}
  }
  register(bridge) {
    if (!bridge?.id || typeof bridge.run !== 'function') {
      console.warn('[bridge] 非法桥接:', bridge);
      return false;
    }
    if (this.bridges.find(b => b.id === bridge.id)) return false;
    this.bridges.push(bridge);
    return true;
  }
  listFor(fromModule) {
    return this.bridges.filter(b => !b.from || b.from === fromModule);
  }
  async execute(id, ctx) {
    const b = this.bridges.find(b => b.id === id);
    if (!b) throw new Error(`桥接不存在: ${id}`);
    try {
      const r = await b.run(ctx);
      this.notify(`${b.label || b.id} 完成`);
      return r;
    } catch (e) {
      console.error('[bridge]', id, e);
      this.notify(`${b.label || b.id} 失败：${e.message}`, true);
      throw e;
    }
  }
  /** 桥接通知条 3s 自消失 */
  notify(msg, isError = false) {
    toast((isError ? '⚠ ' : '⚡ 桥接：') + msg, [], isError ? 5000 : 3000);
  }
}

export const bridges = new BridgeEngine();
window.MazzBridges = bridges;

// —— 示例桥接（验证引擎可插拔；9 种内置桥接随对应模块阶段落地）——
// 选中文本 → 快速笔记（每日笔记）
bridges.register({
  id: 'selection.toQuickNote', from: 'markdown', label: '选中文本 → 快速笔记',
  async run({ text }) {
    if (!text) throw new Error('无选中文本');
    if (window.mazz?.isElectron) await window.mazz.invoke('quicknote:save', { text });
  },
});
// 选中文本 → 新建纯文本标签
bridges.register({
  id: 'selection.toPlainText', from: 'markdown', label: '选中文本 → 纯文本',
  async run({ text, openTextTab }) {
    if (!text) throw new Error('无选中文本');
    await openTextTab(text);
  },
});

// ==================== 桥接一期（计划书 #1/#2/#4） ====================
// #1 表格 → 编程：选区导临时 CSV → pandas 模板代码
bridges.register({
  id: 'sheet.toPandas', from: 'sheet', label: '选区 → pandas DataFrame',
  async run({ ctl }) {
    const sel = ctl.grid.sel;
    const rows = [];
    for (let r = sel.r1; r <= sel.r2; r++) {
      const line = [];
      for (let c = sel.c1; c <= sel.c2; c++) {
        const v = ctl.sheet.computed(r, c);
        line.push(v == null ? '' : String(v).replace(/"/g, '""'));
      }
      rows.push(line);
    }
    const csv = rows.map(r => r.map(v => /[",\n]/.test(v) ? `"${v}"` : v).join(',')).join('\n');
    const ws = await window.mazz.invoke('workspace:get');
    const dir = `${ws}/.mazz/temp`;
    await window.mazz.invoke('fs:mkdir', { path: dir });
    const file = `${dir}/bridge_${Date.now()}.csv`;
    await window.mazz.invoke('fs:writeFile', { path: file, content: csv });
    const code = `# 桥接 #1：表格 → pandas（临时 CSV 24h 自动清理）
import pandas as pd

df = pd.read_csv(r'${file}')
print(df.head())
print(df.describe())
`;
    window.MazzHost?.openTab('code', { title: 'pandas_bridge.py', content: code });
  },
});

// #2 编程 → 文稿：选中代码块 → 高亮块 + 解释占位（桥接目标：桥接/ 统一文件）
bridges.register({
  id: 'code.toMarkdown', from: 'code', label: '选中代码 → 文稿（高亮块+解释占位）',
  async run({ text, language, sourceTabId }) {
    if (!text?.trim()) throw new Error('无选中代码');
    const md = `## 代码片段\n\n\`\`\`${language || ''}\n${text}\n\`\`\`\n\n> 说明：（待补充）\n`;
    return upsertBridgeFile(sourceTabId, '.md', '代码片段', md);
  },
});

// #4 编程 → 表格：终端输出表格 → 表格模块临时文件
bridges.register({
  id: 'terminal.toSheet', from: 'code', label: '终端输出 → 表格',
  async run({ lines }) {
    const parsed = parseTableLines(lines);
    if (parsed.length < 2) throw new Error('未识别到表格结构（需要 ≥2 行对齐文本）');
    const csv = parsed.map(r => r.map(v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(',')).join('\n');
    window.MazzHost?.openTab('sheet', { title: '终端输出.mazzsheet', content: csv });
  },
});

function parseTableLines(lines) {
  // 尝试多种分隔：| 竖线 / 双空格 / 制表符 / 逗号
  const candidates = [
    (l) => l.split('|').map(s => s.trim()).filter(s => s !== ''),
    (l) => l.split(/\s{2,}/).map(s => s.trim()),
    (l) => l.split('\t').map(s => s.trim()),
    (l) => l.split(',').map(s => s.trim()),
  ];
  for (const split of candidates) {
    const parsed = lines.map(split).filter(r => r.length >= 2);
    if (parsed.length >= 2 && parsed.every(r => r.length === parsed[0].length)) {
      // 去掉分隔行（--- 样式）
      return parsed.filter(r => !r.every(c => /^[-:+\s]+$/.test(c)));
    }
  }
  return [];
}

// ==================== 桥接二期（计划书 #3/#5/#6/#7） ====================
// #3 文稿 → PPT：后台直接编译 pptx（默认主题），产物落 .mazz/temp
bridges.register({
  id: 'md.toPptx', from: 'markdown', label: '文稿 → 后台编译 PPTX',
  async run({ markdown, title }) {
    const { parseOutline, markdownToOutline } = await import('./modules/slide/outline.js');
    const { exportPptx } = await import('./modules/slide/pptx.js');
    const { SLIDE_THEMES } = await import('./modules/slide/themes.js');
    const outline = markdownToOutline(markdown);
    const slides = parseOutline(outline);
    if (!slides.length || !slides.some(s => s.title)) throw new Error('文档缺少标题结构（# / ##），无法编译');
    const buf = await exportPptx(slides, SLIDE_THEMES[0]);
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const ws = await window.mazz.invoke('workspace:get');
    const dir = `${ws}/.mazz/temp`;
    await window.mazz.invoke('fs:mkdir', { path: dir });
    const file = `${dir}/${(title || '演示文稿').replace(/[\\/:*?"<>|]/g, '-')}.pptx`;
    await window.mazz.invoke('fs:writeFileBase64', { path: file, base64: btoa(bin) });
    return file;
  },
});

// #5 绘画 → 文稿：当前帧 PNG 插入桥接文档（桥接/ 统一文件）
bridges.register({
  id: 'draw.toDoc', from: 'draw', label: '画板帧 → PNG 插入文档',
  async run({ ctl, sourceTabId }) {
    const dataUrl = ctl?.frameToDataUrl?.();
    if (!dataUrl) throw new Error('画板未就绪');
    const ws = await window.mazz.invoke('workspace:get');
    const dir = `${ws}/.mazz/assets`;
    await window.mazz.invoke('fs:mkdir', { path: dir });
    const file = `${dir}/draw_${Date.now()}.png`;
    await window.mazz.invoke('fs:writeFileBase64', { path: file, base64: dataUrl.split(',')[1] });
    const md = `# 画板插图\n\n![画板](${file})\n`;
    return upsertBridgeFile(sourceTabId, '.md', '画板插图', md);
  },
});

// #6.6 导图 → 文稿/演示：整图 PNG 无缝流转
bridges.register({
  id: 'mm.toDoc', from: 'mindmap', label: '导图 → PNG 插入文稿',
  async run({ ctl, sourceTabId }) {
    const dataUrl = await ctl.renderToDataUrl();
    const ws = await window.mazz.invoke('workspace:get');
    const dir = `${ws}/.mazz/assets`;
    await window.mazz.invoke('fs:mkdir', { path: dir });
    const file = `${dir}/mm_${Date.now()}.png`;
    await window.mazz.invoke('fs:writeFileBase64', { path: file, base64: dataUrl.split(',')[1] });
    const md = `# 思维导图\n\n![导图](${file})\n`;
    return upsertBridgeFile(sourceTabId, '.md', '思维导图', md);
  },
});
bridges.register({
  id: 'mm.toSlide', from: 'mindmap', label: '导图 → PNG 插入演示页',
  async run({ ctl, sourceTabId }) {
    const dataUrl = await ctl.renderToDataUrl();
    const elements = [{ type: 'image', src: dataUrl, x: 12, y: 12, w: 76, h: 76 }];
    const content = `# 思维导图\n<!--canvas:${JSON.stringify(elements)}-->\n`;
    return upsertBridgeFile(sourceTabId, '.mazzslide', '思维导图', content);
  },
});

// #6.5 绘画 → 演示：当前帧 PNG 直接插入演示页画布
bridges.register({
  id: 'draw.toSlide', from: 'draw', label: '画板帧 → 插入演示页',
  async run({ ctl, sourceTabId }) {
    const dataUrl = ctl?.frameToDataUrl?.();
    if (!dataUrl) throw new Error('画板未就绪');
    const elements = [{ type: 'image', src: dataUrl, x: 15, y: 15, w: 70, h: 70 }];
    const content = `# 画板插图\n<!--canvas:${JSON.stringify(elements)}-->\n`;
    return upsertBridgeFile(sourceTabId, '.mazzslide', '画板插图', content);
  },
});

// #6 文稿 → 绘画：选中场景描述 → 画板参考栏
bridges.register({
  id: 'md.toDraw', from: 'markdown', label: '文稿场景 → 画板参考栏',
  async run({ text }) {
    if (!text?.trim()) throw new Error('先选中一段场景/分镜描述');
    window.__pendingDrawReference = text.trim();
    window.MazzHost?.openTab('draw', { title: '分镜.mazzdraw', content: '' });
  },
});

// #7 书库 → 笔记：摘录 + 源书名 + 位置 → 书摘笔记
bridges.register({
  id: 'lib.toNote', from: 'library', label: '书摘 → 笔记',
  async run({ text, book, where }) {
    if (!text?.trim()) throw new Error('没有选中文本');
    const ws = await window.mazz.invoke('workspace:get');
    const dir = `${ws}/书摘`;
    await window.mazz.invoke('fs:mkdir', { path: dir });
    const file = `${dir}/${String(book || '未命名').replace(/[\\/:*?"<>|]/g, '-')}.md`;
    let old = '';
    try { old = (await window.mazz.invoke('fs:readFile', { path: file })) || ''; } catch {}
    const head = old.trim() ? old.replace(/\s*$/, '\n\n') : `# 《${book}》书摘\n\n`;
    const entry = `> ${text.trim().replace(/\n+/g, '\n> ')}\n\n—— 《${book}》${where ? ' · ' + where : ''} · ${new Date().toLocaleString('zh-CN')}\n\n`;
    await window.mazz.invoke('fs:writeFile', { path: file, content: head + entry });
    window.MazzNotes?.invalidate?.();
    // 桥接原则：完成即打开目标模块窗格（带内容）
    window.MazzHost?.openTab('markdown', { title: file.split('/').pop(), filePath: file, content: head + entry });
    return file;
  },
});

// —— 桥接命令注册（外壳启动后调用）——
export function registerBridgeCommands(MazzCommands) {
  MazzCommands.register('bridge.sheetToPandas', {
    title: '选区送 Python（pandas）', icon: '🐍', group: '桥接', when: "module=='sheet'",
    run: () => bridges.execute('sheet.toPandas', { ctl: window.__activeSheetCtl }),
  });
  MazzCommands.register('bridge.codeToMarkdown', {
    title: '选中代码发文稿', icon: '📄', group: '桥接', when: "module=='code'",
    run: async () => {
      const ctl = window.__activeCodeCtl;
      if (!ctl?.editor) return;
      const sel = ctl.editor.getSelection();
      const text = sel.isEmpty() ? '' : ctl.editor.getModel().getValueInRange(sel);
      await bridges.execute('code.toMarkdown', { text, language: ctl.language, sourceTabId: window.MazzShell?.tabs?.activeId });
    },
  });
  MazzCommands.register('bridge.terminalToSheet', {
    title: '终端输出转表格', icon: '📊', group: '桥接', when: "module=='code'",
    run: async () => {
      const ctl = window.__activeCodeCtl;
      if (!ctl?.terminal?.activeId) { toast('请先打开终端'); return; }
      const rec = ctl.terminal.terms.get(ctl.terminal.activeId);
      if (!rec) return;
      const buf = rec.xterm.buffer.active;
      const lines = [];
      const start = Math.max(0, buf.length - 60);
      for (let i = start; i < buf.length; i++) {
        const t = buf.getLine(i)?.translateToString(true).trimEnd();
        if (t && !/^\s*[$#>❯]/.test(t)) lines.push(t);
      }
      await bridges.execute('terminal.toSheet', { lines: lines.slice(-40) });
    },
  });

  // —— 二期命令（#3/#5/#6/#7） ——
  const activeInst = (name) => {
    const tabId = window.MazzShell?.tabs?.activeId;
    const inst = tabId && window.MazzModules?.instances?.get(tabId);
    return inst?.name === name ? inst : null;
  };
  MazzCommands.register('bridge.mdToPptx', {
    title: '后台编译为 PPTX（文稿 → 演示）', icon: '📽', group: '桥接', when: "module=='markdown'",
    run: async () => {
      const inst = activeInst('markdown');
      if (!inst) return;
      toast('正在后台编译 pptx…');
      try {
        const file = await bridges.execute('md.toPptx', {
          markdown: inst.def.getContent(inst.state),
          title: (inst.state.title || '演示文稿').replace(/\.(md|markdown)$/i, ''),
        });
        toast(`⚡ 桥接：pptx 已就绪 ${file.split(/[\\/]/).pop()}`);
        window.mazz.invoke('shell:showItemInFolder', { path: file });
      } catch (e) { toast('编译失败：' + e.message); }
    },
  });
  MazzCommands.register('bridge.drawToDoc', {
    title: '画板帧插入文档（绘画 → 文稿）', icon: '🖼', group: '桥接', when: "module=='draw'",
    run: async () => {
      try {
        const file = await bridges.execute('draw.toDoc', { ctl: window.__activeDrawCtl, sourceTabId: window.MazzShell?.tabs?.activeId });
        toast('⚡ 桥接：PNG 已插入文档（' + file.split(/[\\/]/).pop() + '）');
      } catch (e) { toast(e.message); }
    },
  });
  MazzCommands.register('bridge.mmToDoc', {
    title: '导图转 PNG 插入文稿（导图 → 文稿）', icon: '📝', group: '桥接', when: "module=='mindmap'",
    run: async () => {
      const ctl = window.__activeMindmapCtl;
      if (!ctl) return;
      try { await bridges.execute('mm.toDoc', { ctl, sourceTabId: window.MazzShell?.tabs?.activeId }); } catch (e) { toast(e.message); }
    },
  });
  MazzCommands.register('bridge.mmToSlide', {
    title: '导图转 PNG 插入演示页（导图 → 演示）', icon: '📽', group: '桥接', when: "module=='mindmap'",
    run: async () => {
      const ctl = window.__activeMindmapCtl;
      if (!ctl) return;
      try { await bridges.execute('mm.toSlide', { ctl, sourceTabId: window.MazzShell?.tabs?.activeId }); } catch (e) { toast(e.message); }
    },
  });
  MazzCommands.register('bridge.drawToSlide', {
    title: '画板帧插入演示页（绘画 → 演示）', icon: '📽', group: '桥接', when: "module=='draw'",
    run: async () => {
      try {
        await bridges.execute('draw.toSlide', { ctl: window.__activeDrawCtl, sourceTabId: window.MazzShell?.tabs?.activeId });
      } catch (e) { toast(e.message); }
    },
  });
  MazzCommands.register('bridge.mdToDraw', {
    title: '场景描述送画板（文稿 → 绘画）', icon: '🎨', group: '桥接', when: "module=='markdown'",
    run: async () => {
      const text = (window.getSelection()?.toString() || '').trim();
      try { await bridges.execute('md.toDraw', { text }); }
      catch (e) { toast(e.message); }
    },
  });
  MazzCommands.register('bridge.libToNote', {
    title: '摘录到书摘笔记（书库 → 笔记）', icon: '✍', group: '桥接', when: "module=='library'",
    run: async () => {
      // 选区三级真源：实时 selection → clip 按钮捕获的 __libClipText → library 模块缓存 _lastSel
      // （点按钮/菜单必然折叠选区，只读实时 selection 必空=「无法摘录」总根）
      const ctl = window.__activeLibraryCtl;
      const text = (window.getSelection()?.toString() || '').trim() || window.__libClipText || ctl?._lastSel || '';
      try {
        const file = await bridges.execute('lib.toNote', {
          text,
          book: ctl?.book?.meta?.title || '未命名',
          where: ctl?.book?.meta?.format === 'epub' ? `第 ${ctl.chapterIdx + 1} 章` : `第 ${ctl?.pageIdx + 1} 页`,
        });
        toast('⚡ 桥接：已摘录到 ' + file.split(/[\\/]/).pop());
      } catch (e) { toast(e.message); }
    },
  });
}
