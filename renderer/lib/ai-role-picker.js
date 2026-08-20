// renderer/lib/ai-role-picker.js —— W62a-0 AI 岗位就地指派公共件
// 中央登记、就地指派：所有模块只调用本件；选项只来自已有 Key 的 provider×model。
import { AI_ROLES, getProviderAdminSnapshot, saveProviderRoute } from '../modules/factory/provider.js';
import { iconHtml } from './svg-icons.js';

const FOLLOW = '__follow_global__';
const roleMeta = id => AI_ROLES.find(r => r.id === id) || { id, label: id };
const targetValue = target => target?.providerId && target?.model ? `${target.providerId}::${target.model}` : FOLLOW;
const splitTarget = value => {
  if (!value || value === FOLLOW) return null;
  const at = value.indexOf('::');
  return at > 0 ? { providerId: value.slice(0, at), model: value.slice(at + 2) } : null;
};

export function aiRoleOptions(snapshot) {
  return [
    { v: FOLLOW, label: '跟随全局' },
    ...(snapshot?.connected || []).map(x => ({ v: x.value, label: x.label })),
  ];
}

/**
 * 在任意模块工具条挂一个紧凑「⚡岗位」按钮。所有可交互壳统一复用 picklist 原生选择格，
 * 不在各模块再造第二套下拉实现。
 * @returns {{button:HTMLButtonElement, refresh():Promise<void>, destroy():void}}
 */
export function aiRolePicker(role, anchor, { className = '', onChange } = {}) {
  if (!anchor) return null;
  const meta = roleMeta(role);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `${className || 'rb-btn'} ai-role-picker`;
  button.dataset.aiRole = role;
  let snapshot = null;

  const refresh = async () => {
    snapshot = await getProviderAdminSnapshot();
    const route = snapshot.roles.find(r => r.id === role)?.target || null;
    const current = snapshot.connected.find(x => x.value === targetValue(route));
    button.innerHTML = `${iconHtml('⚡')}<span>${meta.label} · ${current?.label || '跟随全局'}</span>`;
    button.title = `就地指派「${meta.label}」；配置真相源在 AI 服务 → AI 分工`;
  };
  const commit = async value => {
    await saveProviderRoute(role, splitTarget(value));
    await refresh();
    onChange?.(value);
  };
  const open = async () => {
    await refresh();
    const route = snapshot.roles.find(r => r.id === role)?.target || null;
    const items = aiRoleOptions(snapshot);
    if (window.MazzShell && window.mazz?.invoke) {
      const rect = button.getBoundingClientRect();
      window.__picklistPending = {
        title: `AI 指派 · ${meta.label}`, searchable: true, allowFree: false,
        current: targetValue(route), items, onPick: commit,
      };
      await window.mazz.invoke('panel:open', { kind: 'picklist', opts: { x: rect.left, y: rect.bottom + 4, w: 390, h: 420 } });
      return;
    }
    button.title = '当前运行环境没有可用的原生选择格；请到 AI 服务 → AI 分工设置';
  };
  button.addEventListener('click', open);
  anchor.appendChild(button);
  refresh().catch(() => { button.innerHTML = `${iconHtml('⚡')}<span>${meta.label}</span>`; });
  return { button, refresh, destroy() { button.removeEventListener('click', open); button.remove(); } };
}
