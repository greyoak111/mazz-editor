import { installControlIconRuntime, findRawControlIcons } from '../lib/control-icons.js';

installControlIconRuntime(document);

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
  audit: () => ({ rawControlIcons: findRawControlIcons(document), uiSize: document.documentElement.dataset.uiSize }),
};
