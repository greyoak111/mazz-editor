import { contextKeys } from '../../core/contextkey-service.js';
import { toast } from '../../shell/shell.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const instances = new Map();
let current = null;

function renderPreview(root, preview) {
  const host = root.querySelector('.org-preview');
  if (!preview) { host.innerHTML = '<div class="org-empty">填写目标、约束与预算后生成组织预览。预览不会启动 Agent、工具或发布。</div>'; return; }
  const seats = preview.organization.seats || [];
  const gates = preview.organization.gates || [];
  const artifacts = preview.organization.artifacts || [];
  host.innerHTML = `
    <section><h3>${esc(preview.workflow.name)}</h3><p>${esc(preview.intent.goal)}</p>
      <div class="org-badges"><span>${esc(preview.workflow.domain)}</span><span>${esc(preview.workflow.deliverableType)}</span><span>${preview.gaps.blocked ? '有缺件' : '可编译'}</span><span>仅预览</span></div></section>
    <section><h4>组织与责任</h4><div class="org-grid">${seats.map(row => `<article><b>${esc(row.label)}</b><small>${esc(row.teamId)}</small><p>${esc(row.responsibility)}</p><code>${esc(row.outputArtifactIds.join(' · '))}</code></article>`).join('')}</div></section>
    <section><h4>工件 DAG 与 Gate</h4><div class="org-columns"><div>${artifacts.map(row => `<div class="org-row"><b>${esc(row.label)}</b><small>${esc(row.dependsOn.join(' ← ') || '输入根')}</small></div>`).join('')}</div><div>${gates.map(row => `<div class="org-row"><b>${esc(row.label)}</b><small>${esc(row.authorityRef)} · 不可绕过</small></div>`).join('')}</div></div></section>
    <section><h4>成本、缺件与人工签发</h4><p>声明成本 ${esc(preview.estimate.currency)} ${preview.estimate.declaredExecutorCost} / 预算 ${preview.estimate.budgetLimit}；${preview.estimate.withinBudget ? '预算内' : '需调整预算或路由'}。</p>
      <p>不可用执行者：${esc(preview.gaps.unavailableExecutors.join('、') || '无')}；缺能力：${esc(preview.gaps.missingCapabilities.join('、') || '无')}。</p>
      <p>运行真相归 W73；当前未启动执行、未授予外部修改或 Publication。</p></section>`;
}

function create(container) {
  const root = document.createElement('div');
  root.className = 'org-root';
  root.innerHTML = `
    <style>
      .org-root{height:100%;overflow:auto;padding:22px;background:var(--bg);color:var(--fg);font:14px/1.5 var(--font-ui)}.org-shell{max-width:1180px;margin:auto}.org-head{display:flex;gap:14px;align-items:end;flex-wrap:wrap;padding:18px;border:1px solid var(--border);border-radius:12px;background:var(--bg-elev);box-shadow:var(--shadow)}.org-field{display:grid;gap:5px;min-width:180px;flex:1;color:var(--fg-dim)}.org-field.wide{flex:2}.org-field input,.org-field select{min-height:38px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:7px;padding:9px}.org-field input:focus-visible,.org-field select:focus-visible,.org-actions button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.org-actions{display:flex;gap:8px;flex-wrap:wrap}.org-actions button{min-height:38px;border:1px solid var(--accent);background:var(--accent);color:var(--accent-fg);border-radius:7px;padding:9px 13px;cursor:pointer}.org-actions button:hover{filter:brightness(1.06)}.org-actions button.secondary{border-color:var(--border);background:var(--bg);color:var(--fg)}.org-actions button.secondary:hover{background:var(--bg-hover);filter:none}.org-preview{display:grid;gap:14px;margin-top:16px}.org-preview section{border:1px solid var(--border);background:var(--bg-elev);border-radius:10px;padding:16px}.org-preview h3,.org-preview h4{margin:0 0 9px}.org-badges{display:flex;gap:7px;flex-wrap:wrap}.org-badges span{border:1px solid var(--border);background:var(--accent-soft);color:var(--fg);border-radius:999px;padding:2px 8px}.org-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:9px}.org-grid article,.org-row{border:1px solid var(--border);border-radius:8px;padding:10px;background:var(--bg)}.org-grid small,.org-grid code,.org-row small{display:block;color:var(--fg-dim);margin-top:4px}.org-columns{display:grid;grid-template-columns:1fr 1fr;gap:10px}.org-columns>div{display:grid;gap:7px}.org-empty{padding:40px;text-align:center;color:var(--fg-dim)}@media(max-width:760px){.org-root{padding:14px}.org-columns{grid-template-columns:1fr}.org-actions{width:100%}.org-actions button{flex:1 1 180px}}
    </style>
    <div class="org-shell"><h2>组织编译台</h2><p>从交付目标出发，先检查组织、责任、工件、Gate、成本与缺件；不从“创建几个 Agent”起步。</p>
      <div class="org-head">
        <label class="org-field wide">目标交付物<input data-f="goal" value="制作一个可审计的本地交付物"></label>
        <label class="org-field">工作流<select data-f="template"></select></label>
        <label class="org-field">执行者<select data-f="executor"><option value="">按工作流默认路由</option></select></label>
        <label class="org-field">预算（CNY）<input data-f="budget" type="number" min="0" value="500"></label>
        <div class="org-actions"><button data-a="preview">编译预览</button><button class="secondary" data-a="save">存入本地工作流库</button><button class="secondary" data-a="inspect-maz">检查 .maz</button><button class="secondary" data-a="simulate-physical">物理生产模拟</button></div>
      </div><div class="org-preview"></div>
    </div>`;
  container.appendChild(root);
  const state = { root, templates: [], preview: null, disposed: false };
  instances.set(container, state);
  const templateEl = root.querySelector('[data-f=template]');
  const executorEl = root.querySelector('[data-f=executor]');
  const syncExecutors = () => {
    const template = state.templates.find(row => row.id === templateEl.value);
    executorEl.innerHTML = '<option value="">按工作流默认路由</option>' + (template?.executors || []).map(id => `<option value="${esc(id)}">${esc(id)}</option>`).join('');
  };
  const payload = () => ({
    goal: root.querySelector('[data-f=goal]').value,
    templateId: templateEl.value,
    executorRef: executorEl.value,
    budget: Number(root.querySelector('[data-f=budget]').value) || 0,
    authorityRef: 'human:workflow-owner',
  });
  state.ready = window.mazz.invoke('organization:templates').then(rows => {
    if (state.disposed) return;
    state.templates = rows;
    templateEl.innerHTML = rows.map(row => `<option value="${esc(row.id)}">${esc(row.label)} · ${esc(row.deliverable)}</option>`).join('');
    syncExecutors(); renderPreview(root, null);
  });
  templateEl.addEventListener('change', syncExecutors);
  root.querySelector('[data-a=preview]').addEventListener('click', async () => {
    try { state.preview = await window.mazz.invoke('organization:preview', payload()); renderPreview(root, state.preview); }
    catch (error) { toast(error.message || String(error)); }
  });
  root.querySelector('[data-a=save]').addEventListener('click', async () => {
    try {
      const result = await window.mazz.invoke('organization:save', payload());
      state.preview = result.preview; renderPreview(root, state.preview);
      toast(`已存入本地工作流库：${result.record.workflowId}@${result.record.version}`);
    } catch (error) { toast(error.message || String(error)); }
  });
  root.querySelector('[data-a=inspect-maz]').addEventListener('click', async () => {
    try {
      const picked = await window.mazz.invoke('dialog:openFile', { filters: [{ name: 'Mazz 生产资料', extensions: ['maz'] }] });
      if (!picked) return;
      const result = await window.mazz.invoke('mazAsset:inspect', { path: picked });
      const profile = result.manifest?.profile || result.detected?.profile || 'unknown';
      const lines = [
        `<section><h3>.maz 只读检查</h3><div class="org-badges"><span>${esc(profile)}</span><span>${result.detected?.legacy ? 'legacy' : 'production asset'}</span><span>${result.blockers?.length ? '已阻断' : '完整性通过'}</span></div>`,
        `<p>${esc(result.path)} · ${result.packageBytes} bytes · ${result.entries.length} entries</p>`,
        `<p>package SHA-256：<code>${esc(result.packageDigest)}</code></p>`,
        `<p>阻断：${esc((result.blockers || []).join('；') || '无')}。本次 codeExecuted=false，不授予信任或执行权。</p></section>`,
      ];
      root.querySelector('.org-preview').innerHTML = lines.join('');
    } catch (error) { toast(error.message || String(error)); }
  });
  root.querySelector('[data-a=simulate-physical]').addEventListener('click', async () => {
    try {
      const [result, gate] = await Promise.all([
        window.mazz.invoke('physicalSimulation:sampleI'),
        window.mazz.invoke('physicalSimulation:safetyReviewGate'),
      ]);
      root.querySelector('.org-preview').innerHTML = `<section><h3>物理生产 Capability 模拟</h3>
        <div class="org-badges"><span>SIMULATION ONLY</span><span>${esc(result.safeDecision.state)}</span><span>${esc(result.unsafeDecision.state)}</span><span>${esc(gate.state)}</span></div>
        <p>Machine A 故障；兼容性查询选择 ${esc(result.selectedExecutor)} + Human inspection。危险 Machine C 因校准/认证/安全级缺失被拒绝。</p>
        <p>安全提议：${esc(result.safeDecision.reasons.join('、') || '允许')}；越界提议：${esc(result.unsafeDecision.reasons.join('、'))}。</p>
        <p>controllerCommandsProduced=${result.controllerCommandsProduced}；realDeviceWrites=${result.realDeviceWrites}；Factory override=${result.factoryOverrideAllowed}。</p>
        <p>现场激活不获授权；必须另经独立安全工程、责任主体、法规分析、认证设备、隔离网络和人工最终签发。</p></section>`;
    } catch (error) { toast(error.message || String(error)); }
  });
  return state;
}

const moduleDef = {
  displayName: '组织编译台', icon: '⌘', iconId: 'organization',
  create,
  activate(container, state) { current = state; contextKeys.set('module', 'organization'); },
  deactivate(_container, state) { if (current === state) current = null; },
  dispose(state) { state.disposed = true; state.root?.remove(); },
  getContent() { return current?.preview ? JSON.stringify(current.preview, null, 2) : ''; },
  setContent() {},
  newDocument() { return ''; },
  contributes: {
    commands: [{ id: 'factory.openOrganization', title: '打开组织编译台', icon: '⌘', group: '智能创作', run: () => window.MazzShell?.openTab('organization', { title: '组织编译台' }) }],
  },
};

export default moduleDef;
