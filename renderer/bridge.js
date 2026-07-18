// renderer/bridge.js —— 无感桥接引擎：9 种内置桥接的注册中心（阶段一：引擎 + 示例桥接）
// 公共能力：桥接通知条 3s 自消失、插件可注册新桥接
import { toast } from './shell/shell.js';

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

// #2 编程 → 文稿：选中代码块 → 高亮块 + 解释占位
bridges.register({
  id: 'code.toMarkdown', from: 'code', label: '选中代码 → 文稿（高亮块+解释占位）',
  async run({ text, language }) {
    if (!text?.trim()) throw new Error('无选中代码');
    const md = `## 代码片段\n\n\`\`\`${language || ''}\n${text}\n\`\`\`\n\n> 说明：（待补充）\n`;
    window.MazzHost?.openTab('markdown', { title: '代码片段.md', content: md });
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

// #5 绘画 → 文稿：当前帧 PNG 存 .mazz/assets 并插入文档光标
bridges.register({
  id: 'draw.toDoc', from: 'draw', label: '画板帧 → PNG 插入文档',
  async run({ ctl }) {
    const dataUrl = ctl?.frameToDataUrl?.();
    if (!dataUrl) throw new Error('画板未就绪');
    const ws = await window.mazz.invoke('workspace:get');
    const dir = `${ws}/.mazz/assets`;
    await window.mazz.invoke('fs:mkdir', { path: dir });
    const file = `${dir}/draw_${Date.now()}.png`;
    await window.mazz.invoke('fs:writeFileBase64', { path: file, base64: dataUrl.split(',')[1] });
    document.execCommand('insertText', false, `\n![画板](${file})\n`);
    return file;
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
      await bridges.execute('code.toMarkdown', { text, language: ctl.language });
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
        const file = await bridges.execute('draw.toDoc', { ctl: window.__activeDrawCtl });
        toast('⚡ 桥接：PNG 已插入文档（' + file.split(/[\\/]/).pop() + '）');
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
      const text = (window.getSelection()?.toString() || '').trim();
      const ctl = window.__activeLibraryCtl;
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
