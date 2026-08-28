const app = document.querySelector('#app');
const searchInput = document.querySelector('#global-search');
const modal = document.querySelector('#envelope-modal');
const modalTitle = document.querySelector('#modal-title');
const modalBody = document.querySelector('#modal-body');
const toast = document.querySelector('#toast');

const colors = {
  blue: '#5661e9', orange: '#d58d58', teal: '#2c9a9a', purple: '#8c76d8',
  green: '#6c9a6e', pink: '#c57a9a'
};

let data = null;
let toastTimer = null;
const state = {
  section: location.hash.slice(1) || 'discover',
  query: '',
  pubFilter: 'all',
  libraryTab: 'favorites',
  favorites: new Set(),
  following: new Set()
};

try {
  const saved = JSON.parse(localStorage.getItem('mazz-hub-preview-state') || '{}');
  state.favorites = new Set(Array.isArray(saved.favorites) ? saved.favorites : []);
  state.following = new Set(Array.isArray(saved.following) ? saved.following : []);
} catch { /* local preview stays usable when storage is unavailable */ }

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function initials(name) {
  return String(name || '').trim().slice(0, 1) || 'M';
}

function saveState() {
  localStorage.setItem('mazz-hub-preview-state', JSON.stringify({
    favorites: [...state.favorites], following: [...state.following]
  }));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2700);
}

function setSection(section) {
  state.section = section || 'discover';
  history.replaceState(null, '', `#${state.section}`);
  document.querySelectorAll('[data-section]').forEach((node) => {
    node.classList.toggle('is-active', node.dataset.section === state.section);
  });
  render();
  app.focus({ preventScroll: true });
}

function coverClass(pub) {
  return pub.cover === 'moon' ? 'cover-moon' : pub.cover === 'north' ? 'cover-north' : pub.cover === 'glass' ? 'cover-glass' : '';
}

function filteredPublications() {
  const query = state.query.trim().toLowerCase();
  return data.publications.filter((pub) => {
    const matchesFilter = state.pubFilter === 'all' || pub.editionType === state.pubFilter;
    if (!matchesFilter) return false;
    if (!query) return true;
    return [pub.title, pub.summary, pub.creator, pub.category, pub.publicationId].some((value) => String(value || '').toLowerCase().includes(query));
  });
}

function filteredWorlds() {
  const query = state.query.trim().toLowerCase();
  if (!query) return data.worlds;
  return data.worlds.filter((world) => [world.title, world.summary, world.authority, world.worldId].some((value) => String(value || '').toLowerCase().includes(query)));
}

function filteredCreators() {
  const query = state.query.trim().toLowerCase();
  if (!query) return data.creators;
  return data.creators.filter((creator) => [creator.name, creator.handle, creator.bio].some((value) => String(value || '').toLowerCase().includes(query)));
}

function pubCard(pub, compact = false) {
  const isFav = state.favorites.has(pub.publicationId);
  return `<article class="pub-card ${compact ? 'compact' : ''}">
    <button class="pub-cover ${coverClass(pub)}" style="--accent:${escapeHtml(pub.accent)}" data-action="open-publication" data-id="${escapeHtml(pub.publicationId)}" aria-label="打开 ${escapeHtml(pub.title)}">
      <span class="cover-format">${escapeHtml(pub.editionType)}</span>
      <span class="cover-version">v${escapeHtml(pub.version)} · public</span>
    </button>
    <div class="pub-body">
      <div class="pub-title-row">
        <h3 class="pub-title">${escapeHtml(pub.title)}</h3>
        <button class="mini-button ${isFav ? 'is-active' : ''}" data-action="favorite" data-id="${escapeHtml(pub.publicationId)}" aria-label="${isFav ? '取消收藏' : '收藏'}">${isFav ? '♥' : '♡'}</button>
      </div>
      <p class="pub-summary">${escapeHtml(pub.summary)}</p>
      <div class="pub-byline"><span class="creator-dot" style="background:${escapeHtml(pub.accent)}">${escapeHtml(initials(pub.creator))}</span><span>${escapeHtml(pub.creator)}</span><span>·</span><span>${escapeHtml(pub.category)}</span></div>
      <div class="pub-meta"><span>${escapeHtml(pub.readTime)} · 完成率 ${Math.round(pub.signals.completion * 100)}%</span><div class="pub-actions"><button class="mini-button" data-action="follow-creator" data-id="${escapeHtml(pub.creatorId)}" aria-label="关注 ${escapeHtml(pub.creator)}">＋</button><button class="mini-button" data-action="show-toast" data-message="阅读器将在本地 Publication runtime 接通">↗</button></div></div>
    </div>
  </article>`;
}

function worldCard(world) {
  return `<article class="world-card" style="--world-accent:${escapeHtml(world.accent)}">
    <span class="world-kicker">${escapeHtml(world.authority)}</span>
    <h3>${escapeHtml(world.title)}</h3>
    <p>${escapeHtml(world.summary)}</p>
    <div class="world-stats"><div><strong>${escapeHtml(world.branchCount)}</strong><span>Branches</span></div><div><strong>${escapeHtml(world.publicationCount)}</strong><span>Publications</span></div><div><strong>${escapeHtml(world.growth)}</strong><span>增长</span></div></div>
    <div class="world-footer"><span>${escapeHtml(world.factCount)} 条公开事实</span><button data-action="open-world" data-id="${escapeHtml(world.worldId)}">打开 World →</button></div>
  </article>`;
}

function creatorCard(creator) {
  const isFollowing = state.following.has(creator.creatorId);
  return `<article class="creator-card" style="--creator-accent:${escapeHtml(creator.accent)}"><div class="creator-avatar">${escapeHtml(initials(creator.name))}</div><h3>${escapeHtml(creator.name)}</h3><span class="creator-handle">${escapeHtml(creator.handle)}</span><p class="creator-bio">${escapeHtml(creator.bio)}</p><div class="creator-foot"><span><strong>${formatNumber(creator.works)}</strong> 作品</span><span><strong>${formatNumber(creator.followers)}</strong> 关注者</span><button class="mini-button ${isFollowing ? 'is-active' : ''}" data-action="follow-creator" data-id="${escapeHtml(creator.creatorId)}">${isFollowing ? '已关注' : '关注'}</button></div></article>`;
}

function chartPanel(title, items) {
  return `<section class="chart-panel"><div class="chart-panel-head"><h3>${escapeHtml(title)}</h3><small>${escapeHtml(data.charts.window)}</small></div>${items.map((item) => `<div class="metric"><div class="metric-line"><span>${escapeHtml(item.label)}</span><span>${escapeHtml(item.delta)}</span></div><div class="metric-track"><div class="metric-fill" style="width:${Math.min(100, item.value)}%;--metric-color:${colors[item.tone] || colors.blue}"></div></div></div>`).join('')}</section>`;
}

function pageHead(eyebrow, title, description, actions = '') {
  return `<div class="page-head"><div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
}

function discoverView() {
  const featured = data.featured.map((id) => data.publications.find((pub) => pub.publicationId === id)).filter(Boolean);
  return `${pageHead('MAZZHUB · PUBLIC PLANE', '让作品继续生长。', '发现经过显式 Promotion 的作品、World 与创作关系。这里展示的是公共投影，不是任何人的私有工作区。', '<button class="button button-ghost" data-action="show-envelope">公共包络</button><button class="button button-primary" data-action="show-toast" data-message="本地预览：Creator Studio 暂未连接写入">创建 Publication</button>')}
    <section class="hero"><div><span class="eyebrow">LOCAL-FIRST CONTENT NETWORK</span><h1>本地是家，<br/>Hub 是广场。</h1><p>Publication 是作品身份；HTTP、P2P、LAN、NAS 与 VPS 只是路。先看见可靠的公共事实，再决定要不要继续创作。</p><div class="hero-actions"><button class="button button-primary" data-section="publications">浏览作品 ↗</button><button class="button button-ghost" data-section="worlds">探索 Worlds</button></div></div><div class="hero-art"><div class="orbit-card"><div class="orbit-node">作品<br/>Publication</div><div class="orbit-node">World</div><div class="orbit-node">Feed</div></div></div></section>
    <section class="section-block"><div class="section-title"><div><h2>编辑精选</h2><p>只读 public envelope · 不含草稿与本地路径</p></div><button data-section="publications">查看全部 →</button></div><div class="pub-grid">${featured.map((pub) => pubCard(pub)).join('')}</div></section>
    <section class="section-block"><div class="section-title"><div><h2>正在生长的 Worlds</h2><p>Authority Map 与 Audience Map 分开呈现</p></div><button data-section="worlds">打开世界地图 →</button></div><div class="world-grid">${data.worlds.map(worldCard).join('')}</div></section>
    <section class="section-block"><div class="section-title"><div><h2>透明 Charts</h2><p>Attention 与 Creation 不合并成 Overall Score</p></div><button data-section="charts">展开规则 →</button></div><div class="chart-strip">${chartPanel('Audience signals', data.charts.attention)}${chartPanel('Creation signals', data.charts.creation)}</div></section>
    <section class="section-block"><div class="section-title"><div><h2>公共事件 Feed</h2><p>事件独立于 Publication 内容，不重发整部作品</p></div><button data-action="show-toast" data-message="事件 Feed 当前为本地 fixture">查看 Feed →</button></div><div class="activity-list">${data.events.map((event) => `<div class="activity-row"><span class="activity-icon">${event.type === 'version' ? '↻' : event.type === 'branch' ? '◇' : '◎'}</span><span>${escapeHtml(event.label)}</span><time>${escapeHtml(event.time)}</time></div>`).join('')}</div></section>`;
}

function publicationsView() {
  const pubs = filteredPublications();
  return `${pageHead('PUBLICATIONS', '作品库', '每一张卡片都对应一个可验证的 Publication 身份；版本、许可证与来源关系保持可见。', '<button class="button button-ghost" data-action="show-envelope">身份字段</button>')}
    <div class="filter-bar">${[['all', '全部'], ['text', '文字'], ['epub', 'EPUB'], ['video', '视频']].map(([value, label]) => `<button class="filter-button ${state.pubFilter === value ? 'is-active' : ''}" data-action="pub-filter" data-filter="${value}">${label}</button>`).join('')}</div>
    ${pubs.length ? `<div class="pub-grid four">${pubs.map((pub) => pubCard(pub)).join('')}</div>` : '<div class="empty-state"><strong>没有匹配的公开投影</strong><p>换一个关键词，或者清除筛选后再试。</p></div>'}`;
}

function worldsView() {
  const worlds = filteredWorlds();
  return `${pageHead('WORLDS · BRANCH GOVERNANCE', 'World 地图', 'World 是可选的持续上下文。Fork 可以自由发生，Canon Merge 保留 Root Authority 与完整 provenance。', '<button class="button button-ghost" data-action="show-toast" data-message="World Package 获取将在本地 workspace bridge 接通">在 Mazz 中打开</button>')}
    <div class="world-grid">${worlds.length ? worlds.map(worldCard).join('') : '<div class="empty-state"><strong>没有匹配的 World</strong><p>搜索标题、分支或公开事实。</p></div>'}</div>
    <section class="section-block"><div class="section-title"><div><h2>两张地图，两个问题</h2><p>Authority Map 说明谁能推进 Canon；Audience Map 说明谁在关注与衍生。</p></div></div><div class="chart-layout"><div class="rules-card"><span class="eyebrow">AUTHORITY MAP</span><h3>Fork 权尽量自由，Merge 权严格归属。</h3><p>Branch、Proposal、Review 和 Merge 都是独立事实。热门、播放量与 Factory Pass 不会自动成为 Canon。</p><span class="rule-chip">Root Canon</span><span class="rule-chip">Authorized Branch</span><span class="rule-chip">Community Derivative</span><button data-action="show-envelope">查看治理字段 →</button></div><div class="leaderboard"><h3>Audience Map</h3><p class="leaderboard-sub">近 30 天公开衍生信号</p>${data.worlds.map((world, index) => `<div class="rank-row"><span class="rank-num">0${index + 1}</span><div class="rank-main"><strong>${escapeHtml(world.title)}</strong><span>${escapeHtml(world.branchCount)} branches · ${escapeHtml(world.growth)} growth</span></div><span class="rank-value">${escapeHtml(world.publicationCount)} works</span></div>`).join('')}</div></div></section>`;
}

function chartsView() {
  return `${pageHead('CHARTS · EXPLAINABLE DISCOVERY', '透明 Charts', '榜单是公共事实的版本化投影，不是黑盒裁判。你可以看到指标、时间窗与变化来源。', '<button class="button button-primary" data-action="show-toast" data-message="自定义权重将在 Charts runtime 接通">调整维度</button>')}
    <div class="chart-layout"><div><div class="chart-strip">${chartPanel('Attention value', data.charts.attention)}${chartPanel('Creation value', data.charts.creation)}</div><section class="section-block"><div class="section-title"><div><h2>当前上升</h2><p>${escapeHtml(data.charts.window)}</p></div></div><div class="leaderboard">${data.publications.slice(0, 4).map((pub, index) => `<div class="rank-row"><span class="rank-num">${String(index + 1).padStart(2, '0')}</span><div class="rank-main"><strong>${escapeHtml(pub.title)}</strong><span>${escapeHtml(pub.creator)} · ${escapeHtml(pub.category)}</span></div><span class="rank-value">+${Math.round(pub.signals.completion * 23)}%</span></div>`).join('')}</div></section></div><aside class="rules-card"><span class="eyebrow">FORMULA / v0.1</span><h3>看得懂，才算发现。</h3><p>Charts 按指标、样本、窗口与衰减规则计算。Attention 与 Creation 分开，任何一项都不能越权修改 Canon。</p><span class="rule-chip">指标可展开</span><span class="rule-chip">公式有版本</span><span class="rule-chip">不设 Overall Score</span><span class="rule-chip">支持重算</span><button data-action="show-envelope">查看计算说明 →</button></aside></div>`;
}

function creatorsView() {
  return `${pageHead('CREATORS', '创作者', '稳定的 Creator 身份把作品、World 与公共事件聚合起来；关注关系不改变作品所有权。', '<button class="button button-ghost" data-action="show-toast" data-message="登录与账号系统暂不连接">导入本地身份</button>')}
    <div class="creator-grid">${filteredCreators().map(creatorCard).join('')}</div>`;
}

function libraryView() {
  const favorites = data.publications.filter((pub) => state.favorites.has(pub.publicationId));
  const following = data.creators.filter((creator) => state.following.has(creator.creatorId));
  return `${pageHead('YOUR SPACE · LOCAL ONLY', '收藏与历史', '这些操作只写入浏览器本地状态，不会回传 Hub，也不会改变任何 Publication 投影。')}
    <div class="library-tabs"><button class="library-tab ${state.libraryTab === 'favorites' ? 'is-active' : ''}" data-action="library-tab" data-tab="favorites">收藏的作品 (${favorites.length})</button><button class="library-tab ${state.libraryTab === 'following' ? 'is-active' : ''}" data-action="library-tab" data-tab="following">关注的创作者 (${following.length})</button></div>
    ${state.libraryTab === 'favorites' ? (favorites.length ? `<div class="pub-grid four">${favorites.map((pub) => pubCard(pub)).join('')}</div>` : '<div class="empty-state"><strong>还没有收藏</strong><p>在作品卡片上点 ♡，收藏会留在这个浏览器里。</p></div>') : (following.length ? `<div class="creator-grid">${following.map(creatorCard).join('')}</div>` : '<div class="empty-state"><strong>还没有关注创作者</strong><p>在作品卡片或创作者页点“关注”。</p></div>')}`;
}

function render() {
  if (!data) return;
  const views = { discover: discoverView, publications: publicationsView, worlds: worldsView, charts: chartsView, creators: creatorsView, library: libraryView };
  app.innerHTML = (views[state.section] || discoverView)();
}

function showEnvelope(publicationId = null) {
  let title = '公共包络';
  let body = `<div class="envelope-grid"><div class="envelope-field"><span>schema</span><strong>mazz.publication-envelope/v1</strong></div><div class="envelope-field"><span>visibility</span><strong>public · metadata-only</strong></div><div class="envelope-field"><span>identity</span><strong>Publication ID ≠ URL</strong></div><div class="envelope-field"><span>authority</span><strong>explicit Publication Grant</strong></div></div><p class="modal-note">本地预览只展示公开字段。草稿、Agent transcript、绝对路径、凭据、私钥与未发布 Rights 不会进入公共投影。</p>`;
  if (publicationId) {
    const pub = data.publications.find((item) => item.publicationId === publicationId);
    if (pub) {
      title = pub.title;
      body = `<div class="envelope-grid"><div class="envelope-field wide"><span>publicationId</span><strong>${escapeHtml(pub.publicationId)}</strong></div><div class="envelope-field"><span>workId</span><strong>${escapeHtml(pub.workId)}</strong></div><div class="envelope-field"><span>version</span><strong>v${escapeHtml(pub.version)} · ${escapeHtml(pub.editionType)}</strong></div><div class="envelope-field"><span>manifest</span><strong>${escapeHtml(pub.contentManifestRef)}</strong></div><div class="envelope-field"><span>grant</span><strong>${escapeHtml(pub.publicationGrantRef)}</strong></div><div class="envelope-field"><span>provenance</span><strong>${escapeHtml(pub.provenance)}</strong></div><div class="envelope-field wide"><span>contentIds</span><strong>${escapeHtml(pub.contentIds.join(' · '))}</strong></div></div><p class="modal-note">${escapeHtml(pub.summary)}<br/>版本更新、撤回与重同步都通过 receipt 记录；本页面 fixture 不执行公共写入。</p>`;
    }
  }
  modalTitle.textContent = title;
  modalBody.innerHTML = body;
  if (typeof modal.showModal === 'function') modal.showModal(); else modal.setAttribute('open', '');
}

document.addEventListener('click', (event) => {
  const sectionNode = event.target.closest('[data-section]');
  if (sectionNode) {
    event.preventDefault();
    setSection(sectionNode.dataset.section);
    return;
  }
  const actionNode = event.target.closest('[data-action]');
  if (!actionNode) return;
  const action = actionNode.dataset.action;
  if (action === 'favorite') {
    const id = actionNode.dataset.id;
    state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
    saveState(); render(); showToast(state.favorites.has(id) ? '已加入本地收藏' : '已取消收藏');
  } else if (action === 'follow-creator') {
    const id = actionNode.dataset.id;
    state.following.has(id) ? state.following.delete(id) : state.following.add(id);
    saveState(); render(); showToast(state.following.has(id) ? '已关注创作者' : '已取消关注');
  } else if (action === 'open-publication') showEnvelope(actionNode.dataset.id);
  else if (action === 'open-world') showToast('World Package 预览：保留 Root / Branch / Proposal 边界');
  else if (action === 'show-envelope') showEnvelope();
  else if (action === 'close-modal') modal.close();
  else if (action === 'show-toast') showToast(actionNode.dataset.message || '本地预览动作');
  else if (action === 'pub-filter') { state.pubFilter = actionNode.dataset.filter; render(); }
  else if (action === 'library-tab') { state.libraryTab = actionNode.dataset.tab; render(); }
});

searchInput.addEventListener('input', () => { state.query = searchInput.value; render(); });
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== searchInput && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) { event.preventDefault(); searchInput.focus(); }
  if (event.key === 'Escape' && modal.open) modal.close();
});

fetch('./fixture.json').then((response) => {
  if (!response.ok) throw new Error(`fixture ${response.status}`);
  return response.json();
}).then((fixture) => { data = fixture; render(); }).catch((error) => {
  app.innerHTML = `<div class="empty-state"><strong>本地 fixture 读取失败</strong><p>${escapeHtml(error.message)}</p></div>`;
});
