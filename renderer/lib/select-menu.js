// renderer/lib/select-menu.js —— select 子窗格化公共件（B12b 普查收编）
// 病根：主窗原生 select 弹出层被 WebContentsView GPU 表面压底（分屏邻浏览器必中）——
// 选择格一律走 ctxmenu 独立子窗（与 W58 code-lang-btn 同构），本件一行收编一处。
import { menus } from '../core/menu-service.js';
import { commands } from '../core/command-registry.js';

let seq = 0;

/**
 * 把现有 <select> 代理成「按钮 + ctxmenu 子窗选择格」：
 * 原 select 隐藏保留（值与 change 事件照常联动——下游逻辑零改动），按钮文案跟随当前值。
 * @param {HTMLSelectElement} sel 原下拉（保留作状态/事件单源）
 * @param {{items?: Array<{id:string,name:string}|[string,string]>, btnClass?: string}} opts
 *   items 缺省=读 sel 的 <option>；options 动态变化可再调 setItems()
 * @returns {{setCurrent(id:string):void, setItems(items:Array):void, destroy():void}}
 */
export function selectProxy(sel, { items, btnClass = 'rb-btn' } = {}) {
  if (!sel || sel._selProxied) return null;
  sel._selProxied = true;
  const source = 'selmenu-' + (++seq);
  // 动态选项免接线：items 缺省时每次开格/同步都重读 sel.options（工作区切换器等异步重建选项零管道）
  const readOpts = () => (items || [...sel.options].map(o => ({ id: o.value, name: o.textContent })))
    .map(x => Array.isArray(x) ? { id: x[0], name: x[1] } : x);
  let norm = readOpts();
  const nameOf = (id) => (norm.find(o => o.id === id) || {}).name ?? id;

  // 按钮形态与 code-lang-btn 同款（label + ▾）
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = btnClass + ' selmenu-btn';
  btn.title = sel.title || '';
  const label = document.createElement('span');
  label.className = 'selmenu-label';
  btn.appendChild(label);
  btn.insertAdjacentHTML('beforeend', '<i class="ico" style="font-style:normal;color:var(--fg-dim);margin-left:4px">▾</i>');
  sel.style.display = 'none';
  sel.insertAdjacentElement('afterend', btn);

  const setCurrent = (id) => { norm = readOpts(); label.textContent = nameOf(id); };
  const wire = () => {
    menus.removeBySource?.(source);
    commands.unregisterBySource(source);
    menus.contribute('selmenu/' + source, norm.map(o => ({ command: source + '.' + o.id, title: o.name, group: 'sel', source })));
    for (const o of norm) {
      const cmdId = source + '.' + o.id;
      commands.register(cmdId, {
        title: o.name, group: '选择', source, agent: false,
        run: () => { sel.value = o.id; sel.dispatchEvent(new Event('change', { bubbles: true })); setCurrent(o.id); },
      });
    }
  };
  wire();
  setCurrent(sel.value);
  // 程序改值（模块代码直接 sel.value=x）文案不脱节：外部可调 setCurrent，值变化事件亦监听
  const onChange = () => setCurrent(sel.value);
  sel.addEventListener('change', onChange);
  // 选项被整批重建（innerHTML 重写/append）自动保鲜——动态 select 零接线（genre/分类筛选同款病绝育）
  const mo = new MutationObserver(() => { norm = readOpts(); wire(); setCurrent(sel.value); });
  mo.observe(sel, { childList: true });
  let destroyed = false;
  const api = {
    setCurrent,
    setItems(next) { norm = (next || []).map(x => Array.isArray(x) ? { id: x[0], name: x[1] } : x); wire(); setCurrent(sel.value); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      mo.disconnect();
      menus.removeBySource?.(source);
      commands.unregisterBySource(source);
      sel.removeEventListener('change', onChange);
      btn.removeEventListener('click', onClick);
      btn.remove();
      sel.style.display = '';
      sel._selProxied = false;
      delete sel._selProxy;
    },
  };
  sel._selProxy = api; // 程序直赋值后的手动同步口（sel._selProxy?.setCurrent(v)）

  const onClick = (e) => {
    e.stopPropagation();
    norm = readOpts(); wire(); setCurrent(sel.value); // 开格前重读（动态选项保鲜）
    const r = btn.getBoundingClientRect();
    menus.show('selmenu/' + source, { x: r.left, y: r.bottom + 4 });
  };
  btn.addEventListener('click', onClick);

  return api;
}
