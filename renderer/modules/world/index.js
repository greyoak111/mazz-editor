import { contextKeys } from '../../core/contextkey-service.js';
import { toast } from '../../shell/shell.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const instances = new Map();
let current = null;

function idPart(value, fallback = 'untitled') {
  return String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}
function artifactRef(row) { return `artifact:${String(row.contentHash || '').replace(/^sha256-/, 'sha256:')}`; }
function field(root, name) { return root.querySelector(`[name="${name}"]`)?.value?.trim() || ''; }

function renderWorlds(state) {
  const { root, world } = state;
  const worlds = world?.worlds || [];
  const proposals = world?.proposals || [];
  const branches = world?.branches || [];
  const artifactOptions = (state.publication?.artifacts || []).map(row => `<option value="${esc(row.artifactId)}">${esc(row.kind)} · ${esc(row.contentHash)}</option>`).join('');
  const worldOptions = worlds.map(row => `<option value="${esc(row.worldId)}">${esc(row.name)} · ${esc(row.worldId)}</option>`).join('');
  const branchOptions = branches.map(row => `<option value="${esc(row.branchId)}">${esc(row.branchId)}</option>`).join('');
  root.querySelector('[data-world-list]').innerHTML = worlds.length ? worlds.map(row => `
    <article class="world-card"><header><b>${esc(row.name)}</b><span>${esc(row.canonVersion)}</span></header><p>${esc(row.description || '无说明')}</p>
      <small>${row.branchIds.length} branches · ${esc(row.worldId)}</small></article>`).join('') : '<div class="world-empty">当前 Workspace 还没有 World。创建只写本地 World Store，不触网。</div>';
  root.querySelector('[data-proposal-list]').innerHTML = proposals.length ? proposals.map(row => {
    const open = ['proposed', 'under-review'].includes(row.status);
    const accepted = ['accepted', 'partially-merged'].includes(row.status);
    return `<article class="world-card" data-proposal="${esc(row.proposalId)}"><header><b>${esc(row.status)}</b><span>${esc(row.branchId)}</span></header>
      <p>${row.changes.map(change => `${esc(change.domain)} · ${esc(change.revision)}`).join('<br>')}</p><small>${esc(row.proposalId)}</small>
      <div class="world-actions">${open ? '<button data-a="accept">采纳</button><button class="secondary" data-a="reject">拒绝</button><button class="secondary" data-a="withdraw-proposal">撤回提案</button>' : ''}${accepted ? '<button data-a="merge">合并 Canon</button>' : ''}</div></article>`;
  }).join('') : '<div class="world-empty">暂无 Canon 提案。</div>';
  root.querySelector('[name="forkWorld"]').innerHTML = worldOptions || '<option value="">暂无 World</option>';
  root.querySelector('[name="forkSource"]').innerHTML = branchOptions || '<option value="">暂无 Branch</option>';
  root.querySelector('[name="proposalWorld"]').innerHTML = worldOptions || '<option value="">暂无 World</option>';
  root.querySelector('[name="proposalBranch"]').innerHTML = branchOptions || '<option value="">暂无 Branch</option>';
  root.querySelector('[name="proposalArtifact"]').innerHTML = artifactOptions || '<option value="">暂无 Capability Artifact</option>';
}

function renderPublication(state) {
  const { root, publication } = state;
  const artifacts = publication?.artifacts || [];
  const drafts = publication?.drafts || [];
  root.querySelector('[name="publishArtifact"]').innerHTML = artifacts.length
    ? artifacts.map(row => `<option value="${esc(row.artifactId)}">${esc(row.kind)} · ${esc(row.mediaType)} · ${esc(row.contentHash)}</option>`).join('')
    : '<option value="">暂无不可变 Capability Artifact</option>';
  root.querySelector('[data-artifact-list]').innerHTML = artifacts.length ? artifacts.map(row => `
    <article class="world-card"><header><b>${esc(row.kind)}</b><span>${row.mutableHead ? '可变 head' : '不可变'}</span></header>
      <p>${esc(row.mediaType)} · ${esc(row.contentSchema)}</p><small>${esc(row.contentHash)}</small></article>`).join('') : '<div class="world-empty">先由计算、绘图、Canvas 或 Blender Capability 产生耐久 Artifact。</div>';
  root.querySelector('[data-draft-list]').innerHTML = drafts.length ? drafts.map(row => `
    <article class="world-card" data-publication="${esc(row.publicationId)}"><header><b>${esc(row.title)}</b><span>${esc(row.status)}</span></header>
      <p>${esc(row.visibility)} · ${esc(row.version)}</p><small>${esc(row.publicationId)}<br>${esc(row.keyId)}</small>
      <div class="world-actions">${row.status === 'prepared' ? '<button data-a="publish">发布到本地投影</button>' : ''}${row.status === 'published' ? '<button class="secondary" data-a="withdraw-publication">撤回发布</button>' : ''}</div></article>`).join('') : '<div class="world-empty">没有本地 Publication draft。</div>';
  root.querySelector('[data-local-status]').textContent = `本地 Hub r${publication?.hub?.revision || 0} · ${publication?.hub?.projections?.length || 0} projections · 网络调用 ${publication?.networkCalls ?? 0}`;
}

async function refresh(state) {
  state.root.dataset.busy = '1';
  try {
    [state.world, state.publication] = await Promise.all([
      window.mazz.invoke('world:snapshot'), window.mazz.invoke('publicationBridge:snapshot'),
    ]);
    renderWorlds(state); renderPublication(state);
  } finally { delete state.root.dataset.busy; }
}

async function act(state, work) {
  try { await work(); await refresh(state); }
  catch (error) { toast(`${error?.code ? `${error.code}: ` : ''}${error?.message || error}`); }
}

function create(container) {
  const root = document.createElement('div');
  root.className = 'world-root';
  root.innerHTML = `
    <style>
      .world-root{height:100%;overflow:auto;background:var(--bg);color:var(--fg);font:14px/1.5 var(--font-ui);padding:20px}.world-shell{max-width:1320px;margin:auto}.world-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.world-head h2{margin:0}.world-head p{margin:4px 0;color:var(--fg-dim)}.world-grid{display:grid;grid-template-columns:minmax(320px,.9fr) minmax(460px,1.35fr);gap:14px;margin-top:14px}.world-pane{border:1px solid var(--border);border-radius:12px;background:var(--bg-elev);padding:15px;box-shadow:var(--shadow)}.world-pane h3{margin:0 0 10px}.world-form{display:grid;grid-template-columns:repeat(2,minmax(150px,1fr));gap:8px;margin-bottom:12px}.world-form .wide{grid-column:1/-1}.world-form label{display:grid;gap:4px;color:var(--fg-dim);font-size:12px}.world-form input,.world-form textarea,.world-form select{min-height:36px;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--fg);padding:7px 9px;font:inherit}.world-form textarea{min-height:64px;resize:vertical}.world-form button,.world-actions button,.world-head button{min-height:36px;border:1px solid var(--accent);border-radius:7px;background:var(--accent);color:var(--accent-fg);padding:7px 12px;cursor:pointer}.world-form button.secondary,.world-actions button.secondary,.world-head button{background:var(--bg);border-color:var(--border);color:var(--fg)}.world-list{display:grid;gap:8px;max-height:360px;overflow:auto}.world-card{border:1px solid var(--border);border-radius:9px;background:var(--bg);padding:10px}.world-card header{display:flex;justify-content:space-between;gap:8px}.world-card p{margin:6px 0}.world-card small{color:var(--fg-dim);overflow-wrap:anywhere}.world-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.world-empty{padding:24px;text-align:center;color:var(--fg-dim)}.world-divider{height:1px;background:var(--border);margin:14px 0}.world-local{border:1px solid var(--border);border-radius:999px;padding:4px 9px;color:var(--fg-dim);white-space:nowrap}.world-root[data-busy="1"]{cursor:progress}@media(max-width:900px){.world-grid{grid-template-columns:1fr}.world-form{grid-template-columns:1fr}}
    </style>
    <div class="world-shell">
      <header class="world-head"><div><h2>World 与本地发布</h2><p>Capability Artifact → 人工 Grant → 本机 Ed25519 → fake Hub；公共效果保持关闭。</p></div><button data-a="refresh">刷新</button></header>
      <div class="world-grid">
        <section class="world-pane"><h3>World / Canon</h3>
          <form class="world-form" data-form="create-world"><label>World 名称<input name="worldName" required placeholder="例如：港湾世界"></label><label>World ID（可空）<input name="worldId" placeholder="world:harbor"></label><label class="wide">说明<textarea name="worldDescription" required placeholder="这个 World 的本地创作上下文"></textarea></label><button class="wide">创建本地 World</button></form>
          <div class="world-list" data-world-list></div><div class="world-divider"></div>
          <form class="world-form" data-form="fork"><label>World<select name="forkWorld"></select></label><label>源 Branch<select name="forkSource"></select></label><label class="wide">新 Branch ID<input name="forkBranch" required placeholder="branch:community-draft"></label><button class="wide secondary">Fork Branch</button></form>
          <form class="world-form" data-form="proposal"><label>World<select name="proposalWorld"></select></label><label>Branch<select name="proposalBranch"></select></label><label class="wide">Artifact<select name="proposalArtifact"></select></label><label>领域<input name="proposalDomain" value="world"></label><label>提案人<input name="proposalHuman" value="human:local-owner"></label><button class="wide secondary">提交 Canon 提案</button></form>
          <div class="world-list" data-proposal-list></div>
        </section>
        <section class="world-pane"><div class="world-head"><h3>Artifact / Publication</h3><span class="world-local" data-local-status>本地 Hub</span></div>
          <div class="world-list" data-artifact-list></div><div class="world-divider"></div>
          <form class="world-form" data-form="prepare"><label class="wide">不可变 Artifact<select name="publishArtifact"></select></label><label>标题<input name="publishTitle" required></label><label>版本<input name="publishVersion" value="v1" required></label><label class="wide">公开摘要<textarea name="publishSummary" required></textarea></label><label>可见性<select name="publishVisibility"><option value="unlisted">不列出</option><option value="public">公开</option></select></label><label>权利引用<input name="publishLicense" value="license:user-owned" required></label><label>创作者<input name="publishCreator" value="creator:local-owner" required></label><label>人工授权<input name="publishAuthority" value="human:local-owner" required></label><label>World（可空）<input name="publishWorld" placeholder="world:..."></label><button class="wide">授权、签名并 Prepare</button></form>
          <div class="world-list" data-draft-list></div>
        </section>
      </div>
    </div>`;
  container.appendChild(root);
  const state = { root, container, world: null, publication: null, disposed: false };
  instances.set(container, state);

  root.addEventListener('click', event => {
    const button = event.target.closest('button[data-a]');
    if (!button) return;
    const action = button.dataset.a;
    if (action === 'refresh') void act(state, async () => {});
    const proposal = button.closest('[data-proposal]')?.dataset.proposal;
    if (proposal && ['accept', 'reject', 'withdraw-proposal', 'merge'].includes(action)) {
      void act(state, async () => {
        if (action === 'withdraw-proposal') return window.mazz.invoke('world:withdrawProposal', { proposalId: proposal, authorityRef: 'human:local-owner', reason: '人工撤回未裁决提案' });
        if (action === 'merge') {
          const row = state.world.proposals.find(item => item.proposalId === proposal);
          const acceptedRevisions = row.changes.map(item => item.revision).filter(revision => !(row.mergedRevisions || []).includes(revision));
          return window.mazz.invoke('world:mergeCanon', { proposalId: proposal, acceptedRevisions, authorityRef: 'human:local-owner', reason: '人工批准合并 Canon' });
        }
        return window.mazz.invoke('world:reviewProposal', { proposalId: proposal, action, authorityRef: 'human:local-owner', reason: action === 'accept' ? '人工核验后采纳' : '人工核验后拒绝' });
      });
    }
    const publicationId = button.closest('[data-publication]')?.dataset.publication;
    if (publicationId && action === 'publish') void act(state, () => window.mazz.invoke('publicationBridge:publish', { publicationId }));
    if (publicationId && action === 'withdraw-publication') void act(state, () => window.mazz.invoke('publicationBridge:withdraw', { publicationId }));
  });

  root.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.dataset.form === 'create-world') void act(state, () => {
      const name = field(form, 'worldName');
      return window.mazz.invoke('world:create', { worldId: field(form, 'worldId') || `world:${idPart(name)}`, name, description: field(form, 'worldDescription') });
    });
    if (form.dataset.form === 'fork') void act(state, () => window.mazz.invoke('world:fork', { worldId: field(form, 'forkWorld'), sourceBranchId: field(form, 'forkSource'), branchId: field(form, 'forkBranch') }));
    if (form.dataset.form === 'proposal') void act(state, () => {
      const artifact = state.publication.artifacts.find(row => row.artifactId === field(form, 'proposalArtifact'));
      if (!artifact) throw new Error('请选择 Capability Artifact');
      const ref = artifactRef(artifact);
      return window.mazz.invoke('world:proposeCanon', {
        worldId: field(form, 'proposalWorld'), branchId: field(form, 'proposalBranch'), proposedBy: field(form, 'proposalHuman'),
        changes: [{ domain: field(form, 'proposalDomain') || 'world', artifactRef: ref, revision: `rev:${artifact.contentHash.replace(/^sha256-/, '')}`, status: 'current' }], evidenceRefs: [ref],
      });
    });
    if (form.dataset.form === 'prepare') void act(state, () => window.mazz.invoke('publicationBridge:prepare', {
      artifactId: field(form, 'publishArtifact'), title: field(form, 'publishTitle'), summary: field(form, 'publishSummary'),
      version: field(form, 'publishVersion'), visibility: field(form, 'publishVisibility'), licenseRef: field(form, 'publishLicense'),
      creatorId: field(form, 'publishCreator'), authorityRef: field(form, 'publishAuthority'), worldRef: field(form, 'publishWorld') || undefined,
    }));
  });
  void refresh(state).catch(error => toast(error.message || String(error)));
  return state;
}

const moduleDef = {
  displayName: 'World 与本地发布', icon: '◎', iconId: 'world',
  create,
  activate(container, state) { current = state; contextKeys.set('module', 'world'); void refresh(state).catch(error => toast(error.message || String(error))); },
  deactivate(_container, state) { if (current === state) current = null; },
  dispose(state) { state.disposed = true; instances.delete(state.container); state.root?.remove(); },
  getContent(state) { return JSON.stringify({ mark: 'mazz-world-workbench-v1', revision: state?.world?.revision || 0 }); },
  setContent() {},
  newDocument() { return JSON.stringify({ mark: 'mazz-world-workbench-v1' }); },
  contributes: {
    commands: [
      { id: 'world.openWorkbench', title: '打开 World 与本地发布', icon: '◎', group: '智能创作', run: () => window.MazzShell?.openTab('world', { title: 'World 与本地发布' }) },
      { id: 'world.refreshWorkbench', title: '刷新 World 与本地发布', group: '智能创作', when: "module=='world'", run: () => current && refresh(current) },
    ],
    keybindings: [{ command: 'world.refreshWorkbench', key: 'ctrl+r', when: "module=='world'" }], menus: {}, bridges: [], aiActions: [],
  },
};

export default moduleDef;
