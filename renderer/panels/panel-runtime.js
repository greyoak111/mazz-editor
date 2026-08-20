import { installControlIconRuntime, findRawControlIcons } from '../lib/control-icons.js';

installControlIconRuntime(document);

const panelRoot = document.documentElement;

/**
 * PanelWindow does not load a theme pack's generated structural selectors.
 * The host therefore sends the computed --panel-hard-edge token with every
 * theme snapshot.  Keep the geometry decision here instead of duplicating it
 * across the two dozen panel HTML files.
 */
export function applyPanelThemeStructure(payload = {}) {
  const id = String(payload.id || panelRoot.dataset.theme || 'paper');
  const marker = String(payload.vars?.['panel-hard-edge'] ?? payload.structure ?? '').trim().toLowerCase();
  const hardEdge = marker === '1' || marker === 'hard-edge' || marker === 'construct' || marker === 'custom'
    || id === 'construct' || id === 'custom';
  panelRoot.dataset.themeStructure = hardEdge ? 'hard-edge' : 'soft';
  return panelRoot.dataset.themeStructure;
}

applyPanelThemeStructure({ id: panelRoot.dataset.theme });
window.mazz?.on?.('theme:changed', applyPanelThemeStructure);
window.mazz?.on?.('panel:push', payload => {
  if (payload?.type === 'themeInit') applyPanelThemeStructure(payload);
});

const panelParams = new URLSearchParams(location.search);
const panelKind = panelParams.get('kind') || location.pathname.split('/').pop()?.replace(/\.html$/i, '') || 'unknown';
const panelResize = panelParams.get('resize') === 'fixed' ? 'fixed' : 'workspace';
document.documentElement.dataset.panelKind = panelKind;
document.documentElement.dataset.panelResize = panelResize;

const updateSize = () => {
  const width = document.documentElement.clientWidth || innerWidth || 0;
  document.documentElement.dataset.uiSize = width < 520 ? 'xs' : width < 760 ? 'sm' : 'md';
};

window.addEventListener('resize', updateSize, { passive: true });
updateSize();
document.documentElement.dataset.panelRuntime = 'v1';

for (const button of document.querySelectorAll('button')) {
  if (!button.getAttribute('aria-label') && button.getAttribute('title')) button.setAttribute('aria-label', button.getAttribute('title'));
}

window.__MazzPanelRuntime = {
  version: 1,
  audit: () => ({
    rawControlIcons: findRawControlIcons(document),
    uiSize: document.documentElement.dataset.uiSize,
    panelKind,
    panelResize,
    themeStructure: panelRoot.dataset.themeStructure,
  }),
};
