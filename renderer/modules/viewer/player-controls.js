// Player Control Surface —— W71 Responsive Level Contract 的首个参考实现。
// 同一真实控件节点在底栏与控制中心之间重排：不复制 handler，不复制状态，不按 BrowserWindow 宽度猜布局。

const DENSITY_LABELS = Object.freeze({ l: '舒展', m: '紧凑', s: '精简', xs: '极简' });
const GROUPS = Object.freeze([
  ['transport', '播放'],
  ['sound', '声音与速度'],
  ['picture', '画面'],
  ['tools', '工具与模式'],
]);
// 只有会建立自己焦点 owner 的动作才能跳过焦点回送。PiP / Fullscreen
// 只改变呈现模式，并不保证接管 DOM focus；把它们列在这里会把焦点关进 hidden panel。
const EXTERNAL_FOCUS_ACTIONS = new Set(['pset', 'companion']);

let surfaceSequence = 0;

function densityFor(width) {
  if (width >= 960) return 'l';
  if (width >= 600) return 'm';
  if (width >= 440) return 's';
  return 'xs';
}

function isAvailable(item) {
  return !item.hidden && item.style.display !== 'none';
}

export function mountPlayerControlSurface({ root, stage, controls, isVideo, onRelayoutSide } = {}) {
  const bar = controls?.querySelector('.mz-bar');
  const moreButton = controls?.querySelector('[data-a=more-controls]');
  const panel = stage?.querySelector('.mz-control-center');
  const panelBody = panel?.querySelector('.mz-control-center-body');
  const densityLabel = panel?.querySelector('.mz-control-density');
  if (!root || !stage || !controls || !bar || !moreButton || !panel || !panelBody) {
    return { refresh() {}, close() {}, focusMore() {}, focusMoreNow() {}, isOpen: () => false, snapshot: () => null, destroy() {} };
  }

  panel.id ||= `mz-player-controls-${++surfaceSequence}`;
  moreButton.setAttribute('aria-controls', panel.id);

  const inlineSequence = [...bar.children];
  const items = inlineSequence.filter(item => item.hasAttribute('data-player-min'));
  const groups = new Map();
  for (const [id, label] of GROUPS) {
    const section = document.createElement('section');
    section.className = 'mz-control-group';
    section.dataset.group = id;
    section.innerHTML = `<h3>${label}</h3><div class="mz-control-group-grid" role="group" aria-label="${label}"></div>`;
    panelBody.appendChild(section);
    groups.set(id, section);
  }

  for (const item of items) {
    if (item.dataset.playerVideoOnly === '1' && !isVideo) item.hidden = true;
    const label = item.dataset.playerLabel || item.title || '';
    if (item.matches('button') && label && !item.hasAttribute('aria-label')) item.setAttribute('aria-label', label);
  }

  let destroyed = false;
  let open = false;
  let layoutRaf = 0;
  let focusTimer = 0;
  let density = 'l';

  const focusWhenVisible = (resolveTarget, attempt = 0) => {
    clearTimeout(focusTimer);
    focusTimer = setTimeout(() => {
      focusTimer = 0;
      if (destroyed) return;
      const target = resolveTarget?.();
      const visible = target?.isConnected && !target.disabled && target.getClientRects().length > 0;
      if (visible) target.focus({ preventScroll: true });
      if ((!visible || document.activeElement !== target) && attempt < 10) {
        focusWhenVisible(resolveTarget, attempt + 1);
      }
    }, attempt ? 16 : 0);
  };

  const insertInline = item => {
    // 不对已在目标态的 class/DOM 重复写入；MutationObserver 会观察真实状态变化，
    // 这里若每帧无条件 add/remove 会形成 MO → RAF → MO 的永久布局循环。
    if (item.classList.contains('mz-overflow-item')) item.classList.remove('mz-overflow-item');
    const index = inlineSequence.indexOf(item);
    const next = inlineSequence.slice(index + 1).find(candidate => candidate.parentElement === bar);
    if (item.parentElement !== bar || item.nextElementSibling !== (next || null)) bar.insertBefore(item, next || null);
  };

  const insertOverflow = item => {
    if (!item.classList.contains('mz-overflow-item')) item.classList.add('mz-overflow-item');
    const section = groups.get(item.dataset.playerGroup) || groups.get('tools');
    const grid = section.querySelector('.mz-control-group-grid');
    const index = inlineSequence.indexOf(item);
    const next = inlineSequence.slice(index + 1).find(candidate => candidate.parentElement === grid);
    if (item.parentElement !== grid || item.nextElementSibling !== (next || null)) grid.insertBefore(item, next || null);
  };

  const syncGroupVisibility = () => {
    for (const section of groups.values()) {
      const populated = [...section.querySelector('.mz-control-group-grid').children].some(isAvailable);
      section.hidden = !populated;
    }
  };

  const syncMoreState = () => {
    const overflowItems = items.filter(item => item.closest('.mz-control-center') === panel && isAvailable(item));
    const active = overflowItems.some(item => item.classList.contains('on') || !!item.querySelector?.('.on'));
    const dot = moreButton.querySelector('.mz-more-dot');
    if (dot) dot.hidden = !active;
    moreButton.classList.toggle('has-active', active);
    moreButton.title = `更多播放控制（${overflowItems.length} 项）`;
    moreButton.setAttribute('aria-label', moreButton.title);
    moreButton.hidden = overflowItems.length === 0;
    if (!overflowItems.length && open) close('empty');
  };

  const layoutNow = () => {
    layoutRaf = 0;
    if (destroyed || !root.isConnected) return;
    try { onRelayoutSide?.(); } catch {}
    const width = Math.max(0, Math.round(controls.getBoundingClientRect().width));
    density = densityFor(width);
    controls.dataset.density = density;
    stage.dataset.controlDensity = density;
    if (densityLabel) densityLabel.textContent = `${DENSITY_LABELS[density]} · ${width}px`;

    for (const item of items) {
      const min = item.dataset.playerMin;
      const inline = min !== 'never' && Number.isFinite(Number(min)) && width >= Number(min) && !item.hidden;
      if (inline) insertInline(item);
      else insertOverflow(item);
    }
    syncGroupVisibility();
    syncMoreState();
  };

  const refresh = () => {
    if (destroyed || layoutRaf) return;
    layoutRaf = requestAnimationFrame(layoutNow);
  };

  function close(reason = 'dismiss', restoreFocus = true) {
    if (!open) return false;
    open = false;
    panel.hidden = true;
    panel.dataset.state = 'closed';
    moreButton.setAttribute('aria-expanded', 'false');
    root.classList.remove('mz-controls-open');
    if (reason !== 'destroy') root.dispatchEvent(new CustomEvent('playercontrolsurfacechange', { detail: { open: false, reason } }));
    if (restoreFocus && reason !== 'destroy') focusWhenVisible(() => moreButton);
    return true;
  }

  const show = () => {
    if (destroyed || !panel.hidden) return;
    root.querySelector('.mz-companion:not([hidden])')?.setAttribute('hidden', '');
    syncGroupVisibility();
    syncMoreState();
    if (moreButton.hidden) return;
    open = true;
    panel.hidden = false;
    panel.dataset.state = 'open';
    moreButton.setAttribute('aria-expanded', 'true');
    root.classList.add('mz-controls-open');
    root.dispatchEvent(new CustomEvent('playercontrolsurfacechange', { detail: { open: true, reason: 'show' } }));
    focusWhenVisible(() => panel.querySelector('button:not([hidden]):not(:disabled), input:not([hidden]):not(:disabled), .selmenu-btn:not(:disabled)'));
  };

  const onMore = event => {
    event.preventDefault();
    event.stopPropagation();
    if (open) close('toggle'); else show();
  };
  const onClose = event => { event.preventDefault(); close('button'); };
  const onOutside = event => {
    if (open && !panel.contains(event.target) && !moreButton.contains(event.target)) close('outside', false);
  };
  const onKey = event => {
    if (!open || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close('escape');
  };
  const onPanelClick = event => {
    const action = event.target.closest('button[data-a]');
    if (!action || action.dataset.a === 'more-close') return;
    // 动作需要把控制中心让开；状态仍由原按钮自己的 listener 唯一维护。
    queueMicrotask(() => {
      syncMoreState();
      close(`action:${action.dataset.a}`, false);
      // 只有确实建立独立焦点 owner 的动作才不回送；呈现模式切换仍须回到 More。
      if (EXTERNAL_FOCUS_ACTIONS.has(action.dataset.a)) return;
      // hidden 驱逐与同节点重排并非同一帧；只在目标真正可见后提交焦点，并有界重试。
      focusWhenVisible(() => action.dataset.a === 'lock' && action.classList.contains('on') ? action : moreButton);
    });
  };

  moreButton.addEventListener('click', onMore);
  panel.querySelector('[data-a=more-close]')?.addEventListener('click', onClose);
  panel.addEventListener('click', onPanelClick);
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);

  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(refresh) : null;
  resizeObserver?.observe(stage);
  resizeObserver?.observe(controls);
  const mutationObserver = new MutationObserver(() => { syncMoreState(); refresh(); });
  for (const item of items) mutationObserver.observe(item, { attributes: true, childList: true, subtree: true, attributeFilter: ['class', 'style', 'hidden', 'disabled', 'title'] });
  window.addEventListener('resize', refresh, { passive: true });

  const api = {
    refresh,
    close,
    focusMore: () => focusWhenVisible(() => moreButton),
    // 即将创建异步 modal 时，必须在第一个 await 之前把 previousFocus 交给稳定入口。
    focusMoreNow: () => {
      clearTimeout(focusTimer);
      focusTimer = 0;
      if (!destroyed && moreButton.isConnected && !moreButton.disabled) moreButton.focus({ preventScroll: true });
    },
    isOpen: () => open,
    snapshot: () => ({
      density,
      width: Math.round(controls.getBoundingClientRect().width),
      inline: items.filter(item => item.parentElement === bar && isAvailable(item)).map(item => item.dataset.a || item.dataset.playerLabel),
      overflow: items.filter(item => item.closest('.mz-control-center') === panel && isAvailable(item)).map(item => item.dataset.a || item.dataset.playerLabel),
      open,
    }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (layoutRaf) cancelAnimationFrame(layoutRaf);
      clearTimeout(focusTimer);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('resize', refresh);
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
      moreButton.removeEventListener('click', onMore);
      panel.querySelector('[data-a=more-close]')?.removeEventListener('click', onClose);
      panel.removeEventListener('click', onPanelClick);
      close('destroy', false);
      for (const item of items) insertInline(item);
      delete stage.dataset.controlDensity;
      delete controls.dataset.density;
      panel.remove();
      delete root.__playerControlSurface;
    },
  };
  root.__playerControlSurface = api;
  refresh();
  return api;
}

export { densityFor };
