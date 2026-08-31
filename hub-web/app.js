const app = document.querySelector('#app');
const searchInput = document.querySelector('#global-search');
const modal = document.querySelector('#envelope-modal');
const modalTitle = document.querySelector('#modal-title');
const modalBody = document.querySelector('#modal-body');
const toast = document.querySelector('#toast');
const notificationCount = document.querySelector('#notification-count');

const STORAGE_KEY = 'mazz-hub-local-state-v2';
const colors = { blue: '#5661e9', orange: '#d58d58', teal: '#2c9a9a', purple: '#8c76d8', green: '#6c9a6e', pink: '#c57a9a' };

let data = null;
let hubSnapshot = null;
let hubError = '';
let toastTimer = null;

function parseHash() {
  const [section = 'discover', rawId = ''] = location.hash.slice(1).split('/');
  return { section: section || 'discover', selectedId: rawId ? decodeURIComponent(rawId) : '' };
}

const initialRoute = parseHash();
const state = {
  section: initialRoute.section,
  selectedId: initialRoute.selectedId,
  query: '',
  pubFilter: 'all',
  discoveryLane: 'explore',
  libraryTab: 'favorites',
  favorites: new Set(),
  following: new Set(),
  later: new Set(),
  progress: {},
  history: [],
  readNotifications: new Set(),
  blockedCreators: new Set(),
  reports: [],
  localComments: [],
  localNotifications: [],
  localWorldForks: new Set(),
  collections: [{ collectionId: 'collection:inspiration', title: '灵感架', publicationIds: [] }],
  studioPackages: []
};

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  for (const key of ['favorites', 'following', 'later', 'readNotifications', 'blockedCreators', 'localWorldForks']) state[key] = new Set(Array.isArray(saved[key]) ? saved[key] : []);
  for (const key of ['progress', 'history', 'reports', 'localComments', 'localNotifications', 'collections', 'studioPackages']) {
    if (saved[key] && typeof saved[key] === 'object') state[key] = saved[key];
  }
  if (!Array.isArray(state.collections) || !state.collections.length) state.collections = [{ collectionId: 'collection:inspiration', title: '灵感架', publicationIds: [] }];
} catch { /* local preview remains usable when browser storage is unavailable */ }

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function formatNumber(value) { return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value); }
function formatDate(value) { try { return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); } catch { return String(value || ''); } }
function initials(name) { return String(name || '').trim().slice(0, 1) || 'M'; }
function versionLabel(value) { const text = String(value ?? ''); return /^v/i.test(text) ? text : `v${text}`; }
function localCreator() {
  return { creatorId: 'creator:local-preview', name: '本地创作者', handle: '@local-preview', bio: '只存在于这台机器的 fake-Hub 身份投影。', works: localProjectionPublications().length, followers: 0, accent: '#8c76d8', joinedAt: '本机', analytics: { completion: '—', favoriteRate: '—', discussion: '—' } };
}
function localProjectionPublications() {
  return (hubSnapshot?.projections || []).filter((item) => item.status === 'published').map((item) => {
    const envelope = item.envelope;
    return {
      ...envelope,
      creator: '本地创作者', creatorHandle: '@local-preview', category: `本地 / ${envelope.editionType}`,
      tags: ['本地投影', envelope.editionType], seriesRef: null,
      readTime: `${item.manifest.blocks.length} blocks`,
      preview: ['公开内容字节没有进入网站数据库；作品详情只消费 public envelope 与 content-addressed manifest。'],
      versions: [{ version: envelope.version, publishedAt: envelope.publishedAt || item.updatedAt, note: '本地 fake-Hub Publication' }],
      signals: { completion: 0, favorites: 0, discussion: 0, derivatives: 0 }, accent: '#8c76d8', cover: 'local'
    };
  });
}
function allPublications() { return [...data.publications, ...localProjectionPublications().filter((local) => !data.publications.some((pub) => pub.publicationId === local.publicationId))]; }
function allCreators() { return localProjectionPublications().length ? [...data.creators, localCreator()] : data.creators; }
function publicCreator(id) { return allCreators().find((item) => item.creatorId === id); }
function publicPublication(id) { return allPublications().find((item) => item.publicationId === id); }
function publicWorld(id) { return data.worlds.find((item) => item.worldId === id); }
function allComments(id) { return [...data.comments, ...state.localComments].filter((item) => item.publicationId === id); }

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      favorites: [...state.favorites], following: [...state.following], later: [...state.later], progress: state.progress,
      history: state.history, readNotifications: [...state.readNotifications], blockedCreators: [...state.blockedCreators], reports: state.reports,
      localComments: state.localComments, localNotifications: state.localNotifications, localWorldForks: [...state.localWorldForks],
      collections: state.collections, studioPackages: state.studioPackages
    }));
  } catch { showToast('浏览器拒绝本地存储；本次状态只保留到页面关闭'); }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2800);
}

function updateChrome() {
  document.querySelectorAll('[data-section]').forEach((node) => node.classList.toggle('is-active', node.dataset.section === state.section));
  if (!data) return;
  const unread = [...data.notifications, ...state.localNotifications].filter((item) => !state.readNotifications.has(item.notificationId)).length;
  notificationCount.textContent = unread > 9 ? '9+' : String(unread);
  notificationCount.hidden = unread === 0;
}

function setSection(section, selectedId = '') {
  state.section = section || 'discover';
  state.selectedId = selectedId || '';
  history.replaceState(null, '', `#${state.section}${state.selectedId ? `/${encodeURIComponent(state.selectedId)}` : ''}`);
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
  app.focus({ preventScroll: true });
}

function visiblePublications() { return allPublications().filter((pub) => !state.blockedCreators.has(pub.creatorId)); }

function filteredPublications() {
  const query = state.query.trim().toLowerCase();
  return visiblePublications().filter((pub) => {
    if (state.pubFilter !== 'all' && pub.editionType !== state.pubFilter) return false;
    if (!query) return true;
    const series = data.series.find((item) => item.seriesId === pub.seriesRef);
    return [pub.title, pub.summary, pub.creator, pub.category, pub.publicationId, series?.title, ...(pub.tags || [])].some((value) => String(value || '').toLowerCase().includes(query));
  });
}

function filteredWorlds() {
  const query = state.query.trim().toLowerCase();
  if (!query) return data.worlds;
  return data.worlds.filter((world) => [world.title, world.summary, world.authority, world.worldId, ...(world.branches || []).map((branch) => branch.title)].some((value) => String(value || '').toLowerCase().includes(query)));
}

function filteredCreators() {
  const query = state.query.trim().toLowerCase();
  return allCreators().filter((creator) => !state.blockedCreators.has(creator.creatorId)).filter((creator) => !query || [creator.name, creator.handle, creator.bio].some((value) => String(value || '').toLowerCase().includes(query)));
}

function discoveryPublications() {
  const pubs = visiblePublications();
  if (state.discoveryLane === 'following') return pubs.filter((pub) => state.following.has(pub.creatorId));
  if (state.discoveryLane === 'charts') return [...pubs].sort((a, b) => b.signals.completion - a.signals.completion);
  if (state.discoveryLane === 'for-you') {
    const likedTags = new Set(pubs.filter((pub) => state.favorites.has(pub.publicationId)).flatMap((pub) => pub.tags || []));
    return [...pubs].sort((a, b) => (b.tags || []).filter((tag) => likedTags.has(tag)).length - (a.tags || []).filter((tag) => likedTags.has(tag)).length);
  }
  return data.featured.map(publicPublication).filter(Boolean);
}

function coverClass(pub) { return pub.cover === 'moon' ? 'cover-moon' : pub.cover === 'north' ? 'cover-north' : pub.cover === 'glass' ? 'cover-glass' : ''; }

function pubCard(pub, compact = false) {
  const isFav = state.favorites.has(pub.publicationId);
  const isLater = state.later.has(pub.publicationId);
  const isFollowing = state.following.has(pub.creatorId);
  const progress = Number(state.progress[pub.publicationId] || 0);
  return `<article class="pub-card ${compact ? 'compact' : ''}">
    <button class="pub-cover ${coverClass(pub)}" style="--accent:${escapeHtml(pub.accent)}" data-action="open-publication" data-id="${escapeHtml(pub.publicationId)}" aria-label="打开 ${escapeHtml(pub.title)}"><span class="cover-format">${escapeHtml(pub.editionType)}</span><span class="cover-version">${escapeHtml(versionLabel(pub.version))} · ${escapeHtml(pub.visibility)}</span>${progress ? `<span class="cover-progress">${progress}%</span>` : ''}</button>
    <div class="pub-body"><div class="pub-title-row"><h3 class="pub-title">${escapeHtml(pub.title)}</h3><button class="mini-button ${isFav ? 'is-active' : ''}" data-action="favorite" data-id="${escapeHtml(pub.publicationId)}" aria-label="${isFav ? '取消收藏' : '收藏'}">${isFav ? '♥' : '♡'}</button></div>
    <p class="pub-summary">${escapeHtml(pub.summary)}</p><button class="pub-byline link-button" data-action="open-creator" data-id="${escapeHtml(pub.creatorId)}"><span class="creator-dot" style="background:${escapeHtml(pub.accent)}">${escapeHtml(initials(pub.creator))}</span><span>${escapeHtml(pub.creator)}</span><span>·</span><span>${escapeHtml(pub.category)}</span></button>
    <div class="tag-row">${(pub.tags || []).slice(0, 3).map((tag) => `<button data-action="search-tag" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`).join('')}</div>
    <div class="pub-meta"><span>${progress ? `进度 ${progress}%` : pub.readTime}</span><div class="pub-actions"><button class="mini-button ${isLater ? 'is-active' : ''}" data-action="later" data-id="${escapeHtml(pub.publicationId)}" aria-label="${isLater ? '移出稍后' : '稍后'}">⌛</button><button class="mini-button ${isFollowing ? 'is-active' : ''}" data-action="follow-creator" data-id="${escapeHtml(pub.creatorId)}" aria-label="${isFollowing ? '取消关注' : `关注 ${pub.creator}`}">${isFollowing ? '✓' : '＋'}</button><button class="mini-button" data-action="open-publication" data-id="${escapeHtml(pub.publicationId)}">↗</button></div></div></div></article>`;
}

function worldCard(world) {
  const forked = state.localWorldForks.has(world.worldId);
  return `<article class="world-card" style="--world-accent:${escapeHtml(world.accent)}"><span class="world-kicker">${escapeHtml(world.authority)}</span><h3>${escapeHtml(world.title)}</h3><p>${escapeHtml(world.summary)}</p><div class="world-stats"><div><strong>${escapeHtml(world.branchCount)}</strong><span>Branches</span></div><div><strong>${escapeHtml(world.publicationCount)}</strong><span>Publications</span></div><div><strong>${escapeHtml(world.growth)}</strong><span>增长</span></div></div><div class="world-footer"><span>${forked ? '已加入本地 Fork 列表' : `${escapeHtml(world.factCount)} 条公开事实`}</span><button data-action="open-world" data-id="${escapeHtml(world.worldId)}">打开 World →</button></div></article>`;
}

function creatorCard(creator) {
  const isFollowing = state.following.has(creator.creatorId);
  return `<article class="creator-card" style="--creator-accent:${escapeHtml(creator.accent)}"><button class="creator-avatar" data-action="open-creator" data-id="${escapeHtml(creator.creatorId)}">${escapeHtml(initials(creator.name))}</button><button class="link-button creator-name" data-action="open-creator" data-id="${escapeHtml(creator.creatorId)}"><h3>${escapeHtml(creator.name)}</h3></button><span class="creator-handle">${escapeHtml(creator.handle)}</span><p class="creator-bio">${escapeHtml(creator.bio)}</p><div class="creator-foot"><span><strong>${formatNumber(creator.works)}</strong> 作品</span><span><strong>${formatNumber(creator.followers)}</strong> 关注者</span><button class="mini-button ${isFollowing ? 'is-active' : ''}" data-action="follow-creator" data-id="${escapeHtml(creator.creatorId)}">${isFollowing ? '已关注' : '关注'}</button></div></article>`;
}

function chartPanel(title, items) {
  return `<section class="chart-panel"><div class="chart-panel-head"><h3>${escapeHtml(title)}</h3><small>${escapeHtml(data.charts.window)}</small></div>${items.map((item) => `<button class="metric" data-action="show-formula"><div class="metric-line"><span>${escapeHtml(item.label)}</span><span>${escapeHtml(item.delta)}</span></div><div class="metric-track"><div class="metric-fill" style="width:${Math.min(100, item.value)}%;--metric-color:${colors[item.tone] || colors.blue}"></div></div></button>`).join('')}</section>`;
}

function pageHead(eyebrow, title, description, actions = '') { return `<div class="page-head"><div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`; }

function discoveryLane() {
  const lanes = [['following', 'Following'], ['for-you', 'For You'], ['charts', 'Charts'], ['explore', 'Explore']];
  return `<div class="discovery-lanes" aria-label="发现路径">${lanes.map(([id, label]) => `<button class="${state.discoveryLane === id ? 'is-active' : ''}" data-action="discovery-lane" data-lane="${id}">${label}</button>`).join('')}</div>`;
}

function discoverView() {
  const pubs = discoveryPublications();
  const laneMessage = state.discoveryLane === 'following' && !pubs.length ? '<div class="empty-state"><strong>关注流还是空的</strong><p>先关注一位创作者；Following 不会偷偷混入推荐。</p></div>' : `<div class="pub-grid">${pubs.map((pub) => pubCard(pub)).join('')}</div>`;
  return `${pageHead('MAZZHUB · LOCAL COMPLETE PLANE', '让作品继续生长。', '本地版已经把发现、消费连续性、互动、治理与 fake-Hub 发布闭成一圈；真实公共效果仍关闭。', '<button class="button button-ghost" data-action="show-envelope">公共包络</button><button class="button button-primary" data-section="studio">创建 Publication</button>')}${discoveryLane()}
    <section class="hero"><div><span class="eyebrow">LOCAL-FIRST CONTENT NETWORK</span><h1>本地是家，<br/>Hub 是广场。</h1><p>Publication 是作品身份；HTTP、P2P、LAN、NAS 与 VPS 只是路。关注、收藏、稍后、进度、评论和本地发布都有明确状态边界。</p><div class="hero-actions"><button class="button button-primary" data-section="publications">浏览作品 ↗</button><button class="button button-ghost" data-section="worlds">探索 Worlds</button></div></div><div class="hero-art"><div class="orbit-card"><div class="orbit-node">作品<br/>Publication</div><div class="orbit-node">World</div><div class="orbit-node">Feed</div></div></div></section>
    <section class="section-block"><div class="section-title"><div><h2>${state.discoveryLane === 'following' ? '关注更新' : state.discoveryLane === 'for-you' ? '本地可解释推荐' : state.discoveryLane === 'charts' ? '透明榜单入口' : '编辑精选'}</h2><p>${state.discoveryLane === 'for-you' ? '只按你的本地收藏标签排序，可随时清空' : '公共包络 · 不含草稿与本地路径'}</p></div><button data-section="publications">查看全部 →</button></div>${laneMessage}</section>
    <section class="section-block"><div class="section-title"><div><h2>正在生长的 Worlds</h2><p>Authority Map 与 Audience Map 分开呈现</p></div><button data-section="worlds">打开世界地图 →</button></div><div class="world-grid">${data.worlds.map(worldCard).join('')}</div></section>
    <section class="section-block"><div class="section-title"><div><h2>透明 Charts</h2><p>Attention 与 Creation 不合并成 Overall Score</p></div><button data-section="charts">展开规则 →</button></div><div class="chart-strip">${chartPanel('Audience signals', data.charts.attention)}${chartPanel('Creation signals', data.charts.creation)}</div></section>
    <section class="section-block"><div class="section-title"><div><h2>公共事件 Feed</h2><p>事件独立于 Publication 内容，不重发整部作品</p></div><button data-section="inbox">查看通知 →</button></div><div class="activity-list">${data.events.map((event) => `<button class="activity-row" data-action="open-ref" data-ref="${escapeHtml(event.ref)}"><span class="activity-icon">${event.type === 'version' ? '↻' : event.type === 'branch' ? '◇' : '◎'}</span><span>${escapeHtml(event.label)}</span><time>${escapeHtml(event.time)}</time></button>`).join('')}</div></section>`;
}

function publicationsView() {
  const pubs = filteredPublications();
  const tags = [...new Set(allPublications().flatMap((pub) => pub.tags || []))];
  return `${pageHead('PUBLICATIONS', '作品库', 'Publication 是稳定作品身份；标签、系列、版本、许可证与来源关系均可进入详情核验。', '<button class="button button-ghost" data-section="series">系列与合集</button><button class="button button-ghost" data-action="show-envelope">身份字段</button>')}<div class="filter-row"><div class="filter-bar">${[['all', '全部'], ['text', '文字'], ['epub', 'EPUB'], ['video', '视频']].map(([value, label]) => `<button class="filter-button ${state.pubFilter === value ? 'is-active' : ''}" data-action="pub-filter" data-filter="${value}">${label}</button>`).join('')}</div><div class="tag-filter">${tags.map((tag) => `<button data-action="search-tag" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`).join('')}</div></div>${pubs.length ? `<div class="pub-grid four">${pubs.map((pub) => pubCard(pub)).join('')}</div>` : '<div class="empty-state"><strong>没有匹配的公开投影</strong><p>换一个关键词，或者清除筛选后再试。</p></div>'}`;
}

function publicationView() {
  const pub = publicPublication(state.selectedId);
  if (!pub) return missingView('Publication 不存在或已被本地屏蔽');
  const creator = publicCreator(pub.creatorId);
  const series = data.series.find((item) => item.seriesId === pub.seriesRef);
  const comments = allComments(pub.publicationId);
  const progress = Number(state.progress[pub.publicationId] || 0);
  const commentRows = comments.filter((item) => !item.replyTo).map((comment) => {
    const replies = comments.filter((item) => item.replyTo === comment.commentId);
    return `<article class="comment"><div class="comment-head"><strong>${escapeHtml(comment.author)}</strong><time>${escapeHtml(comment.createdAt)}</time></div><p>${escapeHtml(comment.body)}</p><button data-action="reply-comment" data-id="${escapeHtml(comment.commentId)}">回复</button>${replies.map((reply) => `<div class="comment-reply"><strong>${escapeHtml(reply.author)}</strong><span>${escapeHtml(reply.body)}</span><time>${escapeHtml(reply.createdAt)}</time></div>`).join('')}</article>`;
  }).join('');
  return `<button class="back-link" data-section="publications">← 返回作品库</button><section class="publication-hero"><div class="publication-cover ${coverClass(pub)}" style="--accent:${escapeHtml(pub.accent)}"><span>${escapeHtml(pub.editionType)}</span><strong>${escapeHtml(pub.title)}</strong><small>${escapeHtml(versionLabel(pub.version))} · ${escapeHtml(pub.visibility)}</small></div><div class="publication-info"><span class="eyebrow">${escapeHtml(pub.publicationId)}</span><h1>${escapeHtml(pub.title)}</h1><p>${escapeHtml(pub.summary)}</p><button class="link-button byline-large" data-action="open-creator" data-id="${escapeHtml(pub.creatorId)}"><span class="creator-dot" style="background:${escapeHtml(pub.accent)}">${escapeHtml(initials(pub.creator))}</span>${escapeHtml(pub.creator)} · ${escapeHtml(pub.category)}</button><div class="tag-row large">${(pub.tags || []).map((tag) => `<button data-action="search-tag" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`).join('')}</div><div class="publication-actions"><button class="button button-primary" data-action="set-progress" data-id="${escapeHtml(pub.publicationId)}" data-progress="${progress >= 100 ? 0 : Math.min(100, progress + 25)}">${progress ? `继续 · ${progress}%` : '开始阅读'}</button><button class="button button-ghost" data-action="favorite" data-id="${escapeHtml(pub.publicationId)}">${state.favorites.has(pub.publicationId) ? '♥ 已收藏' : '♡ 收藏'}</button><button class="button button-ghost" data-action="later" data-id="${escapeHtml(pub.publicationId)}">${state.later.has(pub.publicationId) ? '移出稍后' : '稍后阅读'}</button><button class="button button-ghost" data-action="add-to-collection" data-id="${escapeHtml(pub.publicationId)}">加入灵感架</button><button class="button button-ghost" data-action="show-publication-envelope" data-id="${escapeHtml(pub.publicationId)}">核验包络</button></div><div class="progress-line"><span style="width:${progress}%"></span></div></div></section>
    <div class="detail-layout"><div><section class="reader-card"><div class="section-title"><div><h2>公开试读 / 预览</h2><p>本地消费连续性 · 进度只留在浏览器</p></div><span>${progress}%</span></div>${(pub.preview || []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}<div class="reader-progress">${[25, 50, 75, 100].map((value) => `<button class="${progress >= value ? 'is-active' : ''}" data-action="set-progress" data-id="${escapeHtml(pub.publicationId)}" data-progress="${value}">${value}%</button>`).join('')}</div></section>
    <section class="section-block"><div class="section-title"><div><h2>讨论</h2><p>本地 Event Feed 预演；不修改 Publication 内容</p></div><span>${comments.length} 条</span></div><div class="comments">${commentRows || '<div class="empty-state"><strong>还没有讨论</strong><p>写下第一条本地评论。</p></div>'}</div><form id="comment-form" class="comment-form"><input type="hidden" name="publicationId" value="${escapeHtml(pub.publicationId)}"><input type="hidden" name="replyTo" value=""><textarea name="body" maxlength="500" required placeholder="写一条本地评论；不会上传到公共 Hub"></textarea><button class="button button-primary" type="submit">发送本地评论</button></form></section></div><aside>
    <section class="fact-card"><h3>版本与来源</h3>${(pub.versions || []).map((version) => `<div class="fact-row"><span>${escapeHtml(version.version)}</span><strong>${escapeHtml(version.note)}</strong><small>${formatDate(version.publishedAt)}</small></div>`).join('')}<button data-action="show-publication-envelope" data-id="${escapeHtml(pub.publicationId)}">查看 manifest / grant / provenance →</button></section>
    ${series ? `<section class="fact-card"><span class="eyebrow">SERIES</span><h3>${escapeHtml(series.title)}</h3><p>${escapeHtml(series.status)} · ${series.publicationIds.length} 个公开版本</p><button data-section="series">查看系列 →</button></section>` : ''}
    <section class="fact-card"><h3>公共空间治理</h3><p>举报与屏蔽只写入本地治理队列；正式执行需要公共身份和审核服务。</p><div class="stack-actions"><button data-action="report-publication" data-id="${escapeHtml(pub.publicationId)}">⚑ 举报本地记录</button><button data-action="block-creator" data-id="${escapeHtml(pub.creatorId)}">屏蔽 ${escapeHtml(creator?.name)}</button></div></section></aside></div>`;
}

function worldsView() {
  const worlds = filteredWorlds();
  return `${pageHead('WORLDS · BRANCH GOVERNANCE', 'World 地图', 'World 是可选持续上下文。Fork 可以自由发生，Canon Merge 保留 Root Authority 与完整 provenance。', '<button class="button button-ghost" data-action="show-toast" data-message="真实 World Fork 已由 Mazz W94Ga 本地运行时持有；网页只显示安全投影">本地运行时边界</button>')}<div class="world-grid">${worlds.length ? worlds.map(worldCard).join('') : '<div class="empty-state"><strong>没有匹配的 World</strong><p>搜索标题、分支或公开事实。</p></div>'}</div><section class="section-block"><div class="section-title"><div><h2>两张地图，两个问题</h2><p>Authority Map 说明谁能推进 Canon；Audience Map 说明谁在关注与衍生。</p></div></div><div class="chart-layout"><div class="rules-card"><span class="eyebrow">AUTHORITY MAP</span><h3>Fork 权尽量自由，Merge 权严格归属。</h3><p>Branch、Proposal、Review 和 Merge 都是独立事实。热门、播放量与 Factory Pass 不会自动成为 Canon。</p><span class="rule-chip">Root Canon</span><span class="rule-chip">Authorized Branch</span><span class="rule-chip">Community Derivative</span><button data-action="show-envelope">查看治理字段 →</button></div><div class="leaderboard"><h3>Audience Map</h3><p class="leaderboard-sub">近 30 天公开衍生信号</p>${data.worlds.map((world, index) => `<button class="rank-row" data-action="open-world" data-id="${escapeHtml(world.worldId)}"><span class="rank-num">0${index + 1}</span><span class="rank-main"><strong>${escapeHtml(world.title)}</strong><small>${escapeHtml(world.branchCount)} branches · ${escapeHtml(world.growth)} growth</small></span><span class="rank-value">${escapeHtml(world.publicationCount)} works</span></button>`).join('')}</div></div></section>`;
}

function worldView() {
  const world = publicWorld(state.selectedId);
  if (!world) return missingView('World 不存在');
  const forked = state.localWorldForks.has(world.worldId);
  return `<button class="back-link" data-section="worlds">← 返回 World 地图</button>${pageHead(world.authority, world.title, world.summary, `<button class="button ${forked ? 'button-ghost' : 'button-primary'}" data-action="fork-world" data-id="${escapeHtml(world.worldId)}">${forked ? '已登记本地 Fork' : '登记本地 Fork'}</button>`)}<div class="stats-banner"><div><strong>${world.factCount}</strong><span>公开事实</span></div><div><strong>${world.branchCount}</strong><span>Branches</span></div><div><strong>${world.publicationCount}</strong><span>Publications</span></div><div><strong>${world.growth}</strong><span>Audience growth</span></div></div><div class="detail-layout"><section class="fact-card"><div class="section-title"><div><h2>Authority Map</h2><p>权力关系，不是质量排行</p></div></div>${(world.branches || []).map((branch) => `<div class="branch-row"><span class="branch-dot"></span><div><strong>${escapeHtml(branch.title)}</strong><small>${escapeHtml(branch.branchId)} · ${escapeHtml(branch.head)}</small></div><span>${escapeHtml(branch.authority)}</span></div>`).join('')}</section><aside><section class="fact-card"><div class="section-title"><div><h2>Canon Proposals</h2><p>语义 cherry-pick，不吞并 Branch</p></div></div>${(world.proposals || []).length ? world.proposals.map((proposal) => `<div class="proposal-row"><strong>${escapeHtml(proposal.title)}</strong><span>${escapeHtml(proposal.status)}</span><small>${escapeHtml(proposal.decision)}</small></div>`).join('') : '<p>当前没有公开 Proposal。</p>'}<p class="boundary-note">网页只登记打开意图；真实 create/fork/propose/review/merge 由 W94Ga Electron 本地运行时执行。</p></section></aside></div>`;
}

function chartsView() {
  const formula = data.charts.formula;
  return `${pageHead('CHARTS · EXPLAINABLE DISCOVERY', '透明 Charts', 'Following、For You、Charts、Explore 四路分离；榜单显示指标、样本窗口、衰减与反作弊边界。', '<button class="button button-primary" data-action="show-formula">展开公式</button>')}${discoveryLane()}<div class="chart-layout"><div><div class="chart-strip">${chartPanel('Attention value', data.charts.attention)}${chartPanel('Creation value', data.charts.creation)}</div><section class="section-block"><div class="section-title"><div><h2>当前上升</h2><p>${escapeHtml(data.charts.window)}</p></div></div><div class="leaderboard">${[...data.publications].sort((a, b) => b.signals.completion - a.signals.completion).map((pub, index) => `<button class="rank-row" data-action="open-publication" data-id="${escapeHtml(pub.publicationId)}"><span class="rank-num">${String(index + 1).padStart(2, '0')}</span><span class="rank-main"><strong>${escapeHtml(pub.title)}</strong><small>${escapeHtml(pub.creator)} · ${escapeHtml(pub.category)}</small></span><span class="rank-value">${Math.round(pub.signals.completion * 100)}%</span></button>`).join('')}</div></section></div><aside class="rules-card"><span class="eyebrow">${escapeHtml(formula.formulaId)}</span><h3>看得懂，才算发现。</h3><p>${escapeHtml(formula.attention)}</p><p>${escapeHtml(formula.creation)}</p><span class="rule-chip">${escapeHtml(formula.decay)}</span><span class="rule-chip">Official 不加权</span><span class="rule-chip">支持公开重算</span><button data-action="show-formula">查看计算说明 →</button></aside></div>`;
}

function creatorsView() {
  const creators = filteredCreators();
  return `${pageHead('CREATORS', '创作者', '稳定 Creator 身份把作品、World、系列与公共事件聚合起来；关注关系不改变作品所有权。', '<button class="button button-ghost" data-action="show-toast" data-message="账号与跨设备身份仍需服务器；本地版只保存关注状态">身份边界</button>')}${creators.length ? `<div class="creator-grid">${creators.map(creatorCard).join('')}</div>` : '<div class="empty-state"><strong>没有匹配的创作者</strong><p>清除搜索或到治理页解除屏蔽。</p></div>'}`;
}

function creatorView() {
  const creator = publicCreator(state.selectedId);
  if (!creator || state.blockedCreators.has(creator.creatorId)) return missingView('该创作者不存在或已被本地屏蔽');
  const pubs = allPublications().filter((pub) => pub.creatorId === creator.creatorId);
  const series = data.series.filter((item) => item.creatorId === creator.creatorId);
  return `<button class="back-link" data-section="creators">← 返回创作者</button><section class="profile-hero" style="--creator-accent:${escapeHtml(creator.accent)}"><div class="profile-avatar">${escapeHtml(initials(creator.name))}</div><div><span class="eyebrow">${escapeHtml(creator.creatorId)}</span><h1>${escapeHtml(creator.name)}</h1><strong>${escapeHtml(creator.handle)}</strong><p>${escapeHtml(creator.bio)}</p><small>加入于 ${escapeHtml(creator.joinedAt)} · ${creator.works} 作品</small></div><div class="profile-actions"><button class="button button-primary" data-action="follow-creator" data-id="${escapeHtml(creator.creatorId)}">${state.following.has(creator.creatorId) ? '已关注' : '关注'}</button><button class="button button-ghost" data-action="block-creator" data-id="${escapeHtml(creator.creatorId)}">屏蔽</button></div></section><div class="stats-banner"><div><strong>${formatNumber(creator.followers)}</strong><span>关注者</span></div><div><strong>${creator.analytics.completion}</strong><span>完成率</span></div><div><strong>${creator.analytics.favoriteRate}</strong><span>收藏转化</span></div><div><strong>${creator.analytics.discussion}</strong><span>讨论增长</span></div></div><section class="section-block"><div class="section-title"><div><h2>公开作品</h2><p>Publication 身份与 Creator 聚合</p></div></div><div class="pub-grid">${pubs.map((pub) => pubCard(pub)).join('')}</div></section>${series.length ? `<section class="section-block"><div class="section-title"><div><h2>系列</h2><p>Series 不覆盖 Publication 版本</p></div></div><div class="series-grid">${series.map(seriesCard).join('')}</div></section>` : ''}`;
}

function seriesCard(series) {
  const creator = publicCreator(series.creatorId);
  return `<article class="series-card"><span class="eyebrow">${escapeHtml(series.status)}</span><h3>${escapeHtml(series.title)}</h3><p>${escapeHtml(creator?.name)} · ${series.publicationIds.length} 个公开 Publication</p><div>${series.publicationIds.map((id) => { const pub = publicPublication(id); return pub ? `<button data-action="open-publication" data-id="${escapeHtml(id)}">${escapeHtml(pub.title)} · ${escapeHtml(versionLabel(pub.version))}</button>` : ''; }).join('')}</div></article>`;
}

function seriesView() { return `${pageHead('SERIES / COLLECTIONS', '系列与合集', 'Series 是创作者公开组织；Collection 是你的本地保存方式，两者都不改变 Publication 身份。', '<button class="button button-ghost" data-section="library">打开我的合集</button>')}<div class="series-grid">${data.series.map(seriesCard).join('')}</div>`; }
function historyPublications() { return state.history.map((id) => publicPublication(id)).filter(Boolean); }
function cardsOrEmpty(pubs, title, message) { return pubs.length ? `<div class="pub-grid four">${pubs.map((pub) => pubCard(pub)).join('')}</div>` : `<div class="empty-state"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div>`; }

function libraryView() {
  const tabs = [['favorites', '收藏'], ['later', '稍后'], ['history', '历史'], ['collections', '合集'], ['following', '关注']];
  let body = '';
  if (state.libraryTab === 'favorites') body = cardsOrEmpty(allPublications().filter((pub) => state.favorites.has(pub.publicationId)), '还没有收藏', '在作品卡片上点 ♡。');
  if (state.libraryTab === 'later') body = cardsOrEmpty(allPublications().filter((pub) => state.later.has(pub.publicationId)), '稍后队列是空的', '把临时想看的作品加入稍后。');
  if (state.libraryTab === 'history') body = cardsOrEmpty(historyPublications(), '还没有消费历史', '打开作品并记录一次阅读进度。');
  if (state.libraryTab === 'following') {
    const creators = allCreators().filter((creator) => state.following.has(creator.creatorId));
    body = creators.length ? `<div class="creator-grid">${creators.map(creatorCard).join('')}</div>` : '<div class="empty-state"><strong>还没有关注创作者</strong><p>关注关系只保存在本地。</p></div>';
  }
  if (state.libraryTab === 'collections') body = `<form id="collection-form" class="inline-form"><input name="title" maxlength="40" required placeholder="新建本地合集"><button class="button button-primary" type="submit">新建</button></form><div class="collection-grid">${state.collections.map((collection) => `<article class="collection-card"><span class="eyebrow">LOCAL COLLECTION</span><h3>${escapeHtml(collection.title)}</h3><p>${collection.publicationIds.length} 个作品</p><div>${collection.publicationIds.map((id) => { const pub = publicPublication(id); return pub ? `<button data-action="open-publication" data-id="${escapeHtml(id)}">${escapeHtml(pub.title)}</button>` : ''; }).join('') || '<small>在作品详情选择“加入灵感架”。</small>'}</div></article>`).join('')}</div>`;
  return `${pageHead('YOUR SPACE · LOCAL ONLY', '收藏、稍后与历史', '收藏、关注、合集、进度和历史只写入浏览器本地状态；它们不会改变公共投影。', '<button class="button button-ghost" data-action="clear-local-consumption">清空消费状态</button>')}<div class="library-tabs">${tabs.map(([id, label]) => `<button class="library-tab ${state.libraryTab === id ? 'is-active' : ''}" data-action="library-tab" data-tab="${id}">${label}</button>`).join('')}</div>${body}`;
}

function inboxView() {
  const notifications = [...state.localNotifications, ...data.notifications];
  return `${pageHead('NOTIFICATION INBOX', '通知中心', '关注更新、回复与 World 事件保持独立记录；本地通知可读可清，不伪装成真实公共送达。', '<button class="button button-ghost" data-action="mark-all-read">全部标为已读</button>')}<div class="notification-list">${notifications.map((item) => `<button class="notification-row ${state.readNotifications.has(item.notificationId) ? '' : 'is-unread'}" data-action="open-notification" data-id="${escapeHtml(item.notificationId)}" data-ref="${escapeHtml(item.ref || '')}"><span class="activity-icon">${item.type === 'reply' ? '↩' : item.type === 'world' ? '◇' : '↻'}</span><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.time)}</small></span><i></i></button>`).join('')}</div>`;
}

function hubStatusCard() {
  if (hubError) return `<section class="status-card is-error"><strong>本地 fake-Hub 不可用</strong><p>${escapeHtml(hubError)}</p></section>`;
  if (!hubSnapshot) return '<section class="status-card"><strong>正在读取本地 fake-Hub…</strong></section>';
  return `<section class="status-card"><div><span class="status-dot"></span><strong>W94Gb local fake-Hub</strong><p>公共效果关闭 · networkCalls=${escapeHtml(hubSnapshot.networkCalls)} · authorityGranted=${escapeHtml(hubSnapshot.authorityGranted)}</p></div><div class="status-numbers"><span><strong>${escapeHtml(hubSnapshot.revision)}</strong> revision</span><span><strong>${hubSnapshot.projections.length}</strong> projections</span><span><strong>${hubSnapshot.receipts.length}</strong> receipts</span></div></section>`;
}

function studioView() {
  const projections = hubSnapshot?.projections || [];
  const receipts = hubSnapshot?.receipts || [];
  return `${pageHead('CREATOR STUDIO · LOCAL FAKE HUB', '本地发布与版本管理', '表单只把显式公开字段交给现有 W94Gb fake-Hub；prepare、publish、withdraw、sync 都产生本地 receipt，不触碰 VPS。', '<button class="button button-ghost" data-action="refresh-hub">刷新快照</button>')}${hubStatusCard()}<div class="studio-layout"><form id="studio-form" class="studio-form"><h2>准备 Publication</h2><p>必须由人明确提交；不会扫描 Workspace 或推断草稿。</p><label>标题<input name="title" maxlength="120" required placeholder="公开标题"></label><label>摘要<textarea name="summary" maxlength="500" required placeholder="仅填写允许公开的摘要"></textarea></label><div class="form-grid"><label>媒介<select name="editionType"><option value="text">Text</option><option value="epub">EPUB</option><option value="audio">Audio</option><option value="video">Video</option></select></label><label>版本<input name="version" value="v1" pattern="[A-Za-z0-9._:-]+" required></label></div><div class="form-grid"><label>可见性<select name="visibility"><option value="public">public</option><option value="unlisted">unlisted</option></select></label><label>World 引用（可选）<select name="worldRef"><option value="">Standalone Work</option>${data.worlds.map((world) => `<option value="${escapeHtml(world.worldId)}">${escapeHtml(world.title)}</option>`).join('')}</select></label></div><label>公开样本文本<textarea name="content" maxlength="8000" required placeholder="用于生成 content-addressed manifest；只写允许进入公开投影的内容"></textarea></label><label class="confirm-row"><input type="checkbox" name="confirm" required><span>我确认以上字段和样本文本允许进入本地 public projection；这不是公网授权。</span></label><button class="button button-primary" type="submit">Prepare 到本地 fake-Hub</button></form><div><section class="projection-list"><div class="section-title"><div><h2>本地 Projections</h2><p>同一 envelope / manifest / grant / receipt 契约</p></div></div>${projections.length ? projections.map((projection) => projectionCard(projection)).join('') : '<div class="empty-state"><strong>还没有本地投影</strong><p>提交左侧表单后先进入 prepared 状态。</p></div>'}</section><section class="section-block"><div class="section-title"><div><h2>Receipt 历史</h2><p>网络失败绝不记作成功</p></div></div><div class="receipt-list">${receipts.length ? [...receipts].reverse().map((receipt) => `<button data-action="show-receipt" data-id="${escapeHtml(receipt.receiptId)}"><span>${escapeHtml(receipt.action)}</span><strong>${escapeHtml(receipt.publicationId)}</strong><small>r${escapeHtml(receipt.revision)} · ${formatDate(receipt.occurredAt)}</small></button>`).join('') : '<p>暂无 receipt。</p>'}</div></section></div></div>`;
}

function projectionCard(projection) {
  const pkg = state.studioPackages.find((item) => item.envelope.publicationId === projection.publicationId);
  return `<article class="projection-card"><div><span class="status-pill status-${escapeHtml(projection.status)}">${escapeHtml(projection.status)}</span><h3>${escapeHtml(projection.envelope.title)}</h3><p>${escapeHtml(projection.publicationId)} · ${escapeHtml(projection.envelope.version)}</p></div><div class="projection-actions">${projection.status === 'prepared' ? `<button class="button button-primary" data-action="hub-publish" data-id="${escapeHtml(projection.publicationId)}" ${pkg ? '' : 'disabled'}>Publish 本地投影</button>` : ''}${projection.status === 'published' ? `<button class="button button-ghost" data-action="hub-withdraw" data-id="${escapeHtml(projection.publicationId)}" ${pkg ? '' : 'disabled'}>Withdraw</button>` : ''}<button class="button button-ghost" data-action="hub-sync" data-id="${escapeHtml(projection.publicationId)}" ${pkg ? '' : 'disabled'}>Sync</button><button class="button button-ghost" data-action="show-local-projection" data-id="${escapeHtml(projection.publicationId)}">核验</button></div></article>`;
}

function governanceView() {
  const blocked = allCreators().filter((creator) => state.blockedCreators.has(creator.creatorId));
  return `${pageHead('REPORT / BLOCK / PERMISSION', '治理与权限', '本地版提供可逆的屏蔽、举报队列和权限边界；公共处罚、账号封禁和审核决定仍需要真实服务与人工责任主体。')}<div class="governance-grid"><section class="fact-card"><h2>本地屏蔽</h2>${blocked.length ? blocked.map((creator) => `<div class="governance-row"><span>${escapeHtml(creator.name)}</span><button data-action="block-creator" data-id="${escapeHtml(creator.creatorId)}">解除</button></div>`).join('') : '<p>没有屏蔽的创作者。</p>'}</section><section class="fact-card"><h2>本地举报队列</h2>${state.reports.length ? state.reports.map((report) => `<div class="governance-row"><span>${escapeHtml(report.subjectId)}</span><small>${escapeHtml(report.status)} · ${formatDate(report.createdAt)}</small></div>`).join('') : '<p>没有本地举报记录。</p>'}</section><section class="fact-card"><h2>权限边界</h2><div class="permission-row"><strong>浏览 / 收藏 / 进度</strong><span>浏览器本地</span></div><div class="permission-row"><strong>Prepare / Publish / Withdraw</strong><span>W94Gb local fake-Hub</span></div><div class="permission-row"><strong>公共账号 / 审核 / 送达</strong><span>未连接</span></div><div class="permission-row"><strong>VPS Public Effect</strong><span class="danger-text">disabled</span></div></section></div>`;
}

function missingView(message) { return `<div class="empty-state"><strong>${escapeHtml(message)}</strong><p>返回发现页重新选择。</p><button class="button button-primary" data-section="discover">返回发现</button></div>`; }

function render() {
  if (!data) return;
  const views = { discover: discoverView, publications: publicationsView, publication: publicationView, worlds: worldsView, world: worldView, charts: chartsView, creators: creatorsView, creator: creatorView, series: seriesView, library: libraryView, inbox: inboxView, studio: studioView, governance: governanceView };
  app.innerHTML = (views[state.section] || discoverView)();
  updateChrome();
}

function showModal(title, body, eyebrow = 'PUBLIC ENVELOPE') {
  modal.querySelector('.eyebrow').textContent = eyebrow;
  modalTitle.textContent = title;
  modalBody.innerHTML = body;
  if (typeof modal.showModal === 'function') modal.showModal(); else modal.setAttribute('open', '');
}

function showEnvelope(publicationId = null) {
  let title = '公共包络';
  let body = `<div class="envelope-grid"><div class="envelope-field"><span>schema</span><strong>mazz.publication-envelope/v1</strong></div><div class="envelope-field"><span>visibility</span><strong>public · metadata-only</strong></div><div class="envelope-field"><span>identity</span><strong>Publication ID ≠ URL</strong></div><div class="envelope-field"><span>authority</span><strong>explicit Publication Grant</strong></div></div><p class="modal-note">草稿、Agent transcript、绝对路径、凭据、私钥与未发布 Rights 不会进入公共投影。</p>`;
  if (publicationId) {
    const pub = publicPublication(publicationId);
    const localProjection = hubSnapshot?.projections?.find((item) => item.publicationId === publicationId);
    const envelope = localProjection?.envelope || pub;
    if (envelope) {
      title = envelope.title;
      body = `<div class="envelope-grid"><div class="envelope-field wide"><span>publicationId</span><strong>${escapeHtml(envelope.publicationId)}</strong></div><div class="envelope-field"><span>workId</span><strong>${escapeHtml(envelope.workId)}</strong></div><div class="envelope-field"><span>version</span><strong>${escapeHtml(envelope.version)} · ${escapeHtml(envelope.editionType)}</strong></div><div class="envelope-field"><span>manifest</span><strong>${escapeHtml(envelope.contentManifestRef)}</strong></div><div class="envelope-field"><span>grant</span><strong>${escapeHtml(envelope.publicationGrantRef)}</strong></div><div class="envelope-field"><span>license</span><strong>${escapeHtml(envelope.licenseRef)}</strong></div><div class="envelope-field wide"><span>contentIds</span><strong>${escapeHtml((envelope.contentIds || []).join(' · '))}</strong></div></div><p class="modal-note">${escapeHtml(envelope.summary)}<br/>版本更新、撤回与重同步都通过 receipt 记录。</p>`;
    }
  }
  showModal(title, body);
}

function showFormula() {
  const formula = data.charts.formula;
  showModal('发现公式 v0.1', `<div class="formula-detail"><label>Attention</label><p>${escapeHtml(formula.attention)}</p><label>Creation</label><p>${escapeHtml(formula.creation)}</p><label>时间衰减</label><p>${escapeHtml(formula.decay)}</p><label>反作弊与权力边界</label><p>${escapeHtml(formula.antiGaming)}</p><code>${escapeHtml(formula.formulaId)} · effective ${escapeHtml(formula.effectiveAt)}</code></div>`, 'EXPLAINABLE CHARTS');
}

function openRef(ref) { if (ref.startsWith('publication:')) setSection('publication', ref); else if (ref.startsWith('world:')) setSection('world', ref); }

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(canonical(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function buildLocalPackage(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  const createdAt = new Date().toISOString();
  const seed = (await sha256(`${values.title}|${values.version}|${createdAt}`)).slice(0, 20);
  const publicationId = `publication:local-${seed}-${values.version}`;
  const workId = `work:local-${seed}`;
  const manifestId = `manifest:local-${seed}`;
  const contentId = `content:local-${seed}:001`;
  const artifactRef = `artifact:local-${seed}`;
  const grantId = `grant:local-${seed}`;
  const contentHash = await sha256(values.content);
  const manifestBody = { schema: 'mazz.public-content-manifest/v1', manifestId, blocks: [{ contentId, mediaType: 'text/plain', size: new TextEncoder().encode(values.content).length, contentHash: `sha256:${contentHash}`, encrypted: false }], createdAt };
  const manifest = { ...manifestBody, contentRoot: `root:${await sha256(manifestBody)}` };
  const grant = { schema: 'mazz.publication-grant/v1', grantId, publicationId, subjectId: 'creator:local-preview', scope: ['publication:prepare', 'publication:publish', 'publication:withdraw', 'publication:sync'], authorityRef: 'human:local-preview', sourceArtifactRefs: [artifactRef], rightsRef: 'license:preview-local', issuedAt: createdAt, status: 'active' };
  const envelope = { schema: 'mazz.publication-envelope/v1', publicationId, workId, creatorId: 'creator:local-preview', editionType: values.editionType, version: values.version, title: values.title, summary: values.summary, visibility: values.visibility, ...(values.worldRef ? { worldRef: values.worldRef } : {}), contentManifestRef: manifestId, contentIds: [contentId], licenseRef: grant.rightsRef, provenance: { artifactRef }, publicationGrantRef: grantId, signatureRef: '', createdAt };
  envelope.signatureRef = `signature:${await sha256({ envelope: { ...envelope, signatureRef: '' }, grantId, publicationId })}`;
  return { envelope, manifest, grant };
}

async function hubRequest(action, body) {
  const response = await fetch(`/api/local-hub/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${result.error || response.status}: ${result.message || '本地 fake-Hub 操作失败'}`);
  return result;
}

async function loadHubSnapshot() {
  try {
    const response = await fetch('/api/local-hub/snapshot', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`);
    hubSnapshot = result;
    hubError = '';
  } catch (error) { hubSnapshot = null; hubError = error.message; }
}

async function runHubAction(action, publicationId) {
  const pkg = state.studioPackages.find((item) => item.envelope.publicationId === publicationId);
  if (!pkg) return showToast('本浏览器没有该 Projection 的本地 package；只能核验快照');
  try {
    if (action === 'sync') await hubRequest('sync', { publicationId, grant: pkg.grant });
    else await hubRequest(action, { ...pkg, expectedRevision: hubSnapshot?.revision ?? 0 });
    await loadHubSnapshot();
    render();
    showToast(action === 'publish' ? '已发布到本地 fake-Hub；公网仍关闭' : action === 'withdraw' ? '已撤回本地投影；本地 Work 未删除' : '本地投影已重同步');
  } catch (error) { showToast(error.message); }
}

document.addEventListener('click', async (event) => {
  const sectionNode = event.target.closest('[data-section]');
  if (sectionNode) { event.preventDefault(); setSection(sectionNode.dataset.section); return; }
  const actionNode = event.target.closest('[data-action]');
  if (!actionNode) return;
  const action = actionNode.dataset.action;
  const id = actionNode.dataset.id;
  if (action === 'favorite') { state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id); saveState(); render(); showToast(state.favorites.has(id) ? '已加入本地收藏' : '已取消收藏'); }
  else if (action === 'later') { state.later.has(id) ? state.later.delete(id) : state.later.add(id); saveState(); render(); showToast(state.later.has(id) ? '已加入稍后' : '已移出稍后'); }
  else if (action === 'follow-creator') { state.following.has(id) ? state.following.delete(id) : state.following.add(id); saveState(); render(); showToast(state.following.has(id) ? '已关注；Following 流已更新' : '已取消关注'); }
  else if (action === 'open-publication') setSection('publication', id);
  else if (action === 'open-creator') setSection('creator', id);
  else if (action === 'open-world') setSection('world', id);
  else if (action === 'show-publication-envelope') showEnvelope(id);
  else if (action === 'show-envelope') showEnvelope();
  else if (action === 'show-formula') showFormula();
  else if (action === 'close-modal') modal.close();
  else if (action === 'show-toast') showToast(actionNode.dataset.message || '本地预览动作');
  else if (action === 'pub-filter') { state.pubFilter = actionNode.dataset.filter; render(); }
  else if (action === 'library-tab') { state.libraryTab = actionNode.dataset.tab; render(); }
  else if (action === 'discovery-lane') { state.discoveryLane = actionNode.dataset.lane; render(); }
  else if (action === 'search-tag') { state.query = actionNode.dataset.tag; searchInput.value = state.query; setSection('publications'); }
  else if (action === 'set-progress') { state.progress[id] = Number(actionNode.dataset.progress); state.history = [id, ...state.history.filter((item) => item !== id)].slice(0, 30); saveState(); render(); showToast(`阅读进度已留在本地：${state.progress[id]}%`); }
  else if (action === 'add-to-collection') { const collection = state.collections[0]; if (!collection.publicationIds.includes(id)) collection.publicationIds.push(id); saveState(); showToast(`已加入“${collection.title}”`); }
  else if (action === 'reply-comment') { const form = document.querySelector('#comment-form'); if (form) { form.replyTo.value = id; form.body.placeholder = '写回复；仍只保存在本地'; form.body.focus(); } }
  else if (action === 'report-publication') { state.reports.push({ reportId: `report:local:${Date.now()}`, subjectId: id, status: 'local-pending', createdAt: new Date().toISOString() }); saveState(); showToast('已加入本地举报队列；尚未送达公共审核服务'); }
  else if (action === 'block-creator') { state.blockedCreators.has(id) ? state.blockedCreators.delete(id) : state.blockedCreators.add(id); saveState(); setSection(state.section === 'creator' ? 'creators' : state.section); showToast(state.blockedCreators.has(id) ? '已本地屏蔽' : '已解除本地屏蔽'); }
  else if (action === 'fork-world') { state.localWorldForks.has(id) ? state.localWorldForks.delete(id) : state.localWorldForks.add(id); saveState(); render(); showToast(state.localWorldForks.has(id) ? '已登记打开意图；真实 Fork 仍由 W94Ga 本地运行时执行' : '已取消本地 Fork 登记'); }
  else if (action === 'open-ref') openRef(actionNode.dataset.ref || '');
  else if (action === 'open-notification') { state.readNotifications.add(id); saveState(); updateChrome(); if (actionNode.dataset.ref) openRef(actionNode.dataset.ref); else render(); }
  else if (action === 'mark-all-read') { [...data.notifications, ...state.localNotifications].forEach((item) => state.readNotifications.add(item.notificationId)); saveState(); render(); }
  else if (action === 'clear-local-consumption') { state.favorites.clear(); state.later.clear(); state.progress = {}; state.history = []; state.collections.forEach((item) => { item.publicationIds = []; }); saveState(); render(); showToast('本地消费状态已清空；Publication 未受影响'); }
  else if (action === 'refresh-hub') { await loadHubSnapshot(); render(); }
  else if (action === 'hub-publish') await runHubAction('publish', id);
  else if (action === 'hub-withdraw') await runHubAction('withdraw', id);
  else if (action === 'hub-sync') await runHubAction('sync', id);
  else if (action === 'show-local-projection') showEnvelope(id);
  else if (action === 'show-receipt') {
    const receipt = hubSnapshot?.receipts?.find((item) => item.receiptId === id);
    if (receipt) showModal('Publication Receipt', `<div class="envelope-grid">${Object.entries(receipt).map(([key, value]) => `<div class="envelope-field ${['receiptId', 'commandHash', 'projectionDigest'].includes(key) ? 'wide' : ''}"><span>${escapeHtml(key)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>`, 'LOCAL RECEIPT');
  }
});

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  if (form.id === 'comment-form') {
    const values = Object.fromEntries(new FormData(form).entries());
    const comment = { commentId: `comment:local:${Date.now()}`, publicationId: values.publicationId, author: '本地用户', body: values.body.trim(), createdAt: '刚刚', replyTo: values.replyTo || null };
    if (!comment.body) return;
    state.localComments.push(comment);
    state.localNotifications.unshift({ notificationId: `notification:local:${Date.now()}`, type: 'reply', label: `已记录你在《${publicPublication(values.publicationId)?.title || '作品'}》的本地讨论`, time: '刚刚', ref: values.publicationId });
    saveState(); render(); showToast('本地评论已记录；没有上传公共 Hub');
  } else if (form.id === 'collection-form') {
    const values = Object.fromEntries(new FormData(form).entries());
    state.collections.push({ collectionId: `collection:local:${Date.now()}`, title: values.title.trim(), publicationIds: [] }); saveState(); render();
  } else if (form.id === 'studio-form') {
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true; submit.textContent = '正在校验并 Prepare…';
    try {
      const pkg = await buildLocalPackage(form);
      await hubRequest('prepare', { ...pkg, expectedRevision: hubSnapshot?.revision ?? 0 });
      state.studioPackages = [pkg, ...state.studioPackages.filter((item) => item.envelope.publicationId !== pkg.envelope.publicationId)].slice(0, 20);
      state.localNotifications.unshift({ notificationId: `notification:local:${Date.now()}`, type: 'update', label: `《${pkg.envelope.title}》已 Prepare 到本地 fake-Hub`, time: '刚刚', ref: '' });
      saveState(); await loadHubSnapshot(); render(); showToast('Prepare 完成；需要再次明确点击 Publish 才形成本地投影');
    } catch (error) { submit.disabled = false; submit.textContent = 'Prepare 到本地 fake-Hub'; showToast(error.message); }
  }
});

searchInput.addEventListener('input', () => { state.query = searchInput.value; render(); });
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== searchInput && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) { event.preventDefault(); searchInput.focus(); }
  if (event.key === 'Escape' && modal.open) modal.close();
});

window.addEventListener('hashchange', () => { const route = parseHash(); state.section = route.section; state.selectedId = route.selectedId; render(); });

Promise.all([
  fetch('./fixture.json').then((response) => { if (!response.ok) throw new Error(`fixture ${response.status}`); return response.json(); }),
  loadHubSnapshot()
]).then(([fixture]) => { data = fixture; render(); }).catch((error) => { app.innerHTML = `<div class="empty-state"><strong>本地数据读取失败</strong><p>${escapeHtml(error.message)}</p></div>`; });
