// renderer/modules/factory/index.js —— 智能创作（Mazz Factory）：AI 内容生产中枢
// 任务队列中心（原版 PySide 思路）：创作模板 → 需求澄清 → 任务队列 → 主控台日志 → 连写快照/断点续写
import { toast, modal, inputModal } from '../../shell/shell.js';
import { menus } from '../../core/menu-service.js';
import { listGenres, saveCustomGenre, buildMantra, runQualityChecks, parseCsvTasks, fieldValue, buildChapterPrompt, buildStateSummaryPrompt, readMaxTaskProgress, renderPluginPrompt, buildEmbedBlocks, buildNovelBlueprintPrompt, blueprintStructureOk, parseChapterOutlines, extractBlueprintCore, extractWritingDirective, stripMdFence, buildChapterPromptV2, writeTaskState, scanResumableTasks, dedupMerge } from './engine.js';
import { getProviderConfig, saveProviderConfig, providerReady, chat, chatStream, extractFields, PRESETS } from './provider.js';
import { NOVEL_PLUGINS } from './plugins.js';
import { listStyles, uploadStyleFile, queryOnlineStyle, deleteStyle, assembleStylePackage } from './style-studio.js';
import { exportMaz, importMaz } from './maz.js';
import { iconHtml } from '../../lib/svg-icons.js';

const TASKS_KEY = 'mazz.factory.tasks';
const HISTORY_KEY = 'mazz.factory.history';
const FMT_EXTS = { md: 'md', txt: 'txt', html: 'html', docx: 'docx', epub: 'epub', odt: 'odt', rtf: 'rtf' };

export class FactoryPanel {
  constructor(root, { shell }) {
    this.shell = shell;
    this.el = root;
    this.el.classList.add('factory-root');
    this.genres = [];
    this.genre = null;
    this.values = {};
    this.tasks = this.loadJSON(TASKS_KEY, []);
    this.history = this.loadJSON(HISTORY_KEY, []);
    this.running = false;
    this.stopRequested = false;
    this.cfg = null;
    this.pluginSel = new Set();   // 勾选的创作插件 id
    this.pluginValues = {};       // {pluginId: {fieldId: value}}
    this.styleIds = new Set();    // 勾选的文风素材 id
    this.styles = [];             // 全部文风素材
    this.embeds = [];             // 嵌入资料 [{name, text, note}]
    this.resumables = [];         // 启动扫描到的可恢复任务
    this.render();
    this.reload();
  }

  loadJSON(k, dft) { try { return JSON.parse(localStorage.getItem(k)) ?? dft; } catch { return dft; } }

  // ==================== W53 坞浮动状态镜像（dockfloat 子窗格=远程视图，本实例是真相源） ====================
  snapshot() {
    return {
      genres: (this.genres || []).map(g => ({ id: g.id, name: g.name, custom: !!g.custom, description: g.description || '' })),
      genreId: this.genre?.id || '',
      fields: (this.genre?.input_fields || []).map(f => ({ id: f.id, label: f.label, type: f.type, required: !!f.required, placeholder: f.placeholder || '', default: f.default ?? '', options: f.options || null })),
      values: { ...(this.values || {}) },
      genreDesc: this.genre?.description || '',
      providerConfigured: providerReady(this.cfg),
      providerHint: providerReady(this.cfg) ? `● ${this.cfg.model} 已就绪` : '未配置 AI 服务（主窗坞齿轮配置；不配也能「复制模板母版」去别的 AI 用）',
      dump: this.el.querySelector('.fc-dump-text')?.value || '',
      dualLoop: !!this.el.querySelector('.fc-dualloop')?.checked,
      maxMode: !!this.el.querySelector('.fc-maxmode')?.checked,
      maxChapters: +(this.el.querySelector('.fc-maxchapters')?.value || 0),
      extras: {
        plugins: (this.genre?.supportsPlugins ? NOVEL_PLUGINS.map(p => ({ id: p.id, name: p.name, on: this.pluginSel.has(p.id) })) : []),
        styles: (this.styles || []).map(st => ({ id: st.id, name: st.label, on: this.styleIds.has(st.id) })),
        embeds: (this.embeds || []).map(e => ({ name: e.name || '(资料)' })),
      },
      tasks: this.tasksSnapshot(),
    };
  }
  tasksSnapshot() {
    const STATUS = { pending: '⏳ 等待', running: '⚡ 执行中', done: '✓ 完成', 'done-warn': '⚠ 完成(有警告)', failed: '✗ 失败', paused: '⏸ 已终止' };
    return (this.tasks || []).map(t => ({
      title: (t.mode === 'max' ? '📖 ' : '📄 ') + t.label + (t.mode === 'max' && t.doneChapters ? ` [${t.doneChapters}章]` : ''),
      statusText: STATUS[t.status] || t.status, desc: t.desc || '', pct: t.pct ?? null,
    }));
  }
  pushSnapshot() {
    if (!window.mazz?.isElectron) return;
    window.mazz.invoke('panel:push', { kind: 'dockfloat', payload: { type: 'factorySnapshot', snapshot: this.snapshot() } }).catch(() => {});
  }
  pushTasks() {
    if (!window.mazz?.isElectron) return;
    window.mazz.invoke('panel:push', { kind: 'dockfloat', payload: { type: 'factoryTasks', tasks: this.tasksSnapshot() } }).catch(() => {});
  }
  saveJSON(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  persistTasks() { this.saveJSON(TASKS_KEY, this.tasks); this.renderTasks(); this.pushTasks(); }

  async reload() {
    this.cfg = await getProviderConfig();
    this.genres = await listGenres();
    this.styles = await listStyles();
    if (!this.genre || !this.genres.find(g => g.id === this.genre.id)) {
      this.genre = this.genres[0];
      this.values = {};
    }
    this.renderForm();
    this.renderTasks();
    this.updateProviderBadge();
    // 启动扫描可恢复任务（原版启动恢复列表）
    this.resumables = await scanResumableTasks();
    this.renderResumables();
    this.pushSnapshot(); // W53 坞浮动镜像
  }

  // ==================== 骨架 ====================
  render() {
    this.el.innerHTML = `
      <div class="sidebar-head"><span>智能创作</span>
        <span class="acts">
          <button data-a="provider" title="AI 服务设置">${iconHtml('⚙')}</button>
          <button data-a="newgenre" title="新建创作模板">${iconHtml('✚')}</button>
        </span></div>
      <div class="factory-body">
        <div class="fc-row">
          <select class="fc-genre" title="创作模板"></select>
        </div>
        <div class="fc-provider-hint"></div>
        <div class="fc-form"></div>
        <div class="fc-dump">
          <div class="fc-label">竹筒倒豆子 <button class="fc-mini" data-a="fill">${iconHtml('✨')} 智能填充</button></div>
          <textarea class="fc-dump-text" rows="4" placeholder="把所有想法、要求、限制条件随意倒进来——会自动提取进上面的字段"></textarea>
        </div>
        <details class="fc-extra">
          <summary>创作增强 <span class="fc-extra-badge"></span></summary>
          <div class="fc-sec" data-sec="plugins">
            <div class="fc-label">创作插件（注入蓝图，可多选） <button class="fc-mini" data-a="plugcfg">配置字段</button></div>
            <div class="fc-chips fc-plugins"></div>
          </div>
          <div class="fc-sec">
            <div class="fc-label">文风素材 <span class="fc-batch-acts">
              <button class="fc-mini" data-a="styleup">上传文件</button>
              <button class="fc-mini" data-a="styleonline">在线查询</button>
            </span></div>
            <div class="fc-chips fc-styles"></div>
          </div>
          <div class="fc-sec">
            <div class="fc-label">嵌入资料（最高优先级注入） <button class="fc-mini" data-a="embedadd">添加文件</button></div>
            <div class="fc-embeds"></div>
          </div>
          <div class="fc-sec">
            <div class="fc-label">联网检索（SearXNG，结果注入竹筒倒豆子）</div>
            <div class="fc-searchrow">
              <input class="fc-search" placeholder="关键词，回车检索…" spellcheck="false">
              <button class="fc-mini" data-a="websearch">检索</button>
            </div>
            <div class="fc-searchres"></div>
          </div>
        </details>
        <div class="fc-actions">
          <button class="fc-btn" data-a="copy" title="生成创作模板母版并复制到剪贴板（可粘到任意 AI 对话）">${iconHtml('📋')} 复制模板母版</button>
          <button class="fc-btn fc-accent" data-a="generate" title="调用配置的 AI 直接生成内容进编辑器">${iconHtml('⚡')} 直接生成</button>
        </div>
        <div class="fc-actions">
          <label class="fc-check" title="双循环勘误：生成后自检+修订一轮"><input type="checkbox" class="fc-dualloop"> 双循环勘误</label>
          <label class="fc-check" title="连写模式：全书蓝图→逐章连续生成，状态快照衔接，断点双防线"><input type="checkbox" class="fc-maxmode"> 连写模式</label>
          <input class="fc-maxchapters" type="number" min="0" max="999" value="0" title="章数上限（0 = 写到手动终止）" style="width:44px">
          <select class="fc-exportfmt" title="章节导出格式（md 始终落盘；docx/epub 等需 pandoc）">
            <option value="md">md</option><option value="docx">docx</option><option value="epub">epub</option>
            <option value="txt">txt</option><option value="html">html</option><option value="odt">odt</option><option value="rtf">rtf</option>
          </select>
        </div>
        <button class="fc-btn" data-a="addtask">＋ 加入任务队列</button>
        <div class="fc-resume"></div>
        <div class="fc-batch">
          <div class="fc-label">写作任务队列 <span class="fc-batch-acts">
            <button class="fc-mini" data-a="startsel">▶ 开始选中</button>
            <button class="fc-mini" data-a="runall">▶▶ 全部启动</button>
            <button class="fc-mini" data-a="stopsel">■ 停止</button>
            <button class="fc-mini" data-a="importcsv">导入CSV</button>
          </span></div>
          <div class="fc-tasklist"></div>
          <div class="fc-batch-acts2">
            <button class="fc-mini" data-a="resumesel">↻ 恢复选中（断点续写）</button>
            <button class="fc-mini" data-a="delsel">删除选中</button>
            <button class="fc-mini" data-a="cleardone">清空完成</button>
          </div>
        </div>
        <div class="fc-livewrap" style="display:none">
          <div class="fc-label">${iconHtml('📺')} 实时预览 <span class="fc-batch-acts">
            <button class="fc-mini" data-a="live-edit">${iconHtml('✎')} 编辑并应用回去</button>
            <button class="fc-mini" data-a="live-open">在编辑器打开</button>
            <button class="fc-mini" data-a="live-close">收起</button>
          </span></div>
          <div class="fc-live" style="max-height:220px;overflow-y:auto;border:1px solid var(--bd,#ddd);border-radius:6px;padding:8px 10px;font-size:13px;line-height:1.8;white-space:pre-wrap;background:var(--card,#fff)"></div>
          <div class="fc-livechaps" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px"></div>
        </div>
        <div class="fc-logwrap">
          <div class="fc-label">主控台日志 <button class="fc-mini" data-a="clearlog">清空</button></div>
          <div class="fc-log"></div>
        </div>
        <div class="fc-history">
          <div class="fc-label">历史 <button class="fc-mini" data-a="clearhis">清空</button></div>
          <div class="fc-hislist"></div>
        </div>
        <div class="fc-pack">
          <button class="fc-mini" data-a="mazimport">导入 .maz 文体包</button>
          <button class="fc-mini" data-a="mazexport">导出当前文体 .maz</button>
        </div>
      </div>`;
    this.formEl = this.el.querySelector('.fc-form');
    this.taskListEl = this.el.querySelector('.fc-tasklist');
    this.hisListEl = this.el.querySelector('.fc-hislist');
    this.logEl = this.el.querySelector('.fc-log');
    this.dumpEl = this.el.querySelector('.fc-dump-text');
    this.genreSel = this.el.querySelector('.fc-genre');
    // B12b 收编：模板/导出格式两 select 子窗格化（隐藏保留作状态单源；genre 选项重建 MutationObserver 自带保鲜）
    import('../../lib/select-menu.js').then(({ selectProxy }) => {
      selectProxy(this.genreSel, { btnClass: 'fc-selmenu' });
      const ef = this.el.querySelector('.fc-exportfmt'); if (ef) selectProxy(ef);
    });
    this.genreSel.addEventListener('change', () => {
      this.genre = this.genres.find(g => g.id === this.genreSel.value) || this.genres[0];
      this.values = {};
      this.renderForm();
    });
    this.el.querySelector('[data-a=provider]').addEventListener('click', () => this.openProviderDialog());
    this.el.querySelector('[data-a=newgenre]').addEventListener('click', () => this.openGenreEditor());
    this.el.querySelector('[data-a=fill]').addEventListener('click', () => this.smartFill());
    this.el.querySelector('[data-a=copy]').addEventListener('click', () => this.copyMantra());
    this.el.querySelector('[data-a=generate]').addEventListener('click', () => this.generateNow());
    this.el.querySelector('[data-a=addtask]').addEventListener('click', () => this.addTask());
    this.el.querySelector('[data-a=startsel]').addEventListener('click', () => this.startSelected());
    this.el.querySelector('[data-a=runall]').addEventListener('click', () => this.runAllTasks());
    this.el.querySelector('[data-a=stopsel]').addEventListener('click', () => { this.stopRequested = true; this.log('用户请求停止当前任务…'); });
    this.el.querySelector('[data-a=importcsv]').addEventListener('click', () => this.importCsv());
    this.el.querySelector('[data-a=resumesel]').addEventListener('click', () => this.resumeSelected());
    this.el.querySelector('[data-a=delsel]').addEventListener('click', () => this.deleteSelected());
    this.el.querySelector('[data-a=cleardone]').addEventListener('click', () => {
      this.tasks = this.tasks.filter(t => t.status !== 'done' && t.status !== 'done-warn');
      this.persistTasks();
    });
    this.el.querySelector('[data-a=clearlog]').addEventListener('click', () => { this.logEl.innerHTML = ''; });
    // —— 实时预览（连写直播 + 编辑并应用回去） ——
    this.liveWrapEl = this.el.querySelector('.fc-livewrap');
    this.liveEl = this.el.querySelector('.fc-live');
    this.liveChapsEl = this.el.querySelector('.fc-livechaps');
    this.el.querySelector('[data-a=live-close]').addEventListener('click', () => { this.liveWrapEl.style.display = 'none'; });
    this.el.querySelector('[data-a=live-edit]').addEventListener('click', () => this.liveEditApply());
    this.el.querySelector('[data-a=live-open]').addEventListener('click', () => {
      const c = this.liveCur;
      if (c?.mdPath) this.shell.openTab('markdown', { title: c.mdPath.split('/').pop(), filePath: c.mdPath });
    });
    this.el.querySelector('[data-a=clearhis]').addEventListener('click', () => {
      this.history = [];
      this.saveJSON(HISTORY_KEY, []);
      this.renderTasks();
    });
    // —— 创作增强区 ——
    this.el.querySelector('[data-a=plugcfg]').addEventListener('click', () => this.openPluginConfig());
    this.el.querySelector('[data-a=styleup]').addEventListener('click', () => this.uploadStyle());
    this.el.querySelector('[data-a=styleonline]').addEventListener('click', () => this.onlineStyle());
    this.el.querySelector('[data-a=embedadd]').addEventListener('click', () => this.addEmbed());
    this.el.querySelector('[data-a=websearch]').addEventListener('click', () => this.webSearch());
    this.el.querySelector('.fc-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.webSearch(); });
    this.el.querySelector('[data-a=mazimport]').addEventListener('click', () => this.importMazPack());
    this.el.querySelector('[data-a=mazexport]').addEventListener('click', () => this.exportMazPack());
  }

  // ==================== 创作增强：插件 / 文风 / 嵌入 / 检索 ====================
  renderExtras() {
    // 插件 chips（文体声明 supportsPlugins 才显示）
    const sec = this.el.querySelector('[data-sec=plugins]');
    const box = this.el.querySelector('.fc-plugins');
    if (this.genre?.supportsPlugins) {
      sec.style.display = '';
      box.innerHTML = NOVEL_PLUGINS.map(p =>
        `<button class="fc-chip ${this.pluginSel.has(p.id) ? 'on' : ''}" data-p="${p.id}" title="${p.desc}">${p.name}</button>`).join('');
      box.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.p;
        this.pluginSel.has(id) ? this.pluginSel.delete(id) : this.pluginSel.add(id);
        this.renderExtras();
      }));
    } else sec.style.display = 'none';
    // 文风 chips
    const sb = this.el.querySelector('.fc-styles');
    sb.innerHTML = this.styles.length
      ? this.styles.map(s => `<button class="fc-chip ${this.styleIds.has(s.id) ? 'on' : ''}" data-s="${s.id}" title="${(s.analysis || s.textPreview || '').slice(0, 120)}">${s.label}</button>`).join('') +
        `<button class="fc-chip fc-chip-ghost" data-smgr>管理</button>`
      : `<span class="fc-empty">（暂无素材——上传范文或在线查询作家风格）</span>`;
    sb.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.s;
      this.styleIds.has(id) ? this.styleIds.delete(id) : this.styleIds.add(id);
      this.renderExtras();
    }));
    sb.querySelector('[data-smgr]')?.addEventListener('click', () => this.openStyleManager());
    this.renderEmbeds();
    this.updateExtraBadge();
  }

  updateExtraBadge() {
    const n = this.pluginSel.size + this.styleIds.size + this.embeds.length;
    this.el.querySelector('.fc-extra-badge').textContent = n ? `（已启用 ${n} 项）` : '';
  }

  activePluginBlocks() {
    return [...this.pluginSel].map(id => {
      const p = NOVEL_PLUGINS.find(x => x.id === id);
      return p ? renderPluginPrompt(p, this.pluginValues[id] || {}, this.values) : '';
    }).filter(Boolean);
  }

  currentStylePackage() {
    return assembleStylePackage({
      traditional: this.values['文风学习对象'] || '',
      styleIds: [...this.styleIds], styles: this.styles,
    });
  }

  openPluginConfig() {
    const ids = [...this.pluginSel];
    if (!ids.length) { toast('先勾选要配置的插件'); return; }
    const m = modal('创作插件字段配置');
    m.body.innerHTML = `<div style="min-width:440px;max-height:60vh;overflow:auto">${ids.map(id => {
      const p = NOVEL_PLUGINS.find(x => x.id === id);
      const vals = this.pluginValues[id] || {};
      return `<div class="fc-plugcfg"><h4>${p.name}</h4>${(p.fields || []).map(f => `
        <div class="set-row"><label title="${f.id}">${f.label}</label>
        ${f.options
          ? `<select class="rb-select" data-pf="${id}::${f.id}">${f.options.map(o => `<option ${o === (vals[f.id] || f.options[0]) ? 'selected' : ''}>${o}</option>`).join('')}</select>`
          : `<input class="rb-input" style="width:60%" data-pf="${id}::${f.id}" value="${(vals[f.id] || '').replace(/"/g, '&quot;')}" placeholder="${f.placeholder || ''}">`}</div>`).join('')}</div>`;
    }).join('')}
      <div style="display:flex;justify-content:flex-end;margin-top:10px"><button id="pc-save" class="rb-btn" style="flex-direction:row;background:var(--accent);color:var(--accent-fg)">保存</button></div></div>`;
    m.body.querySelector('#pc-save').addEventListener('click', () => {
      m.body.querySelectorAll('[data-pf]').forEach(el => {
        const [pid, fid] = el.dataset.pf.split('::');
        (this.pluginValues[pid] ||= {})[fid] = el.value;
      });
      toast('插件字段已保存');
      m.close();
    });
  }

  async uploadStyle() {
    const p = await window.mazz.invoke('dialog:openFile', {
      filters: [{ name: '文本', extensions: ['txt', 'md', 'docx', 'odt', 'rtf', 'html', 'epub'] }],
    }).catch(() => null);
    if (!p) return;
    try {
      this.log('文风素材：提取文本并分析中…');
      const chatFn = providerReady(this.cfg) ? (opts) => chat({ cfg: this.cfg, ...opts }) : null;
      const entry = await uploadStyleFile({ path: p, chatFn });
      this.styles = await listStyles();
      this.styleIds.add(entry.id);
      this.renderExtras();
      this.log(`文风素材已入库：${entry.label}${entry.analysis ? '（AI 分析完成）' : '（未配置 AI，仅存档文本）'}`);
      toast('文风素材已入库并勾选');
    } catch (e) { toast('文风素材失败：' + e.message); this.log('文风素材失败：' + e.message); }
  }

  async onlineStyle() {
    if (!providerReady(this.cfg)) { toast('先配置 AI 服务'); return; }
    const name = await inputModal('在线文风查询：输入作家 / 作品名（AI 回忆分析其风格）');
    if (!name?.trim()) return;
    try {
      this.log(`在线文风查询：${name}…`);
      const entry = await queryOnlineStyle({ authorWork: name, chatFn: (opts) => chat({ cfg: this.cfg, ...opts }) });
      this.styles = await listStyles();
      this.styleIds.add(entry.id);
      this.renderExtras();
      this.log(`文风查询完成：${entry.label}`);
      toast('文风分析已入库并勾选');
    } catch (e) { toast('查询失败：' + e.message); }
  }

  async openStyleManager() {
    const m = modal('文风素材管理');
    const render = async () => {
      this.styles = await listStyles();
      m.body.innerHTML = `<div style="min-width:420px;max-height:55vh;overflow:auto">${this.styles.length ? this.styles.map(s => `
        <div class="fc-stylerow"><span>${s.label}</span><span class="fc-dim">${s.charCount ? s.charCount + '字' : ''}${s.analysis ? ' · 已分析' : ''}</span>
        <button class="fc-mini" data-del="${s.id}">删除</button></div>`).join('') : '<div class="fc-empty">（暂无素材）</div>'}</div>`;
      m.body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        await deleteStyle(b.dataset.del);
        this.styleIds.delete(b.dataset.del);
        await render();
        this.renderExtras();
      }));
    };
    await render();
  }

  async addEmbed() {
    const p = await window.mazz.invoke('dialog:openFile', {
      filters: [{ name: '创作资料', extensions: ['txt', 'md', 'docx', 'odt', 'rtf', 'html', 'epub'] }],
    }).catch(() => null);
    if (!p) return;
    try {
      const { extractText } = await import('./style-studio.js');
      let text = await extractText(p);
      if (text.length > 8000) text = text.slice(0, 8000) + '\n[截断至8000字]';
      this.embeds.push({ name: p.split(/[\\/]/).pop(), text });
      this.renderEmbeds();
      this.updateExtraBadge();
      this.log(`已嵌入资料：${p.split(/[\\/]/).pop()}（${text.length} 字）`);
    } catch (e) { toast('嵌入失败：' + e.message); }
  }

  renderEmbeds() {
    const box = this.el.querySelector('.fc-embeds');
    box.innerHTML = this.embeds.length
      ? this.embeds.map((e, i) => `<div class="fc-embedrow">${iconHtml('📎')} ${e.name} <span class="fc-dim">${e.text.length}字</span> <button class="fc-mini" data-edelete="${i}">✕</button></div>`).join('')
      : '<div class="fc-empty">（可拖入大纲/设定/已完成章节，冲突时以嵌入内容为准）</div>';
    box.querySelectorAll('[data-edelete]').forEach(b => b.addEventListener('click', () => {
      this.embeds.splice(+b.dataset.edelete, 1);
      this.renderEmbeds();
      this.updateExtraBadge();
    }));
  }

  async webSearch() {
    const q = this.el.querySelector('.fc-search').value.trim();
    if (!q) return;
    const box = this.el.querySelector('.fc-searchres');
    box.innerHTML = '<div class="fc-dim">检索中…</div>';
    try {
      const r = await window.mazz.invoke('searx:search', { query: q });
      if (r?.ok === false) throw new Error(r.error || '搜索服务未就绪');
      const items = (r?.results || []).slice(0, 5);
      if (!items.length) { box.innerHTML = '<div class="fc-dim">无结果</div>'; return; }
      box.innerHTML = items.map((it, i) => `
        <div class="fc-hit"><span class="fc-hit-t" title="${it.url || ''}">${it.title || it.url}</span>
        <button class="fc-mini" data-inject="${i}">注入</button></div>`).join('');
      box.querySelectorAll('[data-inject]').forEach(b => b.addEventListener('click', () => {
        const it = items[+b.dataset.inject];
        const snippet = `【检索：${q}】${it.title || ''}\n${it.content || it.snippet || ''}\n来源：${it.url || ''}`;
        this.dumpEl.value = (this.dumpEl.value ? this.dumpEl.value + '\n\n' : '') + snippet;
        toast('已注入竹筒倒豆子');
      }));
    } catch (e) { box.innerHTML = `<div class="fc-dim">检索失败：${e.message}</div>`; }
  }

  // ==================== .maz 文体包 ====================
  async importMazPack() {
    const p = await window.mazz.invoke('dialog:openFile', { filters: [{ name: 'Mazz 文体包', extensions: ['maz'] }] }).catch(() => null);
    if (!p) return;
    try {
      const b64 = await window.mazz.invoke('fs:readFileBase64', { path: p });
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const tpl = await importMaz(bin);
      await this.reload();
      this.genre = this.genres.find(g => g.id === tpl.id) || this.genre;
      this.genreSel.value = this.genre.id;
      this.renderForm();
      this.renderExtras();
      toast(`文体「${tpl.name}」已导入`);
      this.log(`.maz 导入成功：${tpl.name}`);
    } catch (e) { toast('.maz 导入失败：' + e.message); }
  }

  async exportMazPack() {
    if (!this.genre) return;
    try {
      const bytes = await exportMaz(this.genre);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const ws = await window.mazz.invoke('workspace:get');
      const out = `${ws}/创作模板/${this.genre.name}.maz`;
      await window.mazz.invoke('fs:mkdir', { path: `${ws}/创作模板` }).catch(() => {});
      await window.mazz.invoke('fs:writeFileBase64', { path: out, base64: btoa(bin) });
      toast(`.maz 已导出：${out}`);
      this.log(`.maz 已导出 → ${out}`);
    } catch (e) { toast('.maz 导出失败：' + e.message); }
  }

  // ==================== 可恢复任务（原版启动恢复列表） ====================
  renderResumables() {
    const box = this.el.querySelector('.fc-resume');
    if (!this.resumables.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="fc-label">${iconHtml('⚠')} 发现 ${this.resumables.length} 个中断任务 <span class="fc-batch-acts">
      ${this.resumables.map((r, i) => `<button class="fc-mini" data-res="${i}" title="${r.outDir}">↻ ${r.title || '未命名'}（第${(r.currentChapter || 0) + 1}章续）</button>`).join('')}
      <button class="fc-mini" data-resclear>忽略全部</button></span></div>`;
    box.querySelectorAll('[data-res]').forEach(b => b.addEventListener('click', () => this.resumeFromState(this.resumables[+b.dataset.res])));
    box.querySelector('[data-resclear]').addEventListener('click', async () => {
      for (const r of this.resumables) await writeTaskState(r.outDir, { ...r, status: 'done' }).catch(() => {});
      this.resumables = [];
      this.renderResumables();
    });
  }

  async resumeFromState(st) {
    if (!providerReady(this.cfg)) { toast('先配置 AI 服务'); return; }
    if (this.running) { toast('有任务正在执行'); return; }
    const tpl = this.genres.find(g => g.id === st.genreId) || this.genres.find(g => g.supportsPlugins) || this.genre;
    const task = {
      id: st.id || ('t' + Date.now().toString(36)),
      label: st.title || '未命名',
      genreId: tpl.id,
      values: st.values || {}, dump: st.dump || '',
      mode: 'max', maxChapters: st.maxChapters || 0,
      status: 'running', doneChapters: st.currentChapter || 0,
      folder: st.outDir, blueprintReady: true,
      embeds: st.embeds || [], pluginSel: st.pluginSel || [], pluginValues: st.pluginValues || {},
      styleIds: st.styleIds || [],
    };
    this.tasks.push(task);
    this.persistTasks();
    this.log(`恢复中断任务：「${task.label}」从第 ${task.doneChapters + 1} 章续写`);
    await writeTaskState(st.outDir, { ...st, status: 'running' });
    this.running = true;
    this.stopRequested = false;
    try {
      await this.runMaxTask(task, tpl, this.el.querySelector('.fc-dualloop').checked);
    } catch (e) {
      task.status = 'failed';
      this.log(`✗ 恢复失败：${e.message}`);
    } finally {
      this.running = false;
      this.stopRequested = false;
      this.persistTasks();
      this.resumables = await scanResumableTasks();
      this.renderResumables();
    }
  }

  log(msg) {
    const time = new Date().toTimeString().slice(0, 8);
    const line = document.createElement('div');
    line.className = 'fc-log-line';
    line.textContent = `[${time}] ${msg}`;
    this.logEl.appendChild(line);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  updateProviderBadge() {
    const hint = this.el.querySelector('.fc-provider-hint');
    if (providerReady(this.cfg)) {
      hint.innerHTML = `<span class="fc-ok">● ${this.cfg.model} 已就绪</span>`;
    } else {
      hint.innerHTML = `<span class="fc-warn">未配置 AI 服务（点齿轮钮配置；不配也能「复制模板母版」去别的 AI 用）</span>`;
    }
  }

  // ==================== 动态表单 ====================
  renderForm() {
    const tpl = this.genre;
    if (!tpl) { this.formEl.innerHTML = ''; return; }
    this.genreSel.innerHTML = this.genres.map(g =>
      `<option value="${g.id}" ${g.id === tpl.id ? 'selected' : ''}>${g.name}${g.custom ? '（自定义）' : ''} — ${g.description || ''}</option>`).join('');
    this.formEl.innerHTML = tpl.input_fields.map(f => this.fieldHtml(f)).join('') +
      `<div class="fc-gdesc">${tpl.description || ''}</div>`;
    for (const f of tpl.input_fields) {
      const el = this.formEl.querySelector(`[data-f="${f.id}"]`);
      if (el && this.values[f.id] != null) el.value = this.values[f.id];
      else if (el && f.default) el.value = f.default;
    }
    this.formEl.querySelectorAll('[data-f]').forEach(el => {
      el.addEventListener('input', () => { this.values[el.dataset.f] = el.value; });
      el.addEventListener('change', () => { this.values[el.dataset.f] = el.value; });
    });
    this.renderExtras();
    this.pushSnapshot(); // W53 坞浮动镜像
  }

  fieldHtml(f) {
    const req = f.required ? '<b class="fc-req">*</b>' : '';
    const val = (this.values[f.id] ?? f.default ?? '').replace(/"/g, '&quot;');
    if (f.type === 'textarea') {
      return `<div class="fc-field"><label>${f.label}${req}</label><textarea data-f="${f.id}" rows="3" placeholder="${f.placeholder || ''}">${val}</textarea></div>`;
    }
    if (f.type === 'select') {
      return `<div class="fc-field"><label>${f.label}${req}</label><select data-f="${f.id}">${(f.options || []).map(o => `<option ${o === (f.default || this.values[f.id]) ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
    }
    if (f.type === 'file') {
      return `<div class="fc-field"><label>${f.label}${req}</label><button class="fc-mini" data-filepick="${f.id}">选择文件…</button><span class="fc-filename" data-fname="${f.id}">${this.values[f.id] || ''}</span></div>`;
    }
    return `<div class="fc-field"><label>${f.label}${req}</label><input data-f="${f.id}" value="${val}" placeholder="${f.placeholder || ''}" spellcheck="false"></div>`;
  }

  collectValues() {
    for (const el of this.formEl.querySelectorAll('[data-f]')) this.values[el.dataset.f] = el.value;
    return this.values;
  }

  validateRequired() {
    this.collectValues();
    const missing = this.genre.input_fields.filter(f => f.required && !String(this.values[f.id] || '').trim());
    if (missing.length) {
      toast('请先填写：' + missing.map(f => f.label).join('、'));
      this.formEl.querySelector(`[data-f="${missing[0].id}"]`)?.focus();
      return false;
    }
    return true;
  }

  // ==================== 智能填充 ====================
  async smartFill() {
    const dump = this.dumpEl.value.trim();
    if (!dump) { toast('先在竹筒倒豆子框里写点想法'); return; }
    try {
      this.log('智能填充：正在分析需求…');
      const filled = await extractFields({ cfg: this.cfg, tpl: this.genre, dump });
      Object.assign(this.values, filled);
      this.renderForm();
      toast('已填充到字段（可再手动调整）');
      this.log('智能填充完成');
    } catch (e) { toast(e.message); this.log('智能填充失败：' + e.message); }
  }

  // ==================== 模板母版输出 ====================
  currentMantra() {
    this.collectValues();
    return buildMantra(this.genre, this.values, this.dumpEl.value);
  }

  async copyMantra() {
    if (!this.validateRequired()) return;
    const m = this.currentMantra();
    await window.mazz.invoke('clipboard:write', { text: m.doc }).catch(() => navigator.clipboard?.writeText(m.doc));
    toast('创作模板母版已复制——粘贴到任意 AI 对话即可开工');
    this.log('已复制创作模板母版');
    try {
      const ws = await window.mazz.invoke('workspace:get');
      const dir = `${ws}/创作模板`;
      await window.mazz.invoke('fs:mkdir', { path: dir });
      const name = (fieldValue(this.genre, this.values, 'title', 'subject', 'task', 'premise') || this.genre.name).replace(/[\\/:*?"<>|]/g, '-');
      await window.mazz.invoke('fs:writeFile', { path: `${dir}/${name}.tpl.md`, content: m.doc });
    } catch {}
  }

  async generateNow() {
    if (!this.validateRequired()) return;
    if (!providerReady(this.cfg)) { toast('先点 ⚙ 配置 AI 服务（或先「复制模板母版」去别的 AI 用）'); return; }
    const maxMode = this.el.querySelector('.fc-maxmode').checked;
    const maxChapters = +this.el.querySelector('.fc-maxchapters').value || 0;
    const task = this.makeTask(maxMode, maxChapters);
    task.status = 'running';
    await this.runTask(task);
  }

  makeTask(maxMode, maxChapters) {
    this.collectValues();
    return {
      id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      label: fieldValue(this.genre, this.values, 'title', 'subject', 'task', 'premise') || this.values['书名'] || this.genre.name,
      genreId: this.genre.id,
      values: { ...this.values },
      dump: this.dumpEl.value,
      mode: maxMode ? 'max' : 'single',
      maxChapters,
      status: 'pending',
      doneChapters: 0,
      // 创作增强随行
      pluginSel: [...this.pluginSel],
      pluginValues: JSON.parse(JSON.stringify(this.pluginValues)),
      styleIds: [...this.styleIds],
      embeds: this.embeds.map(e => ({ ...e })),
      exportFmt: this.el.querySelector('.fc-exportfmt')?.value || 'md',
    };
  }

  // ==================== 任务执行 ====================
  async runTask(task) {
    if (this.running) { toast('有任务正在执行'); return; }
    if (!providerReady(this.cfg)) { toast('先配置 AI 服务'); return; }
    this.running = true;
    this.stopRequested = false;
    const tpl = this.genres.find(g => g.id === task.genreId) || this.genre;
    task.status = 'running';
    this.renderTasks();
    const dual = this.el.querySelector('.fc-dualloop').checked;
    this.log(`开始任务：「${task.label}」（${tpl.name} · ${task.mode === 'max' ? '连写' : '单次'}模式）`);
    try {
      if (task.mode === 'max') await this.runMaxTask(task, tpl, dual);
      else await this.runSingleTask(task, tpl, dual);
    } catch (e) {
      task.status = 'failed';
      this.log(`✗ 任务「${task.label}」失败：${e.message}`);
    } finally {
      this.running = false;
      this.stopRequested = false;
      this.persistTasks();
    }
  }

  async runSingleTask(task, tpl, dual) {
    const m = buildMantra(tpl, task.values, task.dump);
    // 创作增强注入：嵌入资料（最高优先级）+ 插件规则 + 文风包
    const embedBlocks = buildEmbedBlocks(task.embeds || []);
    const plugBlocks = (task.pluginSel || []).map(id => {
      const p = NOVEL_PLUGINS.find(x => x.id === id);
      return p ? renderPluginPrompt(p, task.pluginValues?.[id] || {}, task.values) : '';
    }).filter(Boolean).join('\n\n');
    const stylePkg = assembleStylePackage({
      traditional: task.values['文风学习对象'] || '',
      styleIds: task.styleIds || [], styles: this.styles,
    });
    const extra = [embedBlocks, plugBlocks && `## 创作插件规则\n${plugBlocks}`,
      stylePkg.includes('未提供') ? '' : `## 文风参考素材\n${stylePkg}`].filter(Boolean).join('\n\n');
    if (extra) m.user += `\n\n${extra}`;
    this.log('⚡ AI 生成中…');
    // 单次模式同样走流式直播（此前用非流式 chat 干等全文=「没办法实时看到进度」总根）
    this.liveStart(1, '');
    let full = '';
    let text = '';
    try {
      text = await chatStream({
        cfg: this.cfg, system: m.system, user: m.user, temperature: 0.8, maxTokens: 8192,
        shouldStop: () => this.stopRequested,
        onChunk: (_, f) => { full = f; this.liveUpdate(full); },
      });
      full = text;
    } catch (e) { this.liveWrapEl && (this.liveWrapEl.style.display = 'none'); throw e; }
    this.liveDone(1, null, full);
    let checks = runQualityChecks(tpl, text);
    if (dual) {
      const failed = checks.filter(c => !c.pass);
      if (failed.length) {
        this.log('🔁 双循环勘误：自检未过，修订中…');
        const fixSys = m.system + '\n\n【勘误】你将收到初稿与未通过的校验项，请输出修订后的完整正文（不要解释）。';
        const fixUser = `【初稿】\n${text}\n\n【未通过校验项】\n${failed.map(f => '- ' + f.label + (f.detail ? '（' + f.detail + '）' : '')).join('\n')}`;
        text = await chat({ cfg: this.cfg, system: fixSys, user: fixUser });
        checks = runQualityChecks(tpl, text);
      }
    }
    const fails = checks.filter(c => !c.pass);
    this.shell.openTab('markdown', { title: task.label + '.md', content: text });
    this.pushHistory({ label: task.label, genre: tpl.name, ok: !fails.length, when: Date.now(), text });
    task.status = fails.length ? 'done-warn' : 'done';
    this.log(fails.length ? `⚠ 完成但有 ${fails.length} 项校验未过：${fails[0].label}` : `✅ 完成，全部校验通过（${text.length} 字）`);
  }

  async runMaxTask(task, tpl, dual, resumeFrom = null, retryChapter = null) {
    const ws = await window.mazz.invoke('workspace:get');
    const folder = task.folder || `${ws}/创作产出/${task.label.replace(/[\\/:*?"<>|]/g, '-')}`;
    task.folder = folder;
    await window.mazz.invoke('fs:mkdir', { path: folder });
    const total = task.maxChapters || 0;
    const stateFor = (status, ch) => writeTaskState(folder, {
      id: task.id, title: task.label, genreId: task.genreId, status,
      currentChapter: ch ?? task.doneChapters ?? 0, maxChapters: total,
      values: task.values, dump: task.dump, pluginSel: task.pluginSel,
      pluginValues: task.pluginValues, styleIds: task.styleIds, embeds: task.embeds,
    });

    // ══ 阶段一：全书蓝图（原版蓝图生成器：插件+文风+嵌入注入，结构校验+3次重试+兜底） ══
    let blueprint = '';
    const bpPath = `${folder}/创作蓝图.md`;
    try { blueprint = await window.mazz.invoke('fs:readFile', { path: bpPath }); } catch {}
    if (!blueprint || retryChapter === -1 /* -1 = 蓝图重试 */) {
      const stylePkg = assembleStylePackage({
        traditional: task.values['文风学习对象'] || '',
        styleIds: task.styleIds || [], styles: this.styles,
      });
      const pluginBlocks = (task.pluginSel || []).map(id => {
        const p = NOVEL_PLUGINS.find(x => x.id === id);
        return p ? renderPluginPrompt(p, task.pluginValues?.[id] || {}, task.values) : '';
      }).filter(Boolean);
      const embedBlocks = buildEmbedBlocks(task.embeds || []);
      const bpUser = buildNovelBlueprintPrompt(task.values, {
        stylePackage: stylePkg, pluginBlocks, embedBlocks,
        maxMode: !total, chapters: total || task.values['计划章节数'] || 10,
        wordsPerChapter: task.values['每章字数'],
      });
      this.log('📐 正在生成全书蓝图（流式）…');
      let ok = false;
      for (let attempt = 1; attempt <= 3 && ok === false; attempt++) {
        if (this.stopRequested) { task.status = 'paused'; await stateFor('stopped', 0); return; }
        let shown = 0;
        blueprint = stripMdFence(await chatStream({
          cfg: this.cfg, user: bpUser, temperature: 0.7, maxTokens: 8192,
          shouldStop: () => this.stopRequested,
          onChunk: (_, full) => { if (full.length - shown >= 600) { shown = full.length; this.log(`… 蓝图 ${full.length} 字`); } },
        }));
        ok = blueprint.length >= 500 && blueprintStructureOk(blueprint);
        this.log(ok ? `✅ 蓝图完整（${blueprint.length} 字，结构通过）` : `⚠ 蓝图不完整（长度 ${blueprint.length}），${attempt < 3 ? '重试 ' + attempt + '/3' : '启用兜底'}`);
      }
      if (!ok) {
        blueprint = this.fallbackBlueprint(task, total);
        this.log('🔧 已使用兜底蓝图');
      }
      await window.mazz.invoke('fs:writeFile', { path: bpPath, content: blueprint });
      this.shell.openTab('markdown', { title: '创作蓝图.md', filePath: bpPath, content: blueprint });
      if (retryChapter === -1) { task.status = 'pending'; this.log('蓝图重试完成，任务待启动'); await stateFor('paused', 0); return; }
    }

    // ══ 大纲解析与补齐 ══
    let outlines = [];
    try {
      const raw = await window.mazz.invoke('fs:readFile', { path: `${folder}/章节大纲.md` });
      outlines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    } catch {}
    if (!outlines.length) {
      outlines = parseChapterOutlines(blueprint, total || 10);
      if (total) {
        if (outlines.length > total) { this.log(`⚡ 蓝图含 ${outlines.length} 章，截取前 ${total} 章`); outlines = outlines.slice(0, total); }
        else while (outlines.length < total) outlines.push(`第${outlines.length + 1}章：根据故事发展自然推进`);
      }
      await window.mazz.invoke('fs:writeFile', { path: `${folder}/章节大纲.md`, content: outlines.join('\n') });
    }
    const chapterCount = total || 999999; // 0 = max 模式写到手动终止（上限 999 章防失控）
    const bpCore = extractBlueprintCore(blueprint);
    const directive = extractWritingDirective(blueprint);

    // ══ 阶段二：逐章生成 ══
    let startAt = 1, stateSummary = '';
    if (retryChapter > 0) {
      startAt = retryChapter;
      stateSummary = await this.loadSnapshot(folder, retryChapter - 1);
    } else if (resumeFrom) {
      startAt = resumeFrom.lastChapter + 1;
      stateSummary = resumeFrom.lastSnap;
    } else {
      stateSummary = await this.loadSnapshot(folder, 0);
    }
    const endAt = retryChapter > 0 ? retryChapter : chapterCount;

    for (let i = startAt; i <= endAt; i++) {
      if (this.stopRequested) { this.log(`■ 任务「${task.label}」在第 ${i} 章前被手动终止`); task.status = 'paused'; await stateFor('stopped', i - 1); return; }
      // max 模式自动续大纲
      if (i > outlines.length) {
        outlines.push(`第${i}章：根据故事发展自然推进`);
        await window.mazz.invoke('fs:writeFile', { path: `${folder}/章节大纲.md`, content: outlines.join('\n') }).catch(() => {});
        this.log(`📝 自动生成第 ${i} 章大纲`);
      }
      const outline = outlines[i - 1];
      const stem = `第${String(i).padStart(3, '0')}章`;
      const mdPath = `${folder}/${stem}.md`;
      const ckptPath = `${folder}/${stem}.checkpoint`;

      // 双重防线：checkpoint（崩溃续写）+ 已有章节（跳过）
      let previous = '';
      try { previous = await window.mazz.invoke('fs:readFile', { path: ckptPath }); } catch {}
      if (!previous && retryChapter !== i) {
        try {
          const existing = await window.mazz.invoke('fs:readFile', { path: mdPath });
          if (existing.trim().length >= 100) { this.log(`第 ${i} 章已存在（${existing.length} 字），跳过`); continue; }
          if (existing.trim()) previous = existing;
        } catch {}
      }

      const cp = buildChapterPromptV2({
        blueprintCore: bpCore, writingDirective: directive, stateSummary,
        outline, chapterNo: i, total: total || 0,
        wordsPerChapter: task.values['每章字数'], title: task.label,
      });
      if (previous) {
        cp.user = `你之前已经写完了本章的前半部分，内容如下：\n\n---\n${previous.slice(-800)}\n---\n\n请从断点处继续往下写，完成本章剩余部分。不要重复已有内容。直接续写正文，不要输出章节标题。`;
        this.log(`⚡ 防线1触发：第 ${i} 章断点续写（已有 ${previous.length} 字）`);
      } else {
        this.log(`⚡ 正在生成第 ${i} 章${total ? ' / 共 ' + total + ' 章' : ''}…`);
      }

      // 流式生成 + checkpoint 节流写（800ms 一次，避开原版每 token 写盘的 IO 风暴）+ 实时预览直播
      this._runFolder = folder;
      this.liveStart(i, previous);
      let full = previous;
      let lastFlush = 0;
      const flushCkpt = async () => {
        lastFlush = Date.now();
        await window.mazz.invoke('fs:writeFile', { path: ckptPath, content: full }).catch(() => {});
      };
      let aiText = '';
      try {
        aiText = await chatStream({
          cfg: this.cfg, system: cp.system, user: cp.user, temperature: 0.8, maxTokens: 8192,
          shouldStop: () => this.stopRequested,
          onChunk: (_, f) => {
            full = dedupMerge(previous, f);
            this.liveUpdate(full);
            if (Date.now() - lastFlush > 800) flushCkpt();
          },
        });
        full = dedupMerge(previous, aiText);
      } catch (e) {
        await flushCkpt();
        throw e;
      }
      if (this.stopRequested) {
        await flushCkpt();
        this.log(`⏹ 第 ${i} 章已终止，已保存 ${full.length} 字到断点文件`);
        task.status = 'paused';
        await stateFor('stopped', i - 1);
        return;
      }

      let text = full;
      if (dual) {
        const checks = runQualityChecks(tpl, text);
        const failed = checks.filter(c => !c.pass);
        if (failed.length) {
          this.log(`🔁 第 ${i} 章自检未过，修订中…`);
          const fixSys = cp.system + '\n\n【勘误】请修订初稿使未过校验项全部通过，只输出修订后正文。';
          text = await chat({ cfg: this.cfg, system: fixSys, user: `【初稿】\n${text}\n\n【未过项】\n${failed.map(f => '- ' + f.label).join('\n')}` });
        }
      }

      if (text.trim().length >= 10) {
        const mdContent = `# ${task.label} 第${i}章\n\n${text}`;
        await window.mazz.invoke('fs:writeFile', { path: mdPath, content: mdContent });
        await window.mazz.invoke('fs:delete', { path: ckptPath }).catch(() => {});
        this.liveDone(i, mdPath, mdContent);
        // 多格式导出（pandoc 可用时）
        if (task.exportFmt && task.exportFmt !== 'md') {
          try {
            await window.mazz.invoke('factory:pandocExport', {
              markdown: mdContent, to: task.exportFmt,
              outPath: `${folder}/${stem}.${FMT_EXTS[task.exportFmt]}`, title: task.label,
            });
            this.log(`✓ 第 ${i} 章 ${task.exportFmt.toUpperCase()} 已导出`);
          } catch { /* pandoc 不可用静默跳过 */ }
        }
        task.doneChapters = i;
        this.renderTasks();
        this.log(`✓ 第 ${i} 章落盘（${text.length} 字）`);
        if (i === startAt || (total && i === total)) {
          this.shell.openTab('markdown', { title: `${stem}.md`, filePath: mdPath, content: mdContent });
        }
      } else {
        this.log(`⚠ 第 ${i} 章内容过短，保留断点待续`);
        await flushCkpt();
      }

      if (this.stopRequested) { task.status = 'paused'; await stateFor('stopped', i); return; }

      // 滚动叙事状态快照（温度调低求稳）
      this.log(`… 正在更新叙事状态快照（第 ${i} 章后）`);
      const sp = buildStateSummaryPrompt(stateSummary, text, i);
      try {
        stateSummary = await chat({ cfg: this.cfg, system: sp.system, user: sp.user, temperature: 0.3 });
      } catch { /* 快照失败沿用旧快照 */ }
      await window.mazz.invoke('fs:writeFile', {
        path: `${folder}/叙事状态快照_第${String(i).padStart(3, '0')}章后.md`, content: stateSummary,
      });
      await stateFor('running', i);
      if (retryChapter > 0) break; // 单章重试只写一章
    }

    task.status = 'done';
    await stateFor('done', task.doneChapters);
    this.pushHistory({ label: task.label, genre: tpl.name, ok: true, when: Date.now(), text: `（连写 ${task.doneChapters} 章，见 ${folder}）` });
    this.log(`✅ 任务「${task.label}」全部 ${task.doneChapters} 章完成`);
  }

  async loadSnapshot(folder, ch) {
    const name = ch <= 0 ? '叙事状态快照_初始.md' : `叙事状态快照_第${String(ch).padStart(3, '0')}章后.md`;
    try { return await window.mazz.invoke('fs:readFile', { path: `${folder}/${name}` }); } catch { return ''; }
  }

  // ==================== 实时预览（原版精髓：直播 + 实时编辑并应用回去） ====================
  /** 章节开写：直播面板亮起 */
  liveStart(chapterNo, seedText = '') {
    if (!this.liveWrapEl) return;
    this.liveCur = { chapterNo, mdPath: null, folder: this._runFolder, text: seedText };
    this.liveWrapEl.style.display = '';
    this.liveEl.innerHTML = `<div style="color:var(--mut,#888);font-size:12px;margin-bottom:4px">⚡ 第 ${chapterNo} 章生成中…</div><div class="fc-live-text"></div>`;
    this.liveTextEl = this.liveEl.querySelector('.fc-live-text');
    this.liveTextEl.textContent = seedText;
    this._livePaint = 0;
  }

  /** 流式更新（300ms 节流绘制，自动滚底） */
  liveUpdate(text) {
    if (!this.liveTextEl || !this.liveCur) return;
    this.liveCur.text = text;
    const now = Date.now();
    if (now - this._livePaint < 300) return;
    this._livePaint = now;
    this.liveTextEl.textContent = text;
    this.liveEl.scrollTop = this.liveEl.scrollHeight;
  }

  /** 章节落盘：定版 + 进章节快列 */
  liveDone(chapterNo, mdPath, text) {
    if (!this.liveCur) return;
    this.liveCur.mdPath = mdPath;
    this.liveCur.text = text;
    this.liveEl.innerHTML = `<div style="color:var(--ok,#3d6b35);font-size:12px;margin-bottom:4px">✓ 第 ${chapterNo} 章完成（${text.length} 字）——可直接点「编辑并应用回去」改稿</div><div class="fc-live-text"></div>`;
    this.liveTextEl = this.liveEl.querySelector('.fc-live-text');
    this.liveTextEl.textContent = text;
    this.liveEl.scrollTop = 0;
    // 章节快列（点哪章看哪章）
    const tag = document.createElement('button');
    tag.className = 'fc-mini';
    tag.textContent = `第${chapterNo}章`;
    tag.addEventListener('click', async () => {
      const t = await window.mazz.invoke('fs:readFile', { path: mdPath }).catch(() => '');
      if (t) { this.liveCur = { chapterNo, mdPath, folder: this._runFolder, text: t }; this.liveTextEl.textContent = t; }
    });
    this.liveChapsEl.appendChild(tag);
  }

  /** 编辑并应用回去：面板变编辑区 → 写回文件 + 以改后内容重建叙事快照（下游章节遵循修订正典） */
  async liveEditApply() {
    const c = this.liveCur;
    if (!c?.mdPath) { toast('还没有已完成的章节可编辑（生成中的内容请先等落盘）'); return; }
    const cur = await window.mazz.invoke('fs:readFile', { path: c.mdPath }).catch(() => null);
    if (cur == null) { toast('读不到章节文件'); return; }
    this.liveEl.innerHTML = `
      <div style="font-size:12px;color:var(--acc,#4f46e5);margin-bottom:4px">✎ 编辑第 ${c.chapterNo} 章——保存后自动写回文件并以新内容重建叙事快照</div>
      <textarea class="fc-live-edit rb-input" style="width:100%;height:180px;font-size:13px;line-height:1.8"></textarea>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="fc-mini fc-accent" data-l="save">💾 保存并应用（重建快照）</button>
        <button class="fc-mini" data-l="cancel">取消</button>
      </div>`;
    const ta = this.liveEl.querySelector('.fc-live-edit');
    ta.value = cur;
    ta.focus();
    this.liveEl.querySelector('[data-l=cancel]').addEventListener('click', () => {
      this.liveEl.innerHTML = `<div class="fc-live-text"></div>`;
      this.liveTextEl = this.liveEl.querySelector('.fc-live-text');
      this.liveTextEl.textContent = cur;
    });
    this.liveEl.querySelector('[data-l=save]').addEventListener('click', async () => {
      const edited = ta.value;
      if (!edited.trim()) { toast('内容不能为空'); return; }
      await window.mazz.invoke('fs:writeFile', { path: c.mdPath, content: edited });
      this.liveCur.text = edited;
      this.liveEl.innerHTML = `<div class="fc-live-text"></div>`;
      this.liveTextEl = this.liveEl.querySelector('.fc-live-text');
      this.liveTextEl.textContent = edited;
      toast('已写回文件');
      // 应用回去的精髓：用编辑后正文重建本章叙事快照，后续章节按修订正典走
      const folder = c.folder || this._runFolder;
      if (folder && this.cfg?.apiKey) {
        this.log(`… 第 ${c.chapterNo} 章已人工修订，正在重建叙事快照`);
        try {
          const prevSnap = await this.loadSnapshot(folder, c.chapterNo - 1);
          const body = edited.replace(/^#[^\n]*\n/, ''); // 去标题行
          const sp = buildStateSummaryPrompt(prevSnap, body, c.chapterNo);
          const snap = await chat({ cfg: this.cfg, system: sp.system, user: sp.user, temperature: 0.3 });
          await window.mazz.invoke('fs:writeFile', {
            path: `${folder}/叙事状态快照_第${String(c.chapterNo).padStart(3, '0')}章后.md`, content: snap,
          });
          this.log(`✓ 第 ${c.chapterNo} 章快照已按修订重建——下游章节将遵循你的改稿`);
          toast('叙事快照已重建，后续章节遵循修订内容');
        } catch (e) { this.log(`⚠ 快照重建失败（不影响文件）：${e.message}`); }
      }
    });
  }

  fallbackBlueprint(task, total) {
    const chapters = Array.from({ length: total || 10 }, (_, i) => `第${i + 1}章：根据故事发展自然推进`).join('\n');
    return `# 《${task.label}》创作蓝图（兜底）

## 蓝图核心设定
- 作品类型：${task.values['作品类型'] || '小说'}
- 篇幅：${task.values['篇幅长短'] || '中篇'}
- 计划章节数：${total || '不限'}
- 每章字数：约 ${task.values['每章字数'] || 2000} 字
- 文风参考：${task.values['文风学习对象'] || '未指定'}

## 章节大纲
${chapters}

## 创作启动指令
根据以上设定进行写作。保持一致的叙事视角和语气基调，写场景不写梗概。`;
  }

  // ==================== 队列操作 ====================
  addTask() {
    if (!this.validateRequired()) return;
    const maxMode = this.el.querySelector('.fc-maxmode').checked;
    const maxChapters = +this.el.querySelector('.fc-maxchapters').value || 0;
    const task = this.makeTask(maxMode, maxChapters);
    this.tasks.push(task);
    this.persistTasks();
    this.log(`已入队：「${task.label}」（${task.mode === 'max' ? '连写' : '单次'}）`);
    toast('已加入任务队列');
  }

  selectedTasks() {
    return [...this.taskListEl.querySelectorAll('.fc-task input[type=checkbox]:checked')]
      .map(cb => this.tasks[+cb.dataset.i]).filter(Boolean);
  }

  async startSelected() {
    const sel = this.selectedTasks().filter(t => t.status !== 'running' && t.status !== 'done');
    if (!sel.length) { toast('先勾选要执行的任务'); return; }
    for (const t of sel) {
      await this.runTask(t);
      if (this.stopRequested) break;
    }
  }

  async runAllTasks() {
    const pendings = this.tasks.filter(t => t.status === 'pending' || t.status === 'failed' || t.status === 'paused');
    if (!pendings.length) { toast('没有待执行任务'); return; }
    for (const t of pendings) {
      await this.runTask(t);
      if (this.stopRequested) break;
    }
    toast('队列执行完毕');
  }

  deleteSelected() {
    const sel = new Set(this.selectedTasks().map(t => t.id));
    if (!sel.size) { toast('先勾选要删除的任务'); return; }
    this.tasks = this.tasks.filter(t => !sel.has(t.id));
    this.persistTasks();
    this.log(`已删除 ${sel.size} 个任务`);
  }

  async resumeSelected() {
    const sel = this.selectedTasks().filter(t => t.mode === 'max');
    if (!sel.length) { toast('勾选一个连写任务再恢复'); return; }
    if (!providerReady(this.cfg)) { toast('先配置 AI 服务'); return; }
    for (const task of sel.slice(0, 1) /* 一次恢复一个 */) {
      const tpl = this.genres.find(g => g.id === task.genreId) || this.genre;
      const folder = task.folder || `${await window.mazz.invoke('workspace:get')}/创作产出/${task.label.replace(/[\\/:*?"<>|]/g, '-')}`;
      task.folder = folder;
      const prog = await readMaxTaskProgress(folder);
      if (!prog.lastChapter) { toast('该任务还没有已写章节，直接「开始选中」即可'); return; }
      this.log(`恢复任务：「${task.label}」从第 ${prog.lastChapter + 1} 章续写`);
      if (this.running) { toast('有任务正在执行'); return; }
      this.running = true;
      this.stopRequested = false;
      task.status = 'running';
      this.renderTasks();
      try {
        await this.runMaxTask(task, tpl, this.el.querySelector('.fc-dualloop').checked, prog);
      } catch (e) {
        task.status = 'failed';
        this.log(`✗ 恢复失败：${e.message}`);
      } finally {
        this.running = false;
        this.stopRequested = false;
        this.persistTasks();
      }
    }
  }

  async importCsv() {
    const p = await window.mazz.invoke('dialog:openFile', { filters: [{ name: 'CSV', extensions: ['csv', 'tsv'] }] }).catch(() => null);
    if (!p) return;
    try {
      const text = await window.mazz.invoke('fs:readFile', { path: p });
      const rows = parseCsvTasks(text, this.genre);
      for (const values of rows) {
        this.tasks.push({
          id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          genreId: this.genre.id,
          label: fieldValue(this.genre, values, 'title', 'subject', 'task', 'premise') || this.genre.name,
          values, dump: '', mode: 'single', maxChapters: 0, status: 'pending', doneChapters: 0,
        });
      }
      this.persistTasks();
      this.log(`CSV 导入 ${rows.length} 个任务`);
      toast(`已导入 ${rows.length} 个任务`);
    } catch (e) { toast('CSV 解析失败：' + e.message); }
  }

  // ==================== 任务/历史渲染 ====================
  renderTasks() {
    const STATUS = { pending: iconHtml('⏳') + ' 等待', running: iconHtml('⚡') + ' 执行中', done: iconHtml('✓') + ' 完成', 'done-warn': iconHtml('⚠') + ' 完成(有警告)', failed: iconHtml('✗') + ' 失败', paused: iconHtml('⏸') + ' 已终止' };
    this.taskListEl.innerHTML = this.tasks.length
      ? this.tasks.map((t, i) => `
        <div class="fc-task ${t.status}" data-i="${i}">
          <input type="checkbox" data-i="${i}">
          <span class="fc-task-label" title="${t.label}">${t.mode === 'max' ? '📖 ' : '📄 '}${t.label}${t.mode === 'max' && t.doneChapters ? ` [${t.doneChapters}章]` : ''}</span>
          <span class="fc-task-status">${STATUS[t.status] || t.status}</span>
          ${t.mode === 'max' && t.doneChapters ? `<button class="fc-mini" data-retry="${i}" title="重试某一章/蓝图">↻</button>` : ''}
        </div>`).join('')
      : '<div class="fc-empty">（队列为空——填好表单点「加入任务队列」）</div>';
    this.taskListEl.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const task = this.tasks[+b.dataset.retry];
      const ans = await inputModal(`重试「${task.label}」：已写 ${task.doneChapters} 章。输入要重写的章节号；0 = 重新生成全书蓝图`);
      if (ans == null) return;
      const n = parseInt(ans, 10);
      if (isNaN(n) || n < 0) { toast('输入无效'); return; }
      if (this.running) { toast('有任务正在执行'); return; }
      const tpl = this.genres.find(g => g.id === task.genreId) || this.genre;
      this.running = true;
      this.stopRequested = false;
      task.status = 'running';
      this.renderTasks();
      try {
        if (n === 0) await this.runMaxTask(task, tpl, this.el.querySelector('.fc-dualloop').checked, null, -1);
        else await this.runMaxTask(task, tpl, this.el.querySelector('.fc-dualloop').checked, null, n);
      } catch (err) { task.status = 'failed'; this.log('重试失败：' + err.message); }
      finally { this.running = false; this.stopRequested = false; this.persistTasks(); }
    }));
    this.hisListEl.innerHTML = this.history.length
      ? this.history.slice(0, 8).map((h, i) => `
        <div class="fc-his" data-h="${i}">
          <span class="${h.ok ? 'fc-ok' : 'fc-warn'}">${h.ok ? '✓' : '✗'}</span>
          <span class="fc-his-label" title="${h.label}">${h.label}</span>
          <span class="fc-his-genre">${h.genre}</span>
          ${h.text ? `<button class="fc-mini" data-open="${i}" title="打开">↗</button>` : ''}
        </div>`).join('')
      : '<div class="fc-empty">（暂无历史）</div>';
    this.hisListEl.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
      const h = this.history[+b.dataset.open];
      if (h?.text) this.shell.openTab('markdown', { title: h.label + '.md', content: h.text });
    }));
  }

  pushHistory(h) {
    this.history.unshift(h);
    this.history = this.history.slice(0, 20);
    this.saveJSON(HISTORY_KEY, this.history);
  }

  // ==================== Provider 设置 ====================
  async openProviderDialog() {
    // W57：全原生独立子窗格（DOM modal 浏览器前台被压——创作配置两件收编）
    if (window.mazz?.isElectron) {
      window.mazz.invoke('panel:action', { type: 'factoryStashTab', tab: 'provider' }).catch(() => {});
      window.mazz.invoke('panel:open', { kind: 'factorycfg' }).catch(() => {});
      return;
    }
    const cfg = await getProviderConfig();
    const m = modal('AI 服务设置');
    m.body.innerHTML = `
      <div style="min-width:420px">
        <div class="set-row"><label>服务商</label>
          <select id="pv-preset" class="rb-select">${PRESETS.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
        <div class="set-row"><label>接口地址</label><input id="pv-base" class="rb-input" style="width:64%" value="${cfg.baseURL || ''}" placeholder="https://api.deepseek.com" spellcheck="false"></div>
        <div class="set-row"><label>模型</label>
          <input id="pv-model" class="rb-input" style="width:46%" value="${cfg.model || ''}" placeholder="模型名（可直接编辑）" spellcheck="false" list="pv-models-list">
          <select id="pv-model-sel" class="rb-select" style="max-width:32%" title="模型选单（预置+自动拉取）"><option value="">选单…</option></select>
          <button id="pv-fetch" class="rb-btn" style="flex-direction:row" title="从端点拉取全部模型（接入一家即自动接入他家全部现有模型）">拉取</button></div>
        <div class="set-row"><label>API Key</label><input id="pv-key" class="rb-input" style="width:64%" type="password" value="${cfg.apiKey || ''}" placeholder="sk-…（加密存储）" spellcheck="false"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
          <button id="pv-test" class="rb-btn" style="flex-direction:row">测试连接</button>
          <button id="pv-save" class="rb-btn" style="flex-direction:row;background:var(--accent);color:var(--accent-fg)">保存</button>
        </div>
        <div id="pv-status" style="font-size:12px;color:var(--fg-dim);margin-top:8px">OpenAI 兼容端点均可（DeepSeek / Kimi / OpenAI / 智谱 / Ollama 本地）。Key 经系统加密存储。</div>
      </div>`;
    const g = (id) => m.body.querySelector(id);
    g('#pv-preset').value = PRESETS.find(p => p.baseURL === cfg.baseURL)?.id || 'custom';
    const modelSel = g('#pv-model-sel');
    const fillModels = (ids) => {
      modelSel.innerHTML = '<option value="">选单…</option>' + (ids || []).map(id => `<option value="${id}">${id}</option>`).join('');
    };
    g('#pv-preset').addEventListener('change', () => {
      const p = PRESETS.find(x => x.id === g('#pv-preset').value);
      if (p && p.baseURL) {
        g('#pv-base').value = p.baseURL;
        g('#pv-model').value = p.model;
        fillModels(p.models || []);
      }
    });
    modelSel.addEventListener('change', () => { if (modelSel.value) g('#pv-model').value = modelSel.value; });
    // 初始：预置选单按当前厂商填充
    fillModels(PRESETS.find(x => x.id === g('#pv-preset').value)?.models || []);
    g('#pv-fetch').addEventListener('click', async () => {
      const st = g('#pv-status');
      st.textContent = '正在拉取模型列表…';
      const { fetchModels } = await import('./provider.js');
      const ids = await fetchModels({ baseURL: g('#pv-base').value.trim(), apiKey: g('#pv-key').value.trim() });
      if (ids?.length) {
        fillModels(ids);
        st.textContent = `✓ 已拉取 ${ids.length} 个模型到选单`;
      } else {
        st.textContent = '拉取失败（端点不支持 /models 或网络不通）——用预置选单或手动编辑';
      }
    });
    g('#pv-test').addEventListener('click', async () => {
      const st = g('#pv-status');
      st.textContent = '测试中…';
      try {
        const r = await chat({ cfg: { baseURL: g('#pv-base').value.trim(), model: g('#pv-model').value.trim(), apiKey: g('#pv-key').value.trim() }, user: '回复"ok"两个字即可', maxTokens: 200, temperature: 0 });
        st.textContent = '✅ 连接成功：' + r.slice(0, 40);
      } catch (e) { st.textContent = '✗ ' + e.message; }
    });
    g('#pv-save').addEventListener('click', async () => {
      await saveProviderConfig({ baseURL: g('#pv-base').value.trim(), model: g('#pv-model').value.trim(), apiKey: g('#pv-key').value.trim() });
      this.cfg = await getProviderConfig();
      this.updateProviderBadge();
      toast('AI 服务已保存');
      m.close();
    });
  }

  // ==================== 创作模板编辑 ====================
  async openGenreEditor() {
    // W57：全原生独立子窗格（DOM modal 浏览器前台被压——创作配置两件收编）
    if (window.mazz?.isElectron) {
      window.mazz.invoke('panel:action', { type: 'factoryStashTab', tab: 'genre' }).catch(() => {});
      window.mazz.invoke('panel:open', { kind: 'factorycfg' }).catch(() => {});
      return;
    }
    const m = modal('新建创作模板');
    m.body.innerHTML = `
      <div style="min-width:460px">
        <div class="set-row"><label>名称</label><input id="ge-name" class="rb-input" style="width:60%" placeholder="护理记录"></div>
        <div class="set-row"><label>描述</label><input id="ge-desc" class="rb-input" style="width:60%" placeholder="简短说明"></div>
        <div style="font-size:12.5px;margin:8px 0 4px">输入字段（每行一个：标签|类型|必填。类型：text/textarea/select）</div>
        <textarea id="ge-fields" rows="4" class="rb-input" style="width:100%" spellcheck="false">患者姓名|text|必填
护理要点|textarea|必填
记录类型|text|选填</textarea>
        <div style="font-size:12.5px;margin:8px 0 4px">系统提示词（角色与文风要求）</div>
        <textarea id="ge-sys" rows="3" class="rb-input" style="width:100%" spellcheck="false">你是一名资深…</textarea>
        <div style="font-size:12.5px;margin:8px 0 4px">质量校验（每行一条：描述|规则:值，如 不少于500字|minLength:500）</div>
        <textarea id="ge-checks" rows="3" class="rb-input" style="width:100%" spellcheck="false">不少于 500 字|minLength:500
必须包含签名|contains:签名</textarea>
        <div style="display:flex;justify-content:flex-end;margin-top:10px"><button id="ge-save" class="rb-btn" style="flex-direction:row;background:var(--accent);color:var(--accent-fg)">保存到工作区</button></div>
      </div>`;
    const g = (id) => m.body.querySelector(id);
    g('#ge-save').addEventListener('click', async () => {
      const name = g('#ge-name').value.trim();
      if (!name) { toast('先起个名字'); return; }
      const fields = g('#ge-fields').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const [label, type = 'text', req] = l.split('|').map(x => x.trim());
        return { id: 'f_' + label, label, type: ['text', 'textarea', 'select'].includes(type) ? type : 'text', required: /必/.test(req || '') };
      });
      const checks = g('#ge-checks').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const [label, rule] = l.split('|').map(x => x.trim());
        const [r, v] = (rule || '').split(':');
        return { label, rule: r || 'minLength', value: isNaN(+v) ? v : +v };
      });
      const tpl = {
        id: 'custom_' + name, name, description: g('#ge-desc').value.trim(),
        input_fields: fields.length ? fields : [{ id: 'f_需求', label: '需求', type: 'textarea', required: true }],
        system_prompt: g('#ge-sys').value.trim() || '你是一名资深写作专家。',
        meta_vars: {}, output_rules: { format: 'markdown', max_length: 3000 },
        quality_checks: checks,
      };
      await saveCustomGenre(tpl);
      await this.reload();
      this.genreSel.value = tpl.id;
      this.genre = this.genres.find(x => x.id === tpl.id);
      this.renderForm();
      toast('创作模板已保存到工作区 factory-genres/');
      m.close();
    });
  }
}

// ==================== 编辑器右键：智能改写/扩写 ====================
export function registerFactoryExtras(commands) {
  const rewriteSelected = async (mode) => {
    const ctl = window.__activeMarkdownCtl;
    if (!ctl?.view) return;
    const { state } = ctl.view;
    const { from, to, empty } = state.selection;
    if (empty) { toast('先选中一段文字'); return; }
    const selText = state.doc.textBetween(from, to, '\n', '\n');
    if (!selText.trim()) return;
    const cfg = await getProviderConfig();
    if (!providerReady(cfg)) { toast('先在智能创作面板 ⚙ 配置 AI 服务'); return; }
    const genres = await listGenres();
    const tpl = genres.find(g => g.id === 'tongyong') || genres[0];
    toast(`智能${mode}中…`);
    try {
      const out = await chat({
        cfg,
        system: tpl.system_prompt + `\n你现在的任务是${mode}用户选中的文字。保持原意与事实，只输出${mode}后的文字本身。`,
        user: `【待${mode}的文字】\n${selText}\n\n【要求】\n${mode === '改写' ? '更通顺、更精炼、更贴合语境；长度与原文相当。' : '在原意基础上扩写充实细节与层次，篇幅约为原文 2-3 倍；保持上下文衔接。'}`,
      });
      const tr = mode === '改写'
        ? state.tr.replaceSelectionWith(state.schema.text(out))
        : state.tr.insertText('\n\n' + out, to);
      ctl.view.dispatch(tr.scrollIntoView());
      ctl.view.focus();
      toast(`智能${mode}完成`);
    } catch (e) {
      toast(`智能${mode}失败：` + e.message);
    }
  };
  commands.register('factory.rewrite', { title: '智能改写', icon: '✍', group: '智能创作', when: "module=='markdown' && hasSelection", run: () => rewriteSelected('改写') });
  commands.register('factory.expand', { title: '智能扩写', icon: '➕', group: '智能创作', when: "module=='markdown' && hasSelection", run: () => rewriteSelected('扩写') });
  menus.contribute('editor/context', [
    { command: 'factory.rewrite', title: '智能改写', when: "module=='markdown' && hasSelection", group: '2_format' },
    { command: 'factory.expand', title: '智能扩写', when: "module=='markdown' && hasSelection", group: '2_format' },
  ]);
}
