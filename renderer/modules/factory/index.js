// renderer/modules/factory/index.js —— 智能创作（Mazz Factory）：AI 内容生产中枢
// 任务队列中心（原版 PySide 思路）：创作模板 → 需求澄清 → 任务队列 → 主控台日志 → 连写快照/断点续写
import { toast, modal, inputModal } from '../../shell/shell.js';
import { menus } from '../../core/menu-service.js';
import { listGenres, saveCustomGenre, buildMantra, runQualityChecks, parseCsvTasks, fieldValue, buildStateSummaryPrompt, readMaxTaskProgress, renderPluginPrompt, buildEmbedBlocks, buildBlueprintPrompt, blueprintFamily, blueprintStructureOk, getSnapshotSchema, canUseUnlimited, buildFallbackBlueprint, parseChapterOutlines, extractBlueprintCore, extractWritingDirective, buildConstantAnchor, extractLedgerFromSnapshot, stripMdFence, buildChapterPromptV2, writeTaskState, scanResumableTasks, mergeDeclaredContinuation, ensureTokenDeclaration, stripTokenDeclaration, FACTORY_LENGTH_PRESETS, resolveFactoryLengthPlan, factoryBatchGate, buildFactoryOutputFolder, buildFactoryUnitStem, factoryExportSpec, serializeFactoryText } from './engine.js';
import { getProviderConfig, saveProviderConfig, providerReady, chat, chatStream, extractFields, PRESETS } from './provider.js';
import { NOVEL_PLUGINS } from './plugins.js';
import { listStyles, uploadStyleFile, queryOnlineStyle, deleteStyle, assembleStylePackage } from './style-studio.js';
import { exportMaz, importMaz } from './maz.js';
import { iconHtml } from '../../lib/svg-icons.js';
import { aiRolePicker } from '../../lib/ai-role-picker.js';
import { commands } from '../../core/command-registry.js';
import { AGENT_LEDGER_KEY, AgentRuntime, frequentLedgerInputs, ledgerToMarkdown, normalizeLedger } from './agent.js';
import { REVIEW_ARTIFACT_NAMES, W68_PROTOCOL, reviewArtifactManifest, runW68Review } from './review.js';
import { FACTORY_ARCHIVE_FILE, appendFactoryArchiveText, factoryArtifactEvent, normalizeFactoryEvent } from './workshop.js';
import { detectHumanHelpMoments, evaluateBudgetCap, makeBudgetCard, makeFinalReviewCard } from './command-gate.js';
import { finishWebResearch, prepareWebResearch } from '../search/research-runtime.js';

const TASKS_KEY = 'mazz.factory.tasks';
const HISTORY_KEY = 'mazz.factory.history';
const AUTO_PREVIEW_KEY = 'mazz.factory.autoPreview';
const CONCURRENCY_KEY = 'mazz.factory.concurrency';
const FACTORY_EXPORT_FORMATS = ['md', 'docx', 'epub', 'txt', 'html', 'odt', 'rtf', 'rst', 'adoc', 'textile', 'opml', 'org', 'mw'];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

// 首次生成前探测蓝图/大纲/快照/checkpoint 属于正常分支；先 stat，避免用异常充当流程控制并污染主进程错误账。
async function readOptionalFile(filePath) {
  const stat = await window.mazz.invoke('fs:stat', { path: filePath }).catch(() => ({ exists: false }));
  if (!stat?.exists || stat.isDir) return '';
  return await window.mazz.invoke('fs:readFile', { path: filePath });
}

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
    this.runningTasks = new Set();
    this.stopRequested = false;
    this.autoPreview = this.loadJSON(AUTO_PREVIEW_KEY, true) !== false;
    this.concurrency = Math.max(1, Math.min(4, Number(this.loadJSON(CONCURRENCY_KEY, 1)) || 1));
    this.previewTasks = new Map(); // taskId -> { task, tpl, folder, currentPath }
    this.workshopWrites = new Map(); // folder -> Promise；同项目归档串行，任务并发不互踩
    this.editorTasks = new Map();  // taskId -> { task, path }
    this.cfg = null;
    this.pluginSel = new Set();   // 勾选的创作插件 id
    this.pluginValues = {};       // {pluginId: {fieldId: value}}
    this.styleIds = new Set();    // 勾选的文风素材 id
    this.styles = [];             // 全部文风素材
    this.embeds = [];             // 嵌入资料 [{name, text, note}]
    this.researchPrepared = null; // W62 M0 取材状态；必须经人工勾选才可投喂创作链
    this.researchSelected = new Set();
    this.researchStatus = '';
    this.researchResultPath = '';
    this.resumables = [];         // 启动扫描到的可恢复任务
    this.lengthPlan = resolveFactoryLengthPlan({ preset: 'short' });
    this.agentLedger = normalizeLedger(this.loadJSON(AGENT_LEDGER_KEY, null));
    this.agentRuntime = null;
    this.taskUpdateListener = event => {
      const { taskId = '', patch = {} } = event.detail || {};
      const task = this.tasks.find(row => row.id === taskId);
      if (!task || !patch || typeof patch !== 'object') return;
      Object.assign(task, patch);
      if (patch.status === 'paused' && this.runningTasks.has(taskId)) this.stopRequested = true;
      this.persistTasks();
      this.pushSnapshot();
    };
    window.addEventListener('mazz:factory-task-updated', this.taskUpdateListener);
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
      reviewRitual: this.el.querySelector('.fc-review-ritual')?.value || 'light',
      reviewBudgetCap: +(this.el.querySelector('.fc-review-budget')?.value || 32000),
      maxMode: !!this.el.querySelector('.fc-maxmode')?.checked,
      maxChapters: +(this.el.querySelector('.fc-maxchapters')?.value || 0),
      autoPreview: this.autoPreview,
      concurrency: this.concurrency,
      runningCount: this.runningTasks.size,
      lengthPlan: { ...this.lengthPlan },
      lengthPresets: FACTORY_LENGTH_PRESETS.map(x => ({ ...x })),
      wordsPerUnitChips: [2000, 4000, 6000, 8000],
      unlimitedAllowed: canUseUnlimited(this.genre || {}),
      unitName: getSnapshotSchema(this.genre || {}).unitName,
      exportFmt: this.el.querySelector('.fc-exportfmt')?.value || 'md',
      exportFormats: FACTORY_EXPORT_FORMATS.map(id => ({ id, ext: factoryExportSpec(id).ext })),
      extras: {
        plugins: (this.genre?.supportsPlugins ? NOVEL_PLUGINS.map(p => ({ id: p.id, name: p.name, on: this.pluginSel.has(p.id) })) : []),
        styles: (this.styles || []).map(st => ({ id: st.id, name: st.label, on: this.styleIds.has(st.id) })),
        embeds: (this.embeds || []).map(e => ({ name: e.name || '(资料)' })),
        research: this.researchPrepared ? {
          topic: this.researchPrepared.topic, status: this.researchStatus,
          done: !!this.researchResultPath,
          sources: this.researchPrepared.sources.map(source => ({
            id: source.id, title: source.title, url: source.url, domain: source.domain,
            on: this.researchSelected.has(source.id),
          })),
        } : null,
      },
      tasks: this.tasksSnapshot(),
    };
  }
  tasksSnapshot() {
    const STATUS = { pending: '⏳ 等待', running: '⚡ 执行中', done: '✓ 完成', 'done-warn': '⚠ 完成(有警告)', failed: '✗ 失败', paused: '⏸ 已终止' };
    return (this.tasks || []).map(t => ({
      title: (t.mode === 'max' ? '📖 ' : '📄 ') + t.label + (t.mode === 'max' && t.doneChapters ? ` [${t.doneChapters}章]` : '') + (t.manualRevision?.count ? ` · ✎人工修订×${t.manualRevision.count}` : ''),
      statusText: STATUS[t.status] || t.status, desc: t.desc || '', pct: t.pct ?? null,
    }));
  }
  pushSnapshot() {
    if (!window.mazz?.isElectron) return;
    const snapshot = this.snapshot();
    window.mazz.invoke('panel:push', { kind: 'dockfloat', payload: { type: 'factorySnapshot', snapshot } }).catch(() => {});
    window.mazz.invoke('panel:push', { kind: 'factorycfg', payload: { type: 'factoryProjectSnapshot', snapshot } }).catch(() => {});
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
        <div class="fc-projectbar">
          <div><b>车间执行台</b><span class="fc-daily-hint">新项目统一进入 Output 目录协议</span><span class="fc-role-pickers" aria-label="AI 岗位就地指派"></span></div>
          <span class="fc-project-actions"><button class="fc-btn" data-a="desk">🏭 活稿车间</button><button class="fc-btn fc-accent" data-a="project">＋ 新建立项</button></span>
        </div>
        <div class="fc-project-stash" aria-hidden="true">
        <div class="fc-row">
          <select class="fc-genre" title="创作模板"></select>
        </div>
        <div class="fc-provider-hint"></div>
        <div class="fc-form"></div>
        <div class="fc-dump">
          <div class="fc-label">竹筒倒豆子 <button class="fc-mini" data-a="fill">${iconHtml('✨')} 智能填充</button></div>
          <textarea class="fc-dump-text" rows="4" placeholder="把所有想法、要求、限制条件随意倒进来——会自动提取进上面的字段"></textarea>
        </div>
        <div class="fc-length-planner">
          <div class="fc-label">篇幅档 <span>立项后自动换算内容单元数</span></div>
          <div class="fc-length-cards">
            ${FACTORY_LENGTH_PRESETS.map(x => `<button type="button" data-length="${x.id}"><b>${x.label}</b><span>${x.id === 'unlimited' ? '写到手动终止' : (x.totalWords / 10000) + ' 万字'}</span></button>`).join('')}
          </div>
          <div class="fc-length-smart">
            <label>总字数 <input class="fc-totalwords" type="number" min="1" step="1000" value="${this.lengthPlan.totalWords}"></label>
            <span>÷</span>
            <label>每单元 <input class="fc-wordsperunit" type="number" min="100" step="100" value="${this.lengthPlan.wordsPerUnit}"></label>
            <span>=</span>
            <label>单元数 <input class="fc-maxchapters" type="number" min="0" max="999" value="${this.lengthPlan.maxChapters}" readonly></label>
          </div>
          <div class="fc-length-chips">${[2000, 4000, 6000, 8000].map(n => `<button type="button" data-words="${n}">${n}</button>`).join('')}</div>
        </div>
        <details class="fc-extra">
          <summary>高级设置 <span class="fc-extra-badge"></span></summary>
          <div class="fc-sec fc-advanced-row">
            <label class="fc-check" title="双循环勘误：生成后自检+修订一轮"><input type="checkbox" class="fc-dualloop"> 双循环勘误</label>
            <label class="fc-check" title="W68a 双环审理仪式">审理 <select class="fc-review-ritual"><option value="light">轻仪式</option><option value="full">全仪式</option></select></label>
            <label class="fc-check" title="每任务审理 token 硬顶；不足时全仪式降级，低于 8000 硬停">预算 <input type="number" class="fc-review-budget" min="8000" step="1000" value="32000" style="width:72px"> token</label>
            <label class="fc-check" title="由篇幅档决定是否连写"><input type="checkbox" class="fc-maxmode" checked> 连写模式</label>
            <label class="fc-check" title="每个任务自动打开独立只读预览窗"><input type="checkbox" class="fc-autopreview" ${this.autoPreview ? 'checked' : ''}> 生成自动开预览</label>
            <label class="fc-check" title="任务并发额度 1～4；默认 1 最稳">并发 <input type="number" class="fc-concurrency" min="1" max="4" step="1" value="${this.concurrency}" style="width:46px"> 路</label>
            <select class="fc-exportfmt" title="内容单元导出格式">
              ${FACTORY_EXPORT_FORMATS.map(fmt => `<option value="${fmt}">${fmt}</option>`).join('')}
            </select>
          </div>
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
            <div class="fc-label">M0 证据取材（SearXNG · 人工核准后投喂创作链）</div>
            <div class="fc-searchrow">
              <input class="fc-search" placeholder="关键词，回车检索…" spellcheck="false">
              <button class="fc-mini" data-a="websearch">生成来源清单</button>
            </div>
            <div class="fc-searchres"></div>
          </div>
        </details>
        <div class="fc-actions">
          <button class="fc-btn" data-a="copy" title="生成创作模板母版并复制到剪贴板（可粘到任意 AI 对话）">${iconHtml('📋')} 复制模板母版</button>
          <button class="fc-btn fc-accent" data-a="generate" title="调用配置的 AI 直接生成内容进编辑器">${iconHtml('⚡')} 直接生成</button>
        </div>
        <button class="fc-btn" data-a="addtask">＋ 加入任务队列</button>
        </div>
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
        <section class="fc-command-dock" aria-label="指令台">
          <div class="fc-command-head">
            <div><b>指令台</b><span class="fc-agent-status">命令闭集待命</span></div>
            <span class="fc-agent-role"></span>
          </div>
          <div class="fc-agent-chips" aria-label="高频交办"></div>
          <div class="fc-agent-feed" aria-live="polite"></div>
          <div class="fc-agent-inputrow">
            <textarea class="fc-agent-input" rows="2" placeholder="交办一件事；Ctrl+Enter 执行。多步任务会逐步回报，危险操作必须确认。" spellcheck="false"></textarea>
            <button class="fc-btn fc-accent" data-a="agent-submit">交办</button>
          </div>
          <div class="fc-agent-foot"><span class="fc-agent-toolcount"></span><span>台账同步进工作区全文索引</span></div>
        </section>
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
    const roleHost = this.el.querySelector('.fc-role-pickers');
    this.rolePickers = ['blueprint', 'chapter', 'snapshot'].map(role => aiRolePicker(role, roleHost, { className: 'fc-mini' }));
    this.agentRolePicker = aiRolePicker('agent', this.el.querySelector('.fc-agent-role'), { className: 'fc-mini' });
    this.formEl = this.el.querySelector('.fc-form');
    this.taskListEl = this.el.querySelector('.fc-tasklist');
    this.hisListEl = this.el.querySelector('.fc-hislist');
    this.logEl = this.el.querySelector('.fc-log');
    this.dumpEl = this.el.querySelector('.fc-dump-text');
    this.genreSel = this.el.querySelector('.fc-genre');
    this.agentInputEl = this.el.querySelector('.fc-agent-input');
    this.agentFeedEl = this.el.querySelector('.fc-agent-feed');
    this.agentStatusEl = this.el.querySelector('.fc-agent-status');
    this.agentSubmitEl = this.el.querySelector('[data-a=agent-submit]');
    this.agentRuntime = new AgentRuntime({
      registry: commands, ledger: this.agentLedger,
      saveLedger: async ledger => this.persistAgentLedger(ledger),
      onEvent: event => this.renderAgentEvent(event),
    });
    this.el.querySelector('.fc-agent-toolcount').textContent = `${commands.toolCards().length} 项登记命令`;
    this.renderAgentChips();
    // B12b 收编：模板/导出格式两 select 子窗格化（隐藏保留作状态单源；genre 选项重建 MutationObserver 自带保鲜）
    import('../../lib/select-menu.js').then(({ selectProxy }) => {
      selectProxy(this.genreSel, { btnClass: 'fc-selmenu' });
      const ef = this.el.querySelector('.fc-exportfmt'); if (ef) selectProxy(ef);
    });
    this.genreSel.addEventListener('change', () => {
      this.genre = this.genres.find(g => g.id === this.genreSel.value) || this.genres[0];
      this.values = {};
      this.lengthPlan = resolveFactoryLengthPlan({ preset: 'short' });
      this.renderForm();
      this.syncLengthControls();
    });
    this.el.querySelector('[data-a=project]').addEventListener('click', () => this.openProjectWizard());
    this.el.querySelector('[data-a=desk]').addEventListener('click', () => this.openFactoryDesk());
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
    this.el.querySelectorAll('[data-length]').forEach(b => b.addEventListener('click', () => this.applyLengthPreset(b.dataset.length)));
    this.el.querySelectorAll('[data-words]').forEach(b => b.addEventListener('click', () => this.setWordsPerUnit(+b.dataset.words)));
    this.el.querySelector('.fc-totalwords').addEventListener('change', e => this.setTotalWords(+e.target.value));
    this.el.querySelector('.fc-wordsperunit').addEventListener('change', e => this.setWordsPerUnit(+e.target.value));
    this.el.querySelector('.fc-autopreview').addEventListener('change', e => this.setAutoPreview(e.target.checked));
    this.el.querySelector('.fc-concurrency').addEventListener('change', e => this.setConcurrency(e.target.value));
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
    this.agentSubmitEl.addEventListener('click', () => this.submitAgent());
    this.agentInputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.submitAgent(); }
    });
    this.syncLengthControls(false);
  }

  // ==================== W62a 指令台：最小 agent 环 + 台账 ====================
  async persistAgentLedger(ledger) {
    this.agentLedger = normalizeLedger(ledger);
    this.saveJSON(AGENT_LEDGER_KEY, this.agentLedger);
    this.renderAgentChips();
    try {
      const ws = String(await window.mazz.invoke('workspace:get') || '').replace(/\\/g, '/').replace(/\/$/, '');
      if (!ws) return;
      const dir = `${ws}/Output/_系统`;
      await window.mazz.invoke('fs:mkdir', { path: dir });
      await window.mazz.invoke('fs:writeFile', { path: `${dir}/交办台账.md`, content: ledgerToMarkdown(this.agentLedger) });
    } catch { /* 没工作区时 localStorage 台账仍有效 */ }
  }

  renderAgentChips() {
    const host = this.el.querySelector('.fc-agent-chips');
    if (!host) return;
    const rows = frequentLedgerInputs(this.agentLedger);
    host.innerHTML = '';
    host.style.display = rows.length ? 'flex' : 'none';
    for (const row of rows) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'fc-agent-chip';
      b.textContent = `${row.input} ×${row.count}`;
      b.title = '高频交办；点一下回填';
      b.addEventListener('click', () => { this.agentInputEl.value = row.input; this.agentInputEl.focus(); });
      host.appendChild(b);
    }
  }

  addAgentCard(kind, title, text = '') {
    const card = document.createElement('div');
    card.className = `fc-agent-card ${kind}`;
    const head = document.createElement('div'); head.className = 'fc-agent-card-head'; head.textContent = title;
    const body = document.createElement('div'); body.className = 'fc-agent-card-body'; body.textContent = String(text || '');
    card.append(head, body); this.agentFeedEl.appendChild(card);
    while (this.agentFeedEl.children.length > 20) this.agentFeedEl.firstElementChild.remove();
    card.scrollIntoView({ block: 'nearest' });
    return card;
  }

  renderAgentEvent(event) {
    if (!this.agentStatusEl) return;
    if (event.type === 'start') {
      this.agentStatusEl.textContent = event.replay ? '回放上次交办…' : '受理中…';
      this.addAgentCard('user', '厂主交办', event.input);
    } else if (event.type === 'thinking') {
      this.agentStatusEl.textContent = `规划第 ${event.step} 步…`;
    } else if (event.type === 'tool-start') {
      this.agentStatusEl.textContent = `第 ${event.step} 步执行中…`;
      this.addAgentCard('tool', `步骤 ${event.step} · ${event.title}`, JSON.stringify(event.args || {}));
    } else if (event.type === 'tool-result') {
      this.addAgentCard(event.ok ? 'result' : 'error', event.ok ? `✓ ${event.command}` : `✗ ${event.command}`, event.result);
    } else if (event.type === 'clarify') {
      this.agentStatusEl.textContent = '等你二选一';
      const card = this.addAgentCard('clarify', '需要澄清', event.question);
      const acts = document.createElement('div'); acts.className = 'fc-agent-card-actions';
      event.options.forEach((opt, i) => {
        const b = document.createElement('button'); b.className = 'fc-mini'; b.textContent = `${String.fromCharCode(65 + i)}. ${opt.label}`;
        b.addEventListener('click', async () => { acts.querySelectorAll('button').forEach(x => { x.disabled = true; }); await this.agentRuntime.answer(opt.value); });
        acts.appendChild(b);
      });
      card.appendChild(acts);
      card.scrollIntoView({ block: 'nearest' });
    } else if (event.type === 'confirm') {
      this.agentStatusEl.textContent = '危险操作待确认';
      const card = this.addAgentCard('confirm', `确认执行 · ${event.title}`, JSON.stringify(event.args || {}));
      const acts = document.createElement('div'); acts.className = 'fc-agent-card-actions';
      const yes = document.createElement('button'); yes.className = 'fc-mini danger'; yes.textContent = '确认执行';
      const no = document.createElement('button'); no.className = 'fc-mini'; no.textContent = '取消';
      yes.addEventListener('click', async () => { yes.disabled = no.disabled = true; await this.agentRuntime.approve(); });
      no.addEventListener('click', async () => { yes.disabled = no.disabled = true; await this.agentRuntime.cancel(); });
      acts.append(yes, no); card.appendChild(acts);
      card.scrollIntoView({ block: 'nearest' });
    } else if (event.type === 'finish') {
      this.agentStatusEl.textContent = event.status === 'done' ? '已完成' : '已收口';
      this.addAgentCard('finish', event.status === 'undo' ? '撤销完成' : '交办结果', event.message);
      this.agentSubmitEl.disabled = false;
    } else if (event.type === 'cancelled') {
      this.agentStatusEl.textContent = '已取消，未执行';
    } else if (event.type === 'error') {
      this.agentStatusEl.textContent = '交办失败';
      this.addAgentCard('error', '未执行', event.message);
      this.agentSubmitEl.disabled = false;
    }
  }

  async submitAgent() {
    const input = this.agentInputEl.value.trim();
    if (!input) { this.agentInputEl.focus(); return; }
    this.agentSubmitEl.disabled = true;
    this.agentInputEl.value = '';
    try { await this.agentRuntime.submit(input); }
    catch (e) {
      // runtime 已发 error；同步入口错误（空白/并发）在此补卡。
      if (!/上一项交办尚未结束/.test(e.message || '')) this.log('指令台：' + (e.message || e));
      this.agentSubmitEl.disabled = !!(this.agentRuntime.session || this.agentRuntime.pending);
    }
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
      const chatFn = providerReady(this.cfg) ? (opts) => chat({ cfg: this.cfg, role: 'style', ...opts }) : null;
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
      const entry = await queryOnlineStyle({ authorWork: name, chatFn: (opts) => chat({ cfg: this.cfg, role: 'style', ...opts }) });
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
      : '<div class="fc-empty">（可拖入大纲/设定/已完成内容，冲突时以嵌入内容为准）</div>';
    box.querySelectorAll('[data-edelete]').forEach(b => b.addEventListener('click', () => {
      this.embeds.splice(+b.dataset.edelete, 1);
      this.renderEmbeds();
      this.updateExtraBadge();
    }));
  }

  renderResearchSources() {
    const box = this.el.querySelector('.fc-searchres');
    if (!this.researchPrepared) {
      box.innerHTML = this.researchStatus ? `<div class="fc-dim">${escapeHtml(this.researchStatus)}</div>` : '';
      return;
    }
    box.innerHTML = `
      <div class="fc-dim">来源清单 · 网页只当资料，不当指令。取消可疑项后再核准：</div>
      ${this.researchPrepared.sources.map(source => `
        <label class="fc-hit fc-research-source">
          <input type="checkbox" data-research-source="${escapeHtml(source.id)}" ${this.researchSelected.has(source.id) ? 'checked' : ''} ${this.researchResultPath ? 'disabled' : ''}>
          <span class="fc-hit-t" title="${escapeHtml(source.url)}">${escapeHtml(source.title)} · ${escapeHtml(source.domain)}</span>
        </label>`).join('')}
      <div class="fc-searchrow"><span class="fc-dim">${escapeHtml(this.researchStatus || '等待人工核准')}</span><button class="fc-mini" data-research-approve ${this.researchResultPath ? 'disabled' : ''}>${this.researchResultPath ? '已投喂 M0' : '核准并投喂 M0'}</button></div>`;
    box.querySelectorAll('[data-research-source]').forEach(input => input.addEventListener('change', () => {
      this.setResearchSelected(input.dataset.researchSource, input.checked);
    }));
    box.querySelector('[data-research-approve]')?.addEventListener('click', () => this.approveResearch());
  }

  setResearchSelected(id, on) {
    if (this.researchResultPath) return;
    if (!this.researchPrepared?.sources.some(source => source.id === id)) return;
    on ? this.researchSelected.add(id) : this.researchSelected.delete(id);
    this.researchStatus = `已核准候选 ${this.researchSelected.size}/${this.researchPrepared.sources.length} 项`;
    this.pushSnapshot();
  }

  async webSearch() {
    const q = this.el.querySelector('.fc-search').value.trim();
    if (!q) return;
    const box = this.el.querySelector('.fc-searchres');
    this.researchPrepared = null;
    this.researchSelected.clear();
    this.researchResultPath = '';
    this.researchStatus = 'M0 正在扩写检索式…';
    box.innerHTML = '<div class="fc-dim">M0 正在扩写检索式…</div>';
    this.pushSnapshot();
    try {
      this.researchPrepared = await prepareWebResearch(q, { onStage: row => {
        this.researchStatus = `M0 · ${row.label || row.stage}`;
        box.innerHTML = `<div class="fc-dim">${escapeHtml(this.researchStatus)}…</div>`;
      } });
      this.researchSelected = new Set(this.researchPrepared.sources.map(source => source.id));
      this.researchStatus = `等待人工核准 · ${this.researchSelected.size} 项来源`;
      this.renderResearchSources();
      this.pushSnapshot();
    } catch (e) {
      this.researchStatus = `检索失败：${e.message || e}`;
      this.renderResearchSources();
      this.pushSnapshot();
    }
  }

  async approveResearch() {
    if (!this.researchPrepared) return;
    if (this.researchResultPath) { toast('本轮 M0 报告已经投喂；重新检索可开启新一轮'); return; }
    if (!this.researchSelected.size) { toast('至少核准一个来源'); return; }
    this.researchStatus = 'M0 · 带引文合成';
    this.renderResearchSources();
    this.pushSnapshot();
    try {
      const done = await finishWebResearch(this.researchPrepared, {
        selectedIds: [...this.researchSelected],
        onStage: row => { this.researchStatus = `M0 · ${row.label || row.stage}`; this.pushSnapshot(); },
      });
      this.embeds.push({ name: `M0检索：${this.researchPrepared.topic}`, text: done.report.slice(0, 20_000), note: done.path });
      this.researchResultPath = done.path;
      this.researchStatus = `已核准、落盘并投喂 M0：${done.path}`;
      this.renderEmbeds();
      this.updateExtraBadge();
      this.renderResearchSources();
      this.log(`M0 证据报告已入库并投喂：${done.path}`);
      this.pushSnapshot();
      toast('M0 证据报告已投喂创作链');
      return done;
    } catch (error) {
      this.researchStatus = `M0 合成失败：${error.message || error}`;
      this.renderResearchSources();
      this.pushSnapshot();
      toast(this.researchStatus);
      return null;
    }
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
      styleIds: st.styleIds || [], exportFmt: st.exportFmt || 'md',
      createdAt: st.createdAt, outputProtocol: st.outputProtocol,
      totalWords: st.totalWords, wordsPerUnit: st.wordsPerUnit, lengthPreset: st.lengthPreset,
      reviewProtocol: st.reviewProtocol,
      reviewRitual: st.reviewRitual,
      reviewBudgetCap: st.reviewBudgetCap,
      reviewState: st.reviewState,
      manualRevision: st.manualRevision,
    };
    this.tasks.push(task);
    this.persistTasks();
    if (!this.claimTask(task)) {
      this.tasks = this.tasks.filter(t => t !== task);
      this.persistTasks();
      return;
    }
    this.log(`恢复中断任务：「${task.label}」从第 ${task.doneChapters + 1} 章续写`);
    await writeTaskState(st.outDir, { ...st, status: 'running' });
    try {
      const progress = await readMaxTaskProgress(st.outDir, tpl);
      await this.runMaxTask(task, tpl, this.el.querySelector('.fc-dualloop').checked, progress);
      if (task.status === 'done' || task.status === 'done-warn') await this.finishTaskPreview(task);
    } catch (e) {
      task.status = 'failed';
      this.log(`✗ 恢复失败：${e.message}`);
      await this.finishTaskPreview(task, e.message).catch(() => {});
    } finally {
      this.releaseTask(task);
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

  openFactoryDesk(task = null) {
    const target = task || [...this.tasks].reverse().find(row => row.folder) || null;
    commands.execute('factory.openDesk', { taskId: target?.id || '', folder: target?.folder || '', title: target ? `${target.label} · 活稿车间` : 'Factory Desk · 活稿车间' });
  }

  async appendWorkshop(task, events) {
    if (!task?.folder) return false;
    const folder = String(task.folder).replace(/\\/g, '/').replace(/\/$/, '');
    const path = `${folder}/${FACTORY_ARCHIVE_FILE}`;
    const before = this.workshopWrites.get(folder) || Promise.resolve();
    const write = before.catch(() => {}).then(async () => {
      const old = await readOptionalFile(path);
      const next = appendFactoryArchiveText(old, events, { title: `${task.label} · 工厂群` });
      if (next !== old) await window.mazz.invoke('fs:writeFile', { path, content: next });
      window.dispatchEvent(new CustomEvent('mazz:factory-workshop', { detail: { taskId: task.id, folder, path } }));
      return true;
    });
    this.workshopWrites.set(folder, write);
    try { return await write; } finally { if (this.workshopWrites.get(folder) === write) this.workshopWrites.delete(folder); }
  }

  updateProviderBadge() {
    const hint = this.el.querySelector('.fc-provider-hint');
    const daily = this.el.querySelector('.fc-daily-hint');
    if (providerReady(this.cfg)) {
      hint.innerHTML = `<span class="fc-ok">● ${this.cfg.model} 已就绪</span>`;
      if (daily) daily.textContent = `${this.cfg.model} 已就绪 · 新项目走 Output 协议`;
    } else {
      hint.innerHTML = `<span class="fc-warn">未配置 AI 服务（点齿轮钮配置；不配也能「复制模板母版」去别的 AI 用）</span>`;
      if (daily) daily.textContent = 'AI 未配置 · 可先立项并复制模板母版';
    }
  }

  // ==================== W60b 一次性立项向导 ====================
  async openProjectWizard() {
    if (!window.mazz?.isElectron) {
      toast('当前环境不支持独立立项窗');
      return;
    }
    await window.mazz.invoke('panel:action', { type: 'factoryStashTab', tab: 'project' }).catch(() => {});
    await window.mazz.invoke('panel:open', { kind: 'factorycfg' }).catch(() => {});
    // 已存在的配置窗不会重载、也不会再次 factoryInitQuery；主动推页签才能保证每次都进入立项。
    await window.mazz.invoke('panel:push', { kind: 'factorycfg', payload: { type: 'factoryInit', tab: 'project' } }).catch(() => {});
    this.pushSnapshot();
  }

  syncLengthControls(push = true) {
    const p = this.lengthPlan;
    const total = this.el.querySelector('.fc-totalwords');
    const words = this.el.querySelector('.fc-wordsperunit');
    const chapters = this.el.querySelector('.fc-maxchapters');
    const maxMode = this.el.querySelector('.fc-maxmode');
    if (total) { total.value = p.totalWords || ''; total.disabled = p.preset === 'unlimited'; }
    if (words) words.value = p.wordsPerUnit;
    if (chapters) chapters.value = p.maxChapters;
    if (maxMode) maxMode.checked = true;
    this.el.querySelectorAll('[data-length]').forEach(b => {
      b.classList.toggle('on', b.dataset.length === p.preset);
      b.disabled = b.dataset.length === 'unlimited' && !canUseUnlimited(this.genre || {});
    });
    this.el.querySelectorAll('[data-words]').forEach(b => b.classList.toggle('on', +b.dataset.words === p.wordsPerUnit));
    this.values['每章字数'] = String(p.wordsPerUnit);
    const lengthName = { short: '短篇（1万字以内）', medium: '中篇（1-5万字）', long: '长篇（5万字以上）', unlimited: '无限' }[p.preset];
    if (lengthName) this.values['篇幅长短'] = lengthName;
    const perUnitField = this.formEl?.querySelector('[data-f="每章字数"]');
    if (perUnitField) perUnitField.value = String(p.wordsPerUnit);
    const lengthField = this.formEl?.querySelector('[data-f="篇幅长短"]');
    if (lengthField && [...lengthField.options].some(o => o.value === lengthName)) lengthField.value = lengthName;
    if (push) this.pushSnapshot();
  }

  applyLengthPreset(preset) {
    if (preset === 'unlimited' && !canUseUnlimited(this.genre || {})) {
      toast(`${this.genre?.name || '当前文体'}属于说明类结构单元，不能选择无限档`);
      return false;
    }
    this.lengthPlan = resolveFactoryLengthPlan({ preset });
    this.syncLengthControls();
    return true;
  }

  setTotalWords(totalWords) {
    const preset = this.lengthPlan.preset === 'unlimited' ? 'short' : this.lengthPlan.preset;
    this.lengthPlan = resolveFactoryLengthPlan({ ...this.lengthPlan, preset, totalWords });
    this.syncLengthControls();
  }

  setWordsPerUnit(wordsPerUnit) {
    this.lengthPlan = resolveFactoryLengthPlan({ ...this.lengthPlan, wordsPerUnit });
    this.syncLengthControls();
  }

  setExportFormat(format) {
    const value = FACTORY_EXPORT_FORMATS.includes(format) ? format : 'md';
    const el = this.el.querySelector('.fc-exportfmt');
    if (el) el.value = value;
    this.pushSnapshot();
  }

  setAutoPreview(enabled) {
    this.autoPreview = enabled !== false;
    this.saveJSON(AUTO_PREVIEW_KEY, this.autoPreview);
    const el = this.el.querySelector('.fc-autopreview');
    if (el) el.checked = this.autoPreview;
    this.pushSnapshot();
  }

  setConcurrency(value) {
    this.concurrency = Math.max(1, Math.min(4, Number(value) || 1));
    this.saveJSON(CONCURRENCY_KEY, this.concurrency);
    const el = this.el.querySelector('.fc-concurrency');
    if (el) el.value = String(this.concurrency);
    this.pushSnapshot();
    return this.concurrency;
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

  makeTask(maxMode, maxChapters, valueOverrides = null) {
    this.collectValues();
    if (maxMode && maxChapters === 0 && !canUseUnlimited(this.genre)) {
      toast(`${this.genre.name}属于说明类结构单元，不能无限连写；已按 10 ${getSnapshotSchema(this.genre).unitName}执行`);
      maxChapters = 10;
    }
    const values = { ...this.values, ...(valueOverrides || {}) };
    return {
      id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      createdAt: Date.now(),
      label: fieldValue(this.genre, values, '书名', 'title', 'subject', 'task', 'premise') || this.genre.name,
      genreId: this.genre.id,
      values,
      dump: this.dumpEl.value,
      mode: maxMode ? 'max' : 'single',
      maxChapters,
      totalWords: this.lengthPlan.totalWords,
      wordsPerUnit: this.lengthPlan.wordsPerUnit,
      lengthPreset: this.lengthPlan.preset,
      status: 'pending',
      doneChapters: 0,
      // 创作增强随行
      pluginSel: [...this.pluginSel],
      pluginValues: JSON.parse(JSON.stringify(this.pluginValues)),
      styleIds: [...this.styleIds],
      embeds: this.embeds.map(e => ({ ...e })),
      reviewProtocol: W68_PROTOCOL,
      reviewRitual: this.el.querySelector('.fc-review-ritual')?.value || 'light',
      reviewBudgetCap: Math.max(0, +(this.el.querySelector('.fc-review-budget')?.value || 32000)),
      exportFmt: this.el.querySelector('.fc-exportfmt')?.value || 'md',
      autoPreview: this.autoPreview,
    };
  }

  async ensureTaskFolder(task, tpl) {
    if (!task.folder) {
      const ws = await window.mazz.invoke('workspace:get');
      task.createdAt ||= Date.now();
      task.folder = buildFactoryOutputFolder(ws, {
        genreName: tpl?.name,
        workType: task.values?.['作品类型'] || task.values?.workType,
        title: task.values?.['书名'] || task.label,
        timestamp: task.createdAt,
      });
      task.outputProtocol = 'W60b';
    }
    await window.mazz.invoke('fs:mkdir', { path: task.folder });
    return task.folder;
  }

  async exportTaskFormat(task, markdown, outStem) {
    const fmt = task.exportFmt || 'md';
    if (fmt === 'md') return null;
    const spec = factoryExportSpec(fmt);
    const outPath = `${outStem}.${spec.ext}`;
    if (spec.text) {
      await window.mazz.invoke('fs:writeFile', { path: outPath, content: serializeFactoryText(markdown, fmt, task.label) });
    } else {
      await window.mazz.invoke('factory:pandocExport', { markdown, to: spec.pandoc, outPath, title: task.label });
    }
    return outPath;
  }

  previewEnabled(task) {
    return task?.autoPreview == null ? this.autoPreview : task.autoPreview !== false;
  }

  async previewFiles(folder, activePath = '', activeStatus = 'done') {
    const rows = await window.mazz.invoke('fs:listDir', { path: folder }).catch(() => []);
    const rank = name => name === '创作蓝图.md' ? 0 : name === '章节大纲.md' ? 1
      : /^第\d+/.test(name) ? 2 : /状态快照/.test(name) ? 3 : 4;
    const files = rows.filter(x => !x.isDir && /\.(md|markdown)$/i.test(x.name || ''))
      .map(x => ({ name: x.name, path: x.path || `${folder}/${x.name}`, status: (x.path || `${folder}/${x.name}`) === activePath ? activeStatus : 'done' }))
      .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'zh-CN'));
    if (activePath && !files.some(x => x.path === activePath)) {
      files.push({ name: activePath.split(/[\\/]/).pop(), path: activePath, status: activeStatus });
      files.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'zh-CN'));
    }
    return files;
  }

  previewPush(taskId, payload) {
    if (!taskId || !window.mazz?.isElectron) return;
    window.mazz.invoke('panel:push', { kind: 'fpreview', instanceId: taskId, payload: { taskId, ...payload } }).catch(() => {});
  }

  async openTaskPreview(task, tpl, folder, status = 'running') {
    if (!this.previewEnabled(task) || !window.mazz?.isElectron) return false;
    const ctx = { task, tpl, folder, currentPath: `${folder}/创作蓝图.md` };
    this.previewTasks.set(task.id, ctx);
    await window.mazz.invoke('panel:open', { kind: 'fpreview', opts: { instanceId: task.id, title: `${task.label} · 只读预览` } });
    const files = await this.previewFiles(folder);
    const content = await readOptionalFile(ctx.currentPath).catch(() => '');
    this.previewPush(task.id, {
      type: 'factoryPreviewInit', title: task.label, folder, files, currentPath: ctx.currentPath,
      content, status, statusText: status === 'running' ? '生成中…' : '等待任务',
    });
    return true;
  }

  async refreshTaskPreview(task, activePath = '', activeStatus = 'done') {
    if (!this.previewEnabled(task)) return [];
    const ctx = this.previewTasks.get(task.id);
    const folder = ctx?.folder || task.folder;
    if (!folder) return [];
    if (ctx && activePath) ctx.currentPath = activePath;
    const files = await this.previewFiles(folder, activePath, activeStatus);
    this.previewPush(task.id, { type: 'factoryPreviewFiles', files });
    return files;
  }

  async finishTaskPreview(task, failedMessage = '') {
    if (!this.previewEnabled(task) || !task.folder) return;
    const files = await this.previewFiles(task.folder);
    this.previewPush(task.id, failedMessage
      ? { type: 'factoryPreviewFail', message: failedMessage, files }
      : { type: 'factoryPreviewTaskDone', files });
  }

  async previewSnapshot(taskId, instanceId = taskId) {
    const id = taskId || instanceId;
    const task = this.previewTasks.get(id)?.task || this.tasks.find(t => t.id === id);
    if (!task?.folder) return false;
    const tpl = this.genres.find(g => g.id === task.genreId) || this.genre;
    const ctx = this.previewTasks.get(id) || { task, tpl, folder: task.folder, currentPath: `${task.folder}/创作蓝图.md` };
    this.previewTasks.set(id, ctx);
    const files = await this.previewFiles(ctx.folder);
    const currentPath = ctx.currentPath && files.some(f => f.path === ctx.currentPath) ? ctx.currentPath : (files[0]?.path || '');
    const content = currentPath ? await readOptionalFile(currentPath).catch(() => '') : '';
    this.previewPush(instanceId || id, { type: 'factoryPreviewInit', taskId: id, title: task.label, folder: ctx.folder, files, currentPath, content, status: task.status === 'failed' ? 'failed' : task.status === 'done' || task.status === 'done-warn' ? 'done' : 'running', statusText: task.status === 'failed' ? '✗ 失败' : task.status === 'done' || task.status === 'done-warn' ? '✓ 完成' : '生成中…' });
    return true;
  }

  async readPreviewFile(taskId, filePath, instanceId = taskId) {
    const id = taskId || instanceId;
    const task = this.previewTasks.get(id)?.task || this.tasks.find(t => t.id === id);
    const folder = String(task?.folder || '').replace(/\\/g, '/').replace(/\/$/, '');
    const target = String(filePath || '').replace(/\\/g, '/');
    if (!folder || target.includes('/../') || !target.toLowerCase().startsWith((folder + '/').toLowerCase())) return false;
    const content = await readOptionalFile(target).catch(() => '');
    const ctx = this.previewTasks.get(id); if (ctx) ctx.currentPath = target;
    this.previewPush(instanceId || id, { type: 'factoryPreviewFile', taskId: id, path: target, content });
    return true;
  }

  taskById(taskId) {
    return this.previewTasks.get(taskId)?.task || this.editorTasks.get(taskId)?.task || this.tasks.find(t => t.id === taskId);
  }

  safeTaskPath(task, filePath) {
    const folder = String(task?.folder || '').replace(/\\/g, '/').replace(/\/$/, '');
    const target = String(filePath || '').replace(/\\/g, '/');
    if (!folder || target.includes('/../') || !target.toLowerCase().startsWith((folder + '/').toLowerCase()) || !/\.(md|markdown)$/i.test(target)) return '';
    return target;
  }

  editorPush(taskId, payload) {
    if (!taskId || !window.mazz?.isElectron) return;
    window.mazz.invoke('panel:push', { kind: 'fedit', instanceId: taskId, payload: { taskId, ...payload } }).catch(() => {});
  }

  async openTaskEditor(taskId, filePath) {
    const task = this.taskById(taskId);
    const target = this.safeTaskPath(task, filePath);
    if (!target) return false;
    const stat = await window.mazz.invoke('fs:stat', { path: target }).catch(() => ({ exists: false }));
    if (!stat?.exists || stat.isDir || task.status === 'running') return false;
    const content = await window.mazz.invoke('fs:readFile', { path: target }).catch(() => null);
    if (content == null) return false;
    this.editorTasks.set(taskId, { task, path: target });
    await window.mazz.invoke('panel:open', { kind: 'fedit', opts: { instanceId: taskId, title: `${task.label} · 编辑` } });
    this.editorPush(taskId, { type: 'factoryEditInit', title: target.split(/[\\/]/).pop(), path: target, content, revisionCount: task.manualRevision?.count || 0 });
    return true;
  }

  async editorSnapshot(taskId, instanceId = taskId) {
    const ctx = this.editorTasks.get(taskId || instanceId);
    if (!ctx) return false;
    const content = await window.mazz.invoke('fs:readFile', { path: ctx.path }).catch(() => null);
    if (content == null) return false;
    this.editorPush(instanceId || taskId, { type: 'factoryEditInit', taskId: taskId || instanceId, title: ctx.path.split(/[\\/]/).pop(), path: ctx.path, content, revisionCount: ctx.task.manualRevision?.count || 0 });
    return true;
  }

  async saveTaskEditor(taskId, filePath, content, instanceId = taskId) {
    const task = this.taskById(taskId || instanceId);
    let target = this.safeTaskPath(task, filePath);
    let text = String(content ?? '');
    if (!target || !text.trim()) { this.editorPush(instanceId || taskId, { type: 'factoryEditError', message: '文件路径或内容无效' }); return false; }
    if (task.status === 'running') { this.editorPush(instanceId || taskId, { type: 'factoryEditError', message: '任务生成中，暂不允许回写' }); return false; }
    if (task.reviewProtocol === W68_PROTOCOL && /\/工件\//.test(target.replace(/\\/g, '/'))) {
      this.editorPush(instanceId || taskId, { type: 'factoryEditError', message: 'W68a 审理工件封存只读；更正请对正文另立补遗' });
      return false;
    }
    if (task.reviewProtocol === W68_PROTOCOL && task.reviewState?.sealed && !/(?:创作蓝图|章节大纲|圣经|判例库|状态快照)[^/]*\.md$/i.test(target)) {
      const original = target;
      target = target.replace(/\.(md|markdown)$/i, `.补遗-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}.md`);
      text = `> W68a 补遗：封存原件保持只读。原件：${original.split(/[\\/]/).pop()}\n\n${text}`;
      const editorCtx = this.editorTasks.get(taskId || instanceId); if (editorCtx) editorCtx.path = target;
    }
    await window.mazz.invoke('fs:writeFile', { path: target, content: text });
    const previous = task.manualRevision || {};
    task.manualRevision = { count: (previous.count || 0) + 1, lastAt: Date.now(), path: target };
    task.revised = true;
    const statePath = `${task.folder}/${task.outputProtocol === 'W60b' || /(^|[\\/])Output([\\/]|$)/i.test(task.folder) ? '任务状态.json' : 'task_state.json'}`;
    let state = {};
    try { state = JSON.parse(await window.mazz.invoke('fs:readFile', { path: statePath })); } catch {}
    await writeTaskState(task.folder, { ...state, id: task.id, title: task.label, genreId: task.genreId, status: state.status || task.status || 'done', values: task.values, manualRevision: task.manualRevision });
    this.persistTasks();
    const files = await this.previewFiles(task.folder, target, 'done');
    this.previewPush(task.id, { type: 'factoryPreviewSynced', path: target, content: text, files, revisionCount: task.manualRevision.count });
    this.editorPush(instanceId || task.id, { type: 'factoryEditSaved', taskId: task.id, path: target, content: text, revisionCount: task.manualRevision.count });
    this.log(`✎ 「${task.label}」人工修订已回写：${target.split(/[\\/]/).pop()}（第 ${task.manualRevision.count} 次）`);
    return target;
  }

  // ==================== 任务执行 ====================
  claimTask(task, { scheduled = false } = {}) {
    if (!task || this.runningTasks.has(task.id)) return false;
    if (this.runningTasks.size >= this.concurrency) {
      if (!scheduled) toast(`并发额度已满（${this.concurrency}）`);
      return false;
    }
    if (!this.running) this.stopRequested = false;
    this.runningTasks.add(task.id);
    this.running = true;
    this.pushSnapshot();
    return true;
  }

  releaseTask(task, { scheduled = false } = {}) {
    if (task) this.runningTasks.delete(task.id);
    this.running = this.runningTasks.size > 0;
    this.persistTasks();
    this.pushSnapshot();
    if (!scheduled && !this.running) this.stopRequested = false;
  }

  async runTask(task, { scheduled = false } = {}) {
    if (!providerReady(this.cfg)) { toast('先配置 AI 服务'); return false; }
    if (!this.claimTask(task, { scheduled })) return false;
    const tpl = this.genres.find(g => g.id === task.genreId) || this.genre;
    task.status = 'running';
    this.renderTasks();
    this.pushSnapshot();
    const dual = this.el.querySelector('.fc-dualloop').checked;
    this.log(`开始任务：「${task.label}」（${tpl.name} · ${task.mode === 'max' ? '连写' : '单次'}模式）`);
    try {
      await this.ensureTaskFolder(task, tpl);
      await this.appendWorkshop(task, normalizeFactoryEvent({ type: 'system', title: '任务开工', content: `「${task.label}」进入生产线。\n\n- 模式：${task.mode === 'max' ? '连写' : '单次'}\n- 审理：${task.reviewRitual === 'full' ? '全仪式' : '轻仪式'}\n- 预算：${task.reviewBudgetCap || 32000} token`, stage: 'start', progress: 0 }));
      if (task.mode === 'max') await this.runMaxTask(task, tpl, dual);
      else await this.runSingleTask(task, tpl, dual);
      if (task.status === 'done' || task.status === 'done-warn') await this.finishTaskPreview(task);
      if (task.status === 'done' || task.status === 'done-warn') window.MazzActivity?.publish?.({
        id: `factory-${task.id}`, source: 'factory', title: `AI 写作完成：${task.label}`,
        detail: task.status === 'done-warn' ? '正文已落盘，存在质量警告，可点开复核。' : '正文与任务状态已落盘。',
        status: 'done', target: { kind: 'factory', taskId: task.id, path: task.folder },
      });
    } catch (e) {
      task.status = 'failed';
      if (task.folder) await writeTaskState(task.folder, { id: task.id, title: task.label, genreId: task.genreId, status: 'failed', values: task.values, reviewProtocol: task.reviewProtocol, reviewRitual: task.reviewRitual, reviewBudgetCap: task.reviewBudgetCap, reviewState: task.reviewState }).catch(() => {});
      this.log(`✗ 任务「${task.label}」失败：${e.message}`);
      await this.appendWorkshop(task, normalizeFactoryEvent({ type: 'system', title: '任务中断', content: e.message, stage: 'failed', progress: 100 })).catch(() => {});
      await this.finishTaskPreview(task, e.message).catch(() => {});
      window.MazzActivity?.publish?.({ id: `factory-${task.id}`, source: 'factory', title: `AI 写作中断：${task.label}`, detail: e.message, status: 'failed', target: { kind: 'factory', taskId: task.id, path: task.folder } });
    } finally {
      this.releaseTask(task, { scheduled });
    }
    return true;
  }

  async runTaskPool(tasks) {
    const queue = (tasks || []).filter(t => !this.runningTasks.has(t.id));
    const slots = Math.max(0, this.concurrency - this.runningTasks.size);
    if (!queue.length || !slots) { if (!slots) toast(`并发额度已满（${this.concurrency}）`); return false; }
    if (!this.running) this.stopRequested = false;
    let cursor = 0;
    const worker = async () => {
      while (!this.stopRequested) {
        const i = cursor++;
        if (i >= queue.length) break;
        await this.runTask(queue[i], { scheduled: true });
      }
    };
    await Promise.all(Array.from({ length: Math.min(slots, queue.length) }, worker));
    if (!this.running) this.stopRequested = false;
    return true;
  }

  async writeW68Artifacts(task, result, { unitNo = 1, unitName = '单元', outline = '' } = {}) {
    const folder = task.folder;
    const unitRef = `第${String(unitNo).padStart(3, '0')}${unitName}`;
    const safeOutline = String(outline || '').replace(/^第[^：:]+[：:]\s*/, '').replace(/[\\/:*?"<>|]/g, '-').slice(0, 36);
    const artifactDir = `${folder}/工件/${unitRef}${safeOutline ? '-' + safeOutline : ''}`;
    await window.mazz.invoke('fs:mkdir', { path: artifactDir });
    const artifactLabels = {
      skeleton: '骨架与验收点', draft: '扩写稿', polish: '润色记录', machine: '机检报告', point: '对点报告', repair: '修订单',
      consultation: '请示单', review: '审理表', objection: '质询单', answer: '答辩书', verdict: '裁决书',
    };
    const workshopEvents = [];
    for (const [key, filename] of Object.entries(REVIEW_ARTIFACT_NAMES)) {
      if (key === 'manifest') continue;
      const content = result.artifacts?.[key] || `# ${artifactLabels[key] || key}\n\n- 本轮未执行；详见裁决书。`;
      const artifactPath = `${artifactDir}/${filename}`;
      await window.mazz.invoke('fs:writeFile', { path: artifactPath, content });
      workshopEvents.push(factoryArtifactEvent(key, content, { unitNo, unitName, artifactPath }));
    }
    const manifest = reviewArtifactManifest(result, { unitRef });
    await window.mazz.invoke('fs:writeFile', { path: `${artifactDir}/${REVIEW_ARTIFACT_NAMES.manifest}`, content: JSON.stringify(manifest, null, 2) });

    const locked = (result.schema?.lockedFacts || []).map(x => `- ${x.label}＝${x.value}｜来源：${(x.sources || []).join(' / ') || '未登记'}｜口径：${x.basis || '未登记'}`).join('\n');
    const bibleText = String(result.bible || '').trim() || `# 圣经\n\n## 锁定事实\n\n${locked || '- 暂无锁定事实'}\n`;
    await window.mazz.invoke('fs:writeFile', { path: `${folder}/圣经.md`, content: bibleText.startsWith('#') ? bibleText : `# 圣经\n\n${bibleText}` });

    if (result.precedent) {
      const precedentPath = `${folder}/判例库.md`;
      const old = await readOptionalFile(precedentPath);
      const next = old.trim() ? `${old.trim()}\n\n---\n\n${result.precedent}\n` : `# 判例库\n\n${result.precedent}\n`;
      await window.mazz.invoke('fs:writeFile', { path: precedentPath, content: next });
    }
    const costPath = `${folder}/成本台账.json`;
    let costs = { protocol: W68_PROTOCOL, units: [] };
    try { costs = JSON.parse(await readOptionalFile(costPath)) || costs; } catch {}
    if (!Array.isArray(costs.units)) costs.units = [];
    costs.units = costs.units.filter(x => x.unitNo !== unitNo);
    costs.units.push({ unitNo, unitName, outline, ritual: result.ritual, verdict: result.verdict, sealed: result.sealed, budget: result.budget, at: new Date().toISOString() });
    costs.totalTokens = costs.units.reduce((sum, x) => sum + (Number(x.budget?.usedTokens) || 0), 0);
    await window.mazz.invoke('fs:writeFile', { path: costPath, content: JSON.stringify(costs, null, 2) });
    const budgetGate = evaluateBudgetCap({ capTokens: result.budget?.capTokens || task.reviewBudgetCap || 32000, usedTokens: result.budget?.usedTokens || 0, requestedRitual: result.ritual?.requested || task.reviewRitual || 'light' });
    if (result.ritual?.downgraded || result.verdict === 'budget-stop' || budgetGate.status !== 'ok') {
      workshopEvents.push(normalizeFactoryEvent({
        id: `w68c-budget-${task.id}-${unitNo}`, type: 'help', title: `${budgetGate.label} · 人工选择`,
        content: `- 上限：${budgetGate.capTokens} token\n- 已用：${budgetGate.usedTokens} token\n- 余额：${budgetGate.remainingTokens} token\n\n${result.ritual?.reason || budgetGate.reason}`,
        unitNo, unitName, stage: 'budget-pending', card: makeBudgetCard({ ...budgetGate, requestedRitual: result.ritual?.requested || task.reviewRitual || 'light' }),
      }));
    }
    for (const moment of detectHumanHelpMoments(result)) {
      workshopEvents.push(normalizeFactoryEvent({
        id: `w68c-help-${task.id}-${unitNo}-${moment.id}`, type: 'help', title: `@human · ${moment.label}`,
        content: `${moment.reason}\n\n这是允许主动求助的三种时刻之一；请人工决定升级、打回或补证。`, unitNo, unitName,
        stage: 'help-moment', card: { kind: 'help-moment', moment: moment.id, reason: moment.reason },
      }));
    }
    await this.appendWorkshop(task, workshopEvents);
    return artifactDir;
  }

  async appendW68FinalReview(task, result, { unitNo = 1, unitName = '单元', targetPath = '', targetPrefix = '' } = {}) {
    if (!result || task.reviewProtocol !== W68_PROTOCOL) return false;
    const artifactDir = task.reviewState?.artifactDir || '';
    const finalCardId = `w68c-final-${task.id}-${unitNo}-${task.reviewState?.updatedAt || Date.now()}`;
    const card = makeFinalReviewCard({
      unitNo, unitName, targetPath, targetPrefix, artifactDir,
      draftPath: `${artifactDir}/${REVIEW_ARTIFACT_NAMES.draft}`,
      reviewPath: `${artifactDir}/${REVIEW_ARTIFACT_NAMES.review}`,
      machinePath: `${artifactDir}/${REVIEW_ARTIFACT_NAMES.machine}`,
      eventDay: /事件日/.test(task.label || '') || !!task.values?.['事件日'],
    });
    const content = [
      card.eventDay ? '> **事件日必审：本卡不得静默越过。**' : '> 四闸已完成，等待人工终审。',
      '', '## 全文', '', result.text || result.artifacts?.draft || '- 无',
      '', '## 双审意见', '', result.artifacts?.review || '- 无',
      '', '## 机检报告', '', result.artifacts?.machine || '- 无',
    ].join('\n');
    await this.appendWorkshop(task, normalizeFactoryEvent({
      id: finalCardId, type: 'help', title: `${card.eventDay ? '事件日 · ' : ''}待终审 · 第 ${unitNo} ${unitName}`,
      content, unitNo, unitName, stage: 'final-pending', artifactPath: card.draftPath, card,
    }));
    task.reviewState = { ...(task.reviewState || {}), finalStatus: 'pending', finalCardId, targetPath };
    this.persistTasks();
    return true;
  }

  async runW68UnitReview(task, tpl, { blueprint, outline, text, unitNo = 1, unitName = '单元' } = {}) {
    if (task.reviewProtocol !== W68_PROTOCOL) return { sealed: true, text, legacy: true };
    const bible = await readOptionalFile(`${task.folder}/圣经.md`);
    const precedents = await readOptionalFile(`${task.folder}/判例库.md`);
    this.log(`⚖ ${unitName} ${unitNo} 进入 W68a ${task.reviewRitual === 'full' ? '全仪式' : '轻仪式'}双环审理…`);
    const result = await runW68Review({
      draft: text, blueprint, outline, bible, unitRef: `第${String(unitNo).padStart(3, '0')}${unitName}`,
      ritual: task.reviewRitual || 'light', budgetCap: Number(task.reviewBudgetCap) || 32000, precedents,
      protectionList: [task.label, ...(task.values?.['主要人物'] ? [task.values['主要人物']] : [])].filter(Boolean),
      additionalMachineChecks: current => runQualityChecks(tpl, current),
      ask: req => chat({ cfg: this.cfg, ...req }),
    });
    const artifactDir = await this.writeW68Artifacts(task, result, { unitNo, unitName, outline });
    task.reviewState = {
      protocol: W68_PROTOCOL, ritual: result.ritual, verdict: result.verdict, sealed: result.sealed,
      gates: result.gates, budget: result.budget, unitNo, artifactDir, updatedAt: Date.now(),
    };
    this.persistTasks();
    if (!result.sealed) {
      const error = new Error(`W68a 未准落盘：${result.reason || result.verdict}；中间工件已保存`);
      error.code = 'W68_REVIEW_BLOCK';
      throw error;
    }
    this.log(`✓ ${unitName} ${unitNo} 四闸全开并封存（审理 ${result.budget?.usedTokens || 0} token）`);
    await this.appendWorkshop(task, normalizeFactoryEvent({ type: 'system', title: `${unitName} ${unitNo} 已封存`, content: `四闸全开；审理使用 ${result.budget?.usedTokens || 0} token。`, unitNo, unitName, stage: 'sealed', progress: 100 }));
    return result;
  }

  async runSingleTask(task, tpl, dual) {
    const folder = await this.ensureTaskFolder(task, tpl);
    const m = buildMantra(tpl, task.values, task.dump);
    await window.mazz.invoke('fs:writeFile', { path: `${folder}/创作蓝图.md`, content: m.doc });
    await writeTaskState(folder, { id: task.id, title: task.label, genreId: task.genreId, status: 'running', currentChapter: 0, maxChapters: 1, values: task.values, exportFmt: task.exportFmt, reviewProtocol: task.reviewProtocol, reviewRitual: task.reviewRitual, reviewBudgetCap: task.reviewBudgetCap, reviewState: task.reviewState, manualRevision: task.manualRevision });
    await this.openTaskPreview(task, tpl, folder);
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
    if (task.reviewProtocol === W68_PROTOCOL) m.system += '\n\n【W68a 防偷懒协议】动笔前通读全部锁定材料；每个内容单元达到项目配额；本单元重新读取验收点，不得凭上单元惯性续写。';
    this.log('⚡ AI 生成中…');
    // 单次模式同样走流式直播（此前用非流式 chat 干等全文=「没办法实时看到进度」总根）
    this.liveStart(task, 1, '');
    let full = '';
    let text = '';
    try {
      text = await chatStream({
        cfg: this.cfg, role: 'chapter', system: m.system, user: m.user, temperature: 0.8, maxTokens: 8192,
        shouldStop: () => this.stopRequested,
        onChunk: (_, f) => { full = f; this.liveUpdate(task, full); },
      });
      full = text;
    } catch (e) { this.liveWrapEl && (this.liveWrapEl.style.display = 'none'); throw e; }
    const unitName = getSnapshotSchema(tpl).unitName;
    const outline = `第1${unitName}：${task.label}`;
    let reviewedResult = null;
    if (task.reviewProtocol === W68_PROTOCOL) {
      reviewedResult = await this.runW68UnitReview(task, tpl, { blueprint: m.doc, outline, text, unitNo: 1, unitName });
      text = reviewedResult.text;
    }
    let checks = runQualityChecks(tpl, text);
    if (dual && task.reviewProtocol !== W68_PROTOCOL) {
      const failed = checks.filter(c => !c.pass);
      if (failed.length) {
        this.log('🔁 双循环勘误：自检未过，修订中…');
        const fixSys = m.system + '\n\n【勘误】你将收到初稿与未通过的校验项，请输出修订后的完整正文（不要解释）。';
        const fixUser = `【初稿】\n${text}\n\n【未通过校验项】\n${failed.map(f => '- ' + f.label + (f.detail ? '（' + f.detail + '）' : '')).join('\n')}`;
        text = await chat({ cfg: this.cfg, role: 'chapter', system: fixSys, user: fixUser });
        checks = runQualityChecks(tpl, text);
      }
    }
    const fails = checks.filter(c => !c.pass);
    await window.mazz.invoke('fs:writeFile', { path: `${folder}/章节大纲.md`, content: outline });
    const stem = buildFactoryUnitStem(1, unitName, outline);
    const mdPath = `${folder}/${stem}.md`;
    await window.mazz.invoke('fs:writeFile', { path: mdPath, content: text });
    if (reviewedResult) await this.appendW68FinalReview(task, reviewedResult, { unitNo: 1, unitName, targetPath: mdPath });
    try { await this.exportTaskFormat(task, text, `${folder}/${stem}`); }
    catch (e) { this.log(`⚠ ${task.exportFmt} 导出跳过：${e.message}`); }
    const snapshotSchema = getSnapshotSchema(tpl);
    const snapshot = `# ${snapshotSchema.type === 'narrative' ? '叙事' : '结构'}状态快照\n\n- 状态：${fails.length ? '完成（有警告）' : '完成'}\n- 字数：${text.length}\n- 文体：${tpl.name}\n- 更新时间：${new Date().toISOString()}\n`;
    await window.mazz.invoke('fs:writeFile', { path: `${folder}/${snapshotSchema.type === 'narrative' ? '叙事' : '结构'}状态快照_第001${unitName}后.md`, content: snapshot });
    await writeTaskState(folder, { id: task.id, title: task.label, genreId: task.genreId, status: 'done', currentChapter: 1, maxChapters: 1, values: task.values, exportFmt: task.exportFmt, reviewProtocol: task.reviewProtocol, reviewRitual: task.reviewRitual, reviewBudgetCap: task.reviewBudgetCap, reviewState: task.reviewState, manualRevision: task.manualRevision });
    this.liveDone(task, 1, mdPath, text, getSnapshotSchema(tpl).unitName);
    if (!this.previewEnabled(task)) this.shell.openTab('markdown', { title: task.label + '.md', filePath: mdPath, content: text });
    this.pushHistory({ label: task.label, genre: tpl.name, ok: !fails.length, when: Date.now(), text });
    task.status = fails.length ? 'done-warn' : 'done';
    this.log(fails.length ? `⚠ 完成但有 ${fails.length} 项校验未过：${fails[0].label}` : `✅ 完成，全部校验通过（${text.length} 字）`);
  }

  async runMaxTask(task, tpl, dual, resumeFrom = null, retryChapter = null) {
    const folder = await this.ensureTaskFolder(task, tpl);
    const total = task.maxChapters || (canUseUnlimited(tpl) ? 0 : 10);
    if (!task.maxChapters && total) task.maxChapters = total; // 执行层再钉：旧任务/恢复态不得绕过说明类无限连写禁令
    const family = blueprintFamily(tpl);
    const snapshotSchema = getSnapshotSchema(tpl);
    const unitName = snapshotSchema.unitName;
    await this.openTaskPreview(task, tpl, folder);
    const stateFor = (status, ch) => writeTaskState(folder, {
      id: task.id, title: task.label, genreId: task.genreId, status,
      currentChapter: ch ?? task.doneChapters ?? 0, maxChapters: total,
      values: task.values, dump: task.dump, pluginSel: task.pluginSel,
      pluginValues: task.pluginValues, styleIds: task.styleIds, embeds: task.embeds,
      createdAt: task.createdAt, outputProtocol: task.outputProtocol || 'legacy',
      totalWords: task.totalWords, wordsPerUnit: task.wordsPerUnit, lengthPreset: task.lengthPreset,
      reviewProtocol: task.reviewProtocol,
      reviewRitual: task.reviewRitual,
      reviewBudgetCap: task.reviewBudgetCap,
      reviewState: task.reviewState,
      exportFmt: task.exportFmt || 'md',
      manualRevision: task.manualRevision,
    });

    // ══ 阶段一：全书蓝图（原版蓝图生成器：插件+文风+嵌入注入，结构校验+3次重试+兜底） ══
    let blueprint = '';
    const bpPath = `${folder}/创作蓝图.md`;
    blueprint = await readOptionalFile(bpPath);
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
      const bpUser = buildBlueprintPrompt(tpl, task.values, {
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
          cfg: this.cfg, role: 'blueprint', user: bpUser, temperature: 0.7, maxTokens: 8192,
          shouldStop: () => this.stopRequested,
          onChunk: (_, full) => {
            this.previewPush(task.id, { type: 'factoryPreviewStream', phase: 'blueprint', chapterNo: 0, unitName: '蓝图', path: bpPath, text: full, status: 'running' });
            if (full.length - shown >= 600) { shown = full.length; this.log(`… 蓝图 ${full.length} 字`); }
          },
        }));
        ok = blueprint.length >= 500 && blueprintStructureOk(blueprint, family);
        this.log(ok ? `✅ 蓝图完整（${blueprint.length} 字，结构通过）` : `⚠ 蓝图不完整（长度 ${blueprint.length}），${attempt < 3 ? '重试 ' + attempt + '/3' : '启用兜底'}`);
      }
      if (!ok) {
        blueprint = buildFallbackBlueprint(task, total, tpl);
        this.log('🔧 已使用兜底蓝图');
      }
      await window.mazz.invoke('fs:writeFile', { path: bpPath, content: blueprint });
      await this.refreshTaskPreview(task, bpPath);
      this.previewPush(task.id, { type: 'factoryPreviewFile', path: bpPath, content: blueprint });
      if (!this.previewEnabled(task)) this.shell.openTab('markdown', { title: '创作蓝图.md', filePath: bpPath, content: blueprint });
      if (retryChapter === -1) { task.status = 'pending'; this.log('蓝图重试完成，任务待启动'); await stateFor('paused', 0); return; }
    }

    // ══ 大纲解析与补齐 ══
    let outlines = [];
    try {
      const raw = await readOptionalFile(`${folder}/章节大纲.md`);
      outlines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    } catch {}
    if (!outlines.length) {
      outlines = parseChapterOutlines(blueprint, total || 10, tpl);
      if (total) {
        if (outlines.length > total) { this.log(`⚡ 蓝图含 ${outlines.length} 章，截取前 ${total} 章`); outlines = outlines.slice(0, total); }
        else while (outlines.length < total) outlines.push(`第${outlines.length + 1}${unitName}：根据内容发展自然推进`);
      }
      await window.mazz.invoke('fs:writeFile', { path: `${folder}/章节大纲.md`, content: outlines.join('\n') });
      await this.refreshTaskPreview(task);
    }
    const chapterCount = total || 999999; // 0 = max 模式写到手动终止（上限 999 章防失控）
    const bpCore = extractBlueprintCore(blueprint);
    const directive = extractWritingDirective(blueprint);
    const constantAnchor = buildConstantAnchor(bpCore, directive);

    // ══ 阶段二：逐章生成 ══
    let startAt = 1, stateSummary = '';
    if (retryChapter > 0) {
      startAt = retryChapter;
      stateSummary = await this.loadSnapshot(folder, retryChapter - 1, snapshotSchema);
    } else if (resumeFrom) {
      startAt = resumeFrom.lastChapter + 1;
      stateSummary = resumeFrom.lastSnap;
    } else {
      stateSummary = await this.loadSnapshot(folder, 0, snapshotSchema);
    }
    const endAt = retryChapter > 0 ? retryChapter : chapterCount;

    for (let i = startAt; i <= endAt; i++) {
      if (this.stopRequested) { this.log(`■ 任务「${task.label}」在第 ${i} ${unitName}前被手动终止`); task.status = 'paused'; await stateFor('stopped', i - 1); return; }
      // max 模式自动续大纲
      if (i > outlines.length) {
        outlines.push(`第${i}${unitName}：根据内容发展自然推进`);
        await window.mazz.invoke('fs:writeFile', { path: `${folder}/章节大纲.md`, content: outlines.join('\n') }).catch(() => {});
        this.log(`📝 自动生成第 ${i} ${unitName}大纲`);
      }
      const outline = outlines[i - 1];
      const stem = task.outputProtocol === 'W60b'
        ? buildFactoryUnitStem(i, unitName, outline)
        : `第${String(i).padStart(3, '0')}${unitName}`;
      const mdPath = `${folder}/${stem}.md`;
      const ckptPath = `${folder}/${stem}.checkpoint`;

      // 双重防线：checkpoint（崩溃续写）+ 已有章节（跳过）
      let previous = '';
      let previousComplete = false;
      previous = await readOptionalFile(ckptPath);
      if (!previous && retryChapter !== i) {
        try {
          const existing = await readOptionalFile(mdPath);
          if (existing.trim().length >= 100) { this.log(`第 ${i} ${unitName}已存在（${existing.length} 字），跳过`); continue; }
          if (existing.trim()) previous = existing;
        } catch {}
      }

      let correctionDirective = '';
      if (i > 1 && (i - 1) % 10 === 0) {
        this.log(`… 第 ${i} ${unitName}开写前启动纠偏闸（只校正本${unitName}，不重写既有正文）`);
        try {
          correctionDirective = await chat({
            cfg: this.cfg, role: 'snapshot',
            system: '你是长篇一致性校验员。只指出下一个结构单元需要纠正的偏差；禁止改写既有正文。',
            user: `【恒定锚】\n${constantAnchor}\n\n【滚动快照】\n${stateSummary}\n\n【下一${unitName}任务】\n${outline}`,
            temperature: 0.1, maxTokens: 1200,
          });
        } catch { /* 纠偏失败不阻塞生产 */ }
      }
      const cp = buildChapterPromptV2({
        blueprintCore: bpCore, constantAnchor, writingDirective: directive, outlines, stateSummary,
        foreshadowLedger: extractLedgerFromSnapshot(stateSummary, snapshotSchema), outline, chapterNo: i, total: total || 0,
        wordsPerChapter: task.values['每章字数'], title: task.label,
        correctionDirective, snapshotSchema,
      });
      if (task.reviewProtocol === W68_PROTOCOL) cp.system += '\n\n【W68a 防偷懒协议】续写前通读恒定锚、滚动快照与当前验收点；完成本单元配额；逐单元重置锚点，禁止沿用未经登记的上一单元惯性。';
      if (previous) {
        const declared = mergeDeclaredContinuation(previous, '');
        if (declared.complete) {
          previousComplete = true;
          previous = stripTokenDeclaration(declared.text);
          this.log(`✓ 第 ${i} ${unitName}断点已带 TOKEN 声明，直接收口不重复续写`);
        } else {
          cp.user = `你之前已经写完了本${unitName}的前半部分，内容如下：\n\n---\n${previous.slice(-800)}\n---\n\n请从断点处继续往下写，完成本${unitName}剩余部分。不要重复已有内容。直接续写正文，末尾带 [本次续写字数：N] 声明。`;
        }
        this.log(`⚡ 防线1触发：第 ${i} ${unitName}断点续写（已有 ${previous.length} 字）`);
      } else {
        this.log(`⚡ 正在生成第 ${i} ${unitName}${total ? ' / 共 ' + total + ' ' + unitName : ''}…`);
      }

      // 流式生成 + checkpoint 节流写（800ms 一次，避开原版每 token 写盘的 IO 风暴）+ 实时预览直播
      this.liveStart(task, i, previous, unitName);
      let full = previous;
      let lastFlush = 0;
      const flushCkpt = async () => {
        lastFlush = Date.now();
        await window.mazz.invoke('fs:writeFile', { path: ckptPath, content: full }).catch(() => {});
      };
      let aiText = '';
      if (previousComplete) {
        full = previous;
      } else {
        try {
          aiText = await chatStream({
            cfg: this.cfg, role: 'chapter', system: cp.system, user: cp.user, temperature: 0.8, maxTokens: 8192,
            shouldStop: () => this.stopRequested,
            onChunk: (_, f) => {
              full = mergeDeclaredContinuation(previous, f).text;
              this.liveUpdate(task, stripTokenDeclaration(full));
              if (Date.now() - lastFlush > 800) flushCkpt();
            },
          });
          full = mergeDeclaredContinuation(previous, aiText).text;
        } catch (e) {
          await flushCkpt();
          throw e;
        }
      }
      if (this.stopRequested) {
        await flushCkpt();
        this.log(`⏹ 第 ${i} ${unitName}已终止，已保存 ${full.length} 字到断点文件`);
        task.status = 'paused';
        await stateFor('stopped', i - 1);
        return;
      }

      full = ensureTokenDeclaration(full);
      let text = stripTokenDeclaration(full);
      let reviewedResult = null;
      if (task.reviewProtocol === W68_PROTOCOL) {
        reviewedResult = await this.runW68UnitReview(task, tpl, { blueprint, outline, text, unitNo: i, unitName });
        text = reviewedResult.text;
      }
      if (dual && task.reviewProtocol !== W68_PROTOCOL) {
        const checks = runQualityChecks(tpl, text);
        const failed = checks.filter(c => !c.pass);
        if (failed.length) {
          this.log(`🔁 第 ${i} ${unitName}自检未过，修订中…`);
          const fixSys = cp.system + '\n\n【勘误】请修订初稿使未过校验项全部通过，只输出修订后正文。';
          text = await chat({ cfg: this.cfg, role: 'chapter', system: fixSys, user: `【初稿】\n${text}\n\n【未过项】\n${failed.map(f => '- ' + f.label).join('\n')}` });
        }
      }

      if (text.trim().length >= 10) {
        const mdContent = `# ${task.label} 第${i}${unitName}\n\n${text}`;
        await window.mazz.invoke('fs:writeFile', { path: mdPath, content: mdContent });
        if (reviewedResult) await this.appendW68FinalReview(task, reviewedResult, { unitNo: i, unitName, targetPath: mdPath, targetPrefix: `# ${task.label} 第${i}${unitName}\n\n` });
        await window.mazz.invoke('fs:delete', { path: ckptPath }).catch(() => {});
        this.liveDone(task, i, mdPath, mdContent, unitName);
        // 多格式导出（pandoc 可用时）
        if (task.exportFmt && task.exportFmt !== 'md') {
          try {
            await this.exportTaskFormat(task, mdContent, `${folder}/${stem}`);
            this.log(`✓ 第 ${i} ${unitName} ${task.exportFmt.toUpperCase()} 已导出`);
          } catch (e) { this.log(`⚠ 第 ${i} ${unitName} ${task.exportFmt} 导出跳过：${e.message}`); }
        }
        task.doneChapters = i;
        this.renderTasks();
        this.log(`✓ 第 ${i} ${unitName}落盘（${text.length} 字）`);
        if (!this.previewEnabled(task) && (i === startAt || (total && i === total))) {
          this.shell.openTab('markdown', { title: `${stem}.md`, filePath: mdPath, content: mdContent });
        }
      } else {
        this.log(`⚠ 第 ${i} ${unitName}内容过短，保留断点待续`);
        await flushCkpt();
      }

      if (this.stopRequested) { task.status = 'paused'; await stateFor('stopped', i); return; }

      // 滚动叙事状态快照（温度调低求稳）
      this.log(`… 正在更新${snapshotSchema.type === 'narrative' ? '叙事' : '结构'}状态快照（第 ${i} ${unitName}后）`);
      const sp = buildStateSummaryPrompt(stateSummary, text, i, snapshotSchema);
      try {
        stateSummary = await chat({ cfg: this.cfg, role: 'snapshot', system: sp.system, user: sp.user, temperature: 0.3 });
      } catch { /* 快照失败沿用旧快照 */ }
      await window.mazz.invoke('fs:writeFile', {
        path: `${folder}/${snapshotSchema.type === 'narrative' ? '叙事' : '结构'}状态快照_第${String(i).padStart(3, '0')}${unitName}后.md`, content: stateSummary,
      });
      await stateFor('running', i);
      if (retryChapter > 0) break; // 单章重试只写一章
    }

    task.status = 'done';
    await stateFor('done', task.doneChapters);
    this.pushHistory({ label: task.label, genre: tpl.name, ok: true, when: Date.now(), text: `（连写 ${task.doneChapters} ${snapshotSchema.unitName}，见 ${folder}）` });
    this.log(`✅ 任务「${task.label}」全部 ${task.doneChapters} ${unitName}完成`);
  }

  async loadSnapshot(folder, ch, schema = {}) {
    const snapshot = getSnapshotSchema(schema);
    const prefix = snapshot.type === 'narrative' ? '叙事' : '结构';
    const name = ch <= 0 ? `${prefix}状态快照_初始.md` : `${prefix}状态快照_第${String(ch).padStart(3, '0')}${snapshot.unitName}后.md`;
    return await readOptionalFile(`${folder}/${name}`);
  }

  // ==================== 实时预览（原版精髓：直播 + 实时编辑并应用回去） ====================
  /** 章节开写：直播面板亮起 */
  liveStart(task, chapterNo, seedText = '', unitName = '章') {
    if (!task) return;
    const ctx = {
      taskId: task.id, chapterNo, unitName, mdPath: null, folder: task.folder,
      text: seedText, previewPath: `${task.folder}/第${String(chapterNo).padStart(3, '0')}${unitName}_生成中.md`,
      lastPaint: 0,
    };
    Object.defineProperty(task, '_live', { value: ctx, writable: true, configurable: true });
    this.liveCur = ctx;
    if (task && this.previewEnabled(task)) {
      this.refreshTaskPreview(task, ctx.previewPath, 'running').catch(() => {});
      this.previewPush(task.id, { type: 'factoryPreviewStream', chapterNo, unitName, path: ctx.previewPath, text: seedText, status: 'running' });
    }
    if (!this.liveWrapEl) return;
    this.liveWrapEl.style.display = '';
    this.liveEl.innerHTML = `<div style="color:var(--mut,#888);font-size:12px;margin-bottom:4px">⚡ 第 ${chapterNo} ${unitName}生成中…</div><div class="fc-live-text"></div>`;
    this.liveTextEl = this.liveEl.querySelector('.fc-live-text');
    this.liveTextEl.textContent = seedText;
  }

  /** 流式更新（300ms 节流绘制，自动滚底） */
  liveUpdate(task, text) {
    const ctx = task?._live;
    if (!ctx) return;
    ctx.text = text;
    const now = Date.now();
    if (now - ctx.lastPaint < 300) return;
    ctx.lastPaint = now;
    if (this.previewEnabled(task)) this.previewPush(task.id, { type: 'factoryPreviewStream', chapterNo: ctx.chapterNo, unitName: ctx.unitName, path: ctx.previewPath, text, status: 'running' });
    if (this.liveCur === ctx && this.liveTextEl) this.liveTextEl.textContent = text;
    if (this.liveCur === ctx && this.liveEl) this.liveEl.scrollTop = this.liveEl.scrollHeight;
  }

  /** 章节落盘：定版 + 进章节快列 */
  liveDone(task, chapterNo, mdPath, text, unitName = task?._live?.unitName || '章') {
    if (!task) return;
    const ctx = task._live || { taskId: task.id, chapterNo, unitName, folder: task.folder, text: '' };
    ctx.mdPath = mdPath;
    ctx.text = text;
    Object.defineProperty(task, '_live', { value: ctx, writable: true, configurable: true });
    if (task && this.previewEnabled(task)) {
      this.refreshTaskPreview(task, mdPath).then(files => this.previewPush(task.id, { type: 'factoryPreviewDone', chapterNo, unitName, path: mdPath, text, files, status: 'done' })).catch(() => {});
    }
    if (this.liveCur === ctx && this.liveEl) {
      this.liveEl.innerHTML = `<div style="color:var(--ok,#3d6b35);font-size:12px;margin-bottom:4px">✓ 第 ${chapterNo} ${unitName}完成（${text.length} 字）——可直接点「编辑并应用回去」改稿</div><div class="fc-live-text"></div>`;
      this.liveTextEl = this.liveEl.querySelector('.fc-live-text');
      this.liveTextEl.textContent = text;
      this.liveEl.scrollTop = 0;
    }
    // 章节快列（点哪章看哪章）
    if (!this.liveChapsEl) return;
    const tag = document.createElement('button');
    tag.className = 'fc-mini';
    tag.textContent = `第${chapterNo}${unitName}`;
    tag.addEventListener('click', async () => {
      const t = await window.mazz.invoke('fs:readFile', { path: mdPath }).catch(() => '');
      if (t) {
        ctx.text = t;
        this.liveCur = ctx;
        this.liveWrapEl.style.display = '';
        this.liveEl.innerHTML = '<div class="fc-live-text"></div>';
        this.liveTextEl = this.liveEl.querySelector('.fc-live-text');
        this.liveTextEl.textContent = t;
      }
    });
    this.liveChapsEl.appendChild(tag);
  }

  /** 编辑并应用回去：面板变编辑区 → 写回文件 + 以改后内容重建叙事快照（下游章节遵循修订正典） */
  async liveEditApply() {
    const c = this.liveCur;
    const unitName = c?.unitName || '章';
    if (!c?.mdPath) { toast(`还没有已完成的${unitName}可编辑（生成中的内容请先等落盘）`); return; }
    const cur = await window.mazz.invoke('fs:readFile', { path: c.mdPath }).catch(() => null);
    if (cur == null) { toast('读不到内容单元文件'); return; }
    this.liveEl.innerHTML = `
      <div style="font-size:12px;color:var(--acc,#4f46e5);margin-bottom:4px">✎ 编辑第 ${c.chapterNo} ${unitName}——保存后自动写回文件并重建状态快照</div>
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
      const task = this.taskById(c.taskId);
      if (task) {
        const savedPath = await this.saveTaskEditor(task.id, c.mdPath, edited, task.id);
        if (!savedPath) return;
        c.mdPath = savedPath;
      }
      else await window.mazz.invoke('fs:writeFile', { path: c.mdPath, content: edited });
      this.liveCur.text = edited;
      this.liveEl.innerHTML = `<div class="fc-live-text"></div>`;
      this.liveTextEl = this.liveEl.querySelector('.fc-live-text');
      this.liveTextEl.textContent = edited;
      toast('已写回文件');
      // 应用回去的精髓：用编辑后正文重建本章叙事快照，后续章节按修订正典走
      const folder = c.folder || task?.folder;
      if (folder && this.cfg?.apiKey) {
        this.log(`… 第 ${c.chapterNo} ${unitName}已人工修订，正在重建状态快照`);
        try {
          const tpl = this.genres.find(g => g.id === task?.genreId) || this.genre || {};
          const snapshot = getSnapshotSchema(tpl);
          const prevSnap = await this.loadSnapshot(folder, c.chapterNo - 1, snapshot);
          const body = edited.replace(/^#[^\n]*\n/, ''); // 去标题行
          const sp = buildStateSummaryPrompt(prevSnap, body, c.chapterNo, snapshot);
          const snap = await chat({ cfg: this.cfg, role: 'snapshot', system: sp.system, user: sp.user, temperature: 0.3 });
          await window.mazz.invoke('fs:writeFile', {
            path: `${folder}/${snapshot.type === 'narrative' ? '叙事' : '结构'}状态快照_第${String(c.chapterNo).padStart(3, '0')}${snapshot.unitName}后.md`, content: snap,
          });
          this.log(`✓ 第 ${c.chapterNo} ${unitName}快照已按修订重建——下游${unitName}将遵循你的改稿`);
          toast(`状态快照已重建，后续${unitName}遵循修订内容`);
        } catch (e) { this.log(`⚠ 快照重建失败（不影响文件）：${e.message}`); }
      }
    });
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

  async addBatchTitles(names) {
    const titles = (names || []).map(x => String(x || '').trim()).filter(Boolean);
    const gate = factoryBatchGate(titles.length);
    if (!gate.allowed) { toast(gate.message); return false; }
    if (!titles.length) { this.addTask(); return true; }
    if (!(await this.confirmBatchImport(gate))) return false;
    this.collectValues();
    const fields = this.genre?.input_fields || [];
    const titleField = fields.find(f => /^(书名|标题|title|subject|task|premise)$/i.test(String(f.id || '')) || /书名|标题/.test(String(f.label || '')));
    if (!titleField) { toast('当前文体没有可批量替换的书名/标题字段'); return false; }
    const missing = fields.find(f => f.required && f.id !== titleField.id && !String(this.values[f.id] ?? f.default ?? '').trim());
    if (missing) { toast(`请填写：${missing.label || missing.id}`); return false; }
    const maxMode = this.el.querySelector('.fc-maxmode').checked;
    const maxChapters = +this.el.querySelector('.fc-maxchapters').value || 0;
    const now = Date.now();
    for (let i = 0; i < titles.length; i++) {
      const task = this.makeTask(maxMode, maxChapters, { [titleField.id]: titles[i] });
      task.createdAt = now + i;
      this.tasks.push(task);
    }
    this.persistTasks();
    this.log(`批量名单已入队 ${titles.length} 本（共用当前立项设置）`);
    toast(`已批量加入 ${titles.length} 个任务`);
    return true;
  }

  selectedTasks() {
    return [...this.taskListEl.querySelectorAll('.fc-task input[type=checkbox]:checked')]
      .map(cb => this.tasks[+cb.dataset.i]).filter(Boolean);
  }

  async startSelected() {
    const sel = this.selectedTasks().filter(t => t.status !== 'running' && t.status !== 'done');
    if (!sel.length) { toast('先勾选要执行的任务'); return; }
    await this.runTaskPool(sel);
  }

  async runAllTasks() {
    const pendings = this.tasks.filter(t => t.status === 'pending' || t.status === 'failed' || t.status === 'paused');
    if (!pendings.length) { toast('没有待执行任务'); return; }
    await this.runTaskPool(pendings);
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
      const unitName = getSnapshotSchema(tpl).unitName;
      const folder = await this.ensureTaskFolder(task, tpl);
      const prog = await readMaxTaskProgress(folder, tpl);
      if (!prog.lastChapter) { toast(`该任务还没有已写${unitName}，直接「开始选中」即可`); return; }
      this.log(`恢复任务：「${task.label}」从第 ${prog.lastChapter + 1} ${unitName}续写`);
      if (!this.claimTask(task)) return;
      task.status = 'running';
      this.renderTasks();
      try {
        await this.runMaxTask(task, tpl, this.el.querySelector('.fc-dualloop').checked, prog);
        if (task.status === 'done' || task.status === 'done-warn') await this.finishTaskPreview(task);
        if (task.status === 'done' || task.status === 'done-warn') window.MazzActivity?.publish?.({ id: `factory-${task.id}`, source: 'factory', title: `AI 写作完成：${task.label}`, detail: '续写任务已收口并落盘。', status: 'done', target: { kind: 'factory', taskId: task.id, path: task.folder } });
      } catch (e) {
        task.status = 'failed';
        this.log(`✗ 恢复失败：${e.message}`);
        await this.finishTaskPreview(task, e.message).catch(() => {});
        window.MazzActivity?.publish?.({ id: `factory-${task.id}`, source: 'factory', title: `AI 写作中断：${task.label}`, detail: e.message, status: 'failed', target: { kind: 'factory', taskId: task.id, path: task.folder } });
      } finally {
        this.releaseTask(task);
      }
    }
  }

  confirmBatchImport(gate) {
    if (!gate?.warning || !gate.allowed) return Promise.resolve(!!gate?.allowed);
    return new Promise(resolve => {
      const m = modal('批量名单软提示');
      let settled = false;
      m.body.innerHTML = `<div style="min-width:360px"><p>${gate.message}</p><p style="color:var(--fg-dim);font-size:12px">大批任务会拉长队列执行时间，可分批导入；继续不会突破 100 条硬顶。</p><div style="display:flex;justify-content:flex-end;gap:8px"><button class="rb-btn" data-b="cancel">取消</button><button class="rb-btn" data-b="ok" style="background:var(--accent);color:var(--accent-fg)">确认导入</button></div></div>`;
      const done = value => { if (settled) return; settled = true; resolve(value); m.close(); };
      m.body.querySelector('[data-b=cancel]').addEventListener('click', () => done(false));
      m.body.querySelector('[data-b=ok]').addEventListener('click', () => done(true));
      const obs = new MutationObserver(() => {
        if (!document.body.contains(m.el)) { obs.disconnect(); if (!settled) { settled = true; resolve(false); } }
      });
      obs.observe(document.body, { childList: true });
    });
  }

  async importCsv() {
    const p = await window.mazz.invoke('dialog:openFile', { filters: [{ name: 'CSV', extensions: ['csv', 'tsv'] }] }).catch(() => null);
    if (!p) return;
    try {
      const text = await window.mazz.invoke('fs:readFile', { path: p });
      const rows = parseCsvTasks(text, this.genre);
      const gate = factoryBatchGate(rows.length);
      if (!(await this.confirmBatchImport(gate))) return;
      const baseTime = Date.now();
      const maxMode = this.el.querySelector('.fc-maxmode').checked;
      const maxChapters = +this.el.querySelector('.fc-maxchapters').value || 0;
      const exportFmt = this.el.querySelector('.fc-exportfmt')?.value || 'md';
      for (const [i, rowValues] of rows.entries()) {
        const values = { ...rowValues, 每章字数: rowValues['每章字数'] || String(this.lengthPlan.wordsPerUnit) };
        this.tasks.push({
          id: 't' + (baseTime + i).toString(36) + Math.random().toString(36).slice(2, 5),
          createdAt: baseTime + i,
          genreId: this.genre.id,
          label: fieldValue(this.genre, values, '书名', 'title', 'subject', 'task', 'premise') || this.genre.name,
          values, dump: '', mode: maxMode ? 'max' : 'single', maxChapters, status: 'pending', doneChapters: 0,
          totalWords: this.lengthPlan.totalWords, wordsPerUnit: this.lengthPlan.wordsPerUnit,
          lengthPreset: this.lengthPlan.preset, exportFmt, autoPreview: this.autoPreview,
          reviewProtocol: W68_PROTOCOL,
          reviewRitual: this.el.querySelector('.fc-review-ritual')?.value || 'light',
          reviewBudgetCap: Math.max(0, +(this.el.querySelector('.fc-review-budget')?.value || 32000)),
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
          <span class="fc-task-label" title="${t.label}">${t.mode === 'max' ? '📖 ' : '📄 '}${t.label}${t.mode === 'max' && t.doneChapters ? ` [${t.doneChapters}${getSnapshotSchema(this.genres.find(g => g.id === t.genreId) || {}).unitName}]` : ''}${t.manualRevision?.count ? ` · ✎人工修订×${t.manualRevision.count}` : ''}</span>
          <span class="fc-task-status">${STATUS[t.status] || t.status}</span>
          ${t.mode === 'max' && t.doneChapters ? `<button class="fc-mini" data-retry="${i}" title="重试某一内容单元/蓝图">↻</button>` : ''}
        </div>`).join('')
      : '<div class="fc-empty">（队列为空——点上方「新建立项」创建一次性项目）</div>';
    this.taskListEl.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const task = this.tasks[+b.dataset.retry];
      const unitName = getSnapshotSchema(this.genres.find(g => g.id === task.genreId) || {}).unitName;
      const ans = await inputModal(`重试「${task.label}」：已写 ${task.doneChapters} ${unitName}。输入要重写的${unitName}号；0 = 重新生成全书蓝图`);
      if (ans == null) return;
      const n = parseInt(ans, 10);
      if (isNaN(n) || n < 0) { toast('输入无效'); return; }
      const tpl = this.genres.find(g => g.id === task.genreId) || this.genre;
      if (!this.claimTask(task)) return;
      task.status = 'running';
      this.renderTasks();
      try {
        if (n === 0) await this.runMaxTask(task, tpl, this.el.querySelector('.fc-dualloop').checked, null, -1);
        else await this.runMaxTask(task, tpl, this.el.querySelector('.fc-dualloop').checked, null, n);
        if (task.status === 'done' || task.status === 'done-warn') await this.finishTaskPreview(task);
      } catch (err) { task.status = 'failed'; this.log('重试失败：' + err.message); await this.finishTaskPreview(task, err.message).catch(() => {}); }
      finally { this.releaseTask(task); }
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
        cfg, role: 'chapter',
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
