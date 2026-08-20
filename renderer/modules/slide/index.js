// renderer/modules/slide/index.js —— 演示模块（slide.js）：大纲 → 成稿，画布双编辑，PptxGenJS 编译；mazzslide v2 骨架（W36）
import { parseOutline, serializeOutline, markdownToOutline } from './outline.js';
import { iconHtml } from '../../lib/svg-icons.js';
import { SLIDE_THEMES, themeById } from './themes.js';
import { renderSlideHTML } from './render.js';
import { Presenter } from './present.js';
import { Presenter2 } from './present2.js';
import { exportPptx } from './pptx.js';
import { exportPptxV2 } from './pptx2.js';
import { contextKeys } from '../../core/contextkey-service.js';
import { toast, inputModal } from '../../shell/shell.js';
import { FontFamilyPicker, FontSizePicker, ColorPicker } from '../../shell/pickers.js';
// v2 文档模型（W36：物料×编排分离+百分比 Item+v1 lazy 迁移）
import { createSlideDoc, createSlide as createV2Slide, createItem, createFrame, addSlideToDoc, cloneSlide, serializeDoc, parseDoc, migrateFromOutline, pctToPx, pxToPct, DESIGN } from './doc.js';
// 画布编辑层（W37：渲染/磁吸/选框/等距/避让/工具）
import { renderPageCanvas, hitItem, snapItem, distributeItems, resolveItemOverlap, ITEM_TOOLS } from './canvas.js';

const MODULE = 'slide';
const instances = new Map();
let current = null;

/** 帧切换四形态（W38 编排层；W39 放映引擎消费）——模块级常量（createSlide 体内 enterV2 早调，函数内 const 会 TDZ） */
const TRANSITIONS = [
  { id: 'fade', name: '淡入', ico: '◐' },
  { id: 'slide', name: '平移', ico: '➜' },
  { id: 'zoom', name: '缩放', ico: '⊕' },
  { id: 'none', name: '直切', ico: '∅' },
];

const DEFAULT_OUTLINE = `# 演示文稿标题

## 第一节
- 要点一
- 要点二
- 要点三

::: notes 这一页的开场白……
---

# 第二页
## 内容
- 支持 **大纲 → 成稿**
- 主题 ×5 一键切换
- F5 放映 / 演讲者视图
`;

function createSlide(container) {
  const root = document.createElement('div');
  root.className = 'slide-root';
  root.innerHTML = `
    <div class="sl-editor"><textarea class="sl-outline" spellcheck="false" placeholder="# 页标题&#10;## 小节&#10;- 要点&#10;::: notes 备注&#10;--- 分页"></textarea></div>
    <div class="sl-preview">
      <div class="sl-stage"></div>
      <div class="sl-thumbs"></div>
    </div>
    <div class="sl-v2" style="display:none">
      <div class="sl-v2-side"></div>
      <div class="sl-v2-canvas"></div>
    </div>`;
  container.appendChild(root);

  const ctl = {
    container, root,
    outlineEl: root.querySelector('.sl-outline'),
    stageEl: root.querySelector('.sl-stage'),
    thumbsEl: root.querySelector('.sl-thumbs'),
    slides: parseOutline(DEFAULT_OUTLINE),
    themeId: 'ink',
    current: 0,
    canvasMode: false,
    tool: null,
    selEl: -1,
    // —— v2 模式（W36：物料×编排文档模型；v1 大纲路径完全保留） ——
    v2: root.querySelector('.sl-v2'),
    v2Side: root.querySelector('.sl-v2-side'),
    v2Canvas: root.querySelector('.sl-v2-canvas'),
    doc2: null,          // v2 文档（createSlideDoc 形态）
    curSlideId: null,    // 当前页 id（v2 模式）
    selItem: null,       // 选中 Item id（W37 画布）
    multiSel: null,      // 选框多选 Set（W37）
    get isV2() { return !!ctl.doc2; },
    get theme() { return themeById(ctl.themeId); },
    sync: () => syncFromOutline(),
    render: () => renderAll(),
    __active: true,
  };

  function syncFromOutline() {
    ctl.slides = parseOutline(ctl.outlineEl.value);
    if (ctl.current >= ctl.slides.length) ctl.current = ctl.slides.length - 1;
    renderAll();
    window.MazzHost?.notifyChange(container);
  }

  ctl.outlineEl.addEventListener('input', () => {
    clearTimeout(ctl._deb);
    ctl._deb = setTimeout(syncFromOutline, 350);
  });
  ctl.outlineEl.addEventListener('focus', () => { current = ctl; contextKeys.set('module', MODULE); });

  function renderAll() {
    const s = ctl.slides[ctl.current];
    ctl.stageEl.innerHTML = s ? renderSlideHTML(s, ctl.theme, { scale: ctl.stageZoom || 1, canvasMode: ctl.canvasMode }) : '';
    bindCanvasEvents();
    renderStyleBar();
    renderZoomCtl();
    ctl.thumbsEl.innerHTML = '';
    ctl.slides.forEach((sl, i) => {
      const t = document.createElement('div');
      t.className = 'sl-thumb' + (i === ctl.current ? ' on' : '');
      t.innerHTML = renderSlideHTML(sl, ctl.theme, { scale: 0.16 });
      t.addEventListener('click', () => { ctl.current = i; renderAll(); });
      ctl.thumbsEl.appendChild(t);
    });
  }

  // ==================== 单页缩放（滚轮 + 角落控件；独立于全局窗格缩放） ====================
  ctl.stageEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    ctl.stageZoom = Math.min(2.5, Math.max(0.3, (ctl.stageZoom || 1) * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    renderAll();
  }, { passive: false });
  function renderZoomCtl() {
    const bar = document.createElement('div');
    bar.className = 'sl-zoomctl';
    bar.innerHTML = `
      <button data-z="out" title="缩小">－</button>
      <span>${Math.round((ctl.stageZoom || 1) * 100)}%</span>
      <button data-z="in" title="放大">＋</button>
      <button data-z="reset" title="复位 100%">1:1</button>`;
    bar.querySelector('[data-z=in]').addEventListener('click', () => { ctl.stageZoom = Math.min(2.5, (ctl.stageZoom || 1) * 1.25); renderAll(); });
    bar.querySelector('[data-z=out]').addEventListener('click', () => { ctl.stageZoom = Math.max(0.3, (ctl.stageZoom || 1) / 1.25); renderAll(); });
    bar.querySelector('[data-z=reset]').addEventListener('click', () => { ctl.stageZoom = 1; renderAll(); });
    ctl.stageEl.appendChild(bar);
  }

  // ==================== 画布编辑 v1 ====================
  function bindCanvasEvents() {
    if (!ctl.canvasMode) return;
    const slideEl = ctl.stageEl.querySelector('.sl-slide');
    if (!slideEl) return;

    slideEl.addEventListener('mousedown', (e) => {
      const rect = slideEl.getBoundingClientRect();
      const toPct = (ev) => ({
        x: (ev.clientX - rect.left) / rect.width * 100,
        y: (ev.clientY - rect.top) / rect.height * 100,
      });
      const target = e.target.closest('[data-el]');

      if (ctl.tool) {
        // 放置新元素
        const start = toPct(e);
        const ghost = document.createElement('div');
        ghost.className = 'sl-ghost';
        slideEl.appendChild(ghost);
        const move = (ev) => {
          const p = toPct(ev);
          ghost.style.cssText = `left:${Math.min(start.x, p.x)}%;top:${Math.min(start.y, p.y)}%;width:${Math.abs(p.x - start.x)}%;height:${Math.abs(p.y - start.y)}%`;
        };
        const up = async (ev) => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          ghost.remove();
          const p = toPct(ev);
          const el = {
            type: ctl.tool,
            x: Math.min(start.x, p.x), y: Math.min(start.y, p.y),
            w: Math.max(3, Math.abs(p.x - start.x)), h: Math.max(3, Math.abs(p.y - start.y)),
          };
          if (ctl.tool === 'text') {
            const text = await inputModal('文本内容', '双击编辑文本');
            if (text == null) { ctl.tool = null; renderAll(); return; }
            el.text = text;
          }
          if (ctl.tool === 'image') {
            window.mazz?.invoke('dialog:openFile', {
              filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
            }).then(async (path) => {
              if (!path) { ctl.tool = null; renderAll(); return; }
              if (window.mazz?.isElectron) {
                // 大图落盘：复制进 .mazz/assets，元素只存文件路径（base64 塞大纲会卡爆整个模块）
                const b64 = await window.mazz.invoke('fs:readFileBase64', { path });
                const ws = await window.mazz.invoke('workspace:get');
                const dir = `${ws}/.mazz/assets`;
                await window.mazz.invoke('fs:mkdir', { path: dir });
                const ext = path.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
                const dest = `${dir}/slide_${Date.now()}.${ext}`;
                await window.mazz.invoke('fs:writeFileBase64', { path: dest, base64: b64 });
                el.src = 'mazz-res://media/' + encodeURIComponent(String(dest).replace(/\\/g, '/')); // 页面同源化
              } else el.src = path;
              addEl(el);
            });
            ctl.tool = null;
            return;
          }
          addEl(el);
          ctl.tool = null;
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
        e.preventDefault();
        return;
      }

      if (target) {
        const idx = +target.dataset.el;
        ctl.selEl = idx;
        renderAll();
        const start = toPct(e);
        const el = ctl.slides[ctl.current].elements[idx];
        const orig = { ...el };
        const isHandle = !!e.target.closest('.sl-handle');
        const move = (ev) => {
          const p = toPct(ev);
          const dx = p.x - start.x, dy = p.y - start.y;
          if (isHandle) {
            el.w = Math.max(3, orig.w + dx);
            el.h = Math.max(3, orig.h + dy);
          } else {
            el.x = orig.x + dx;
            el.y = orig.y + dy;
          }
          renderAll();
        };
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          syncElementsToOutline();
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
        e.preventDefault();
      } else {
        ctl.selEl = -1;
        renderAll();
      }
    });

    // 双击文本元素 → 就地编辑（contenteditable，失焦保存）
    slideEl.addEventListener('dblclick', (e) => {
      const target = e.target.closest('.sl-el-text');
      if (!target) return;
      const idx = +target.dataset.el;
      const el = ctl.slides[ctl.current].elements[idx];
      if (!el) return;
      target.contentEditable = 'true';
      target.focus();
      document.getSelection().selectAllChildren(target);
      const save = () => {
        target.contentEditable = 'false';
        el.text = target.innerText.trim();
        syncElementsToOutline();
        renderAll();
      };
      target.addEventListener('blur', save, { once: true });
      target.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') { target.innerText = el.text; target.blur(); }
        ev.stopPropagation();
      });
    });

    // 选中元素高亮 + 缩放/旋转手柄
    if (ctl.selEl >= 0) {
      const el = slideEl.querySelector(`[data-el="${ctl.selEl}"]`);
      if (el) {
        el.classList.add('sel');
        const h = document.createElement('div');
        h.className = 'sl-handle';
        el.appendChild(h);
        // 旋转手柄（顶部圆点，拖拽旋转；Shift 吸附 15°）
        const rot = document.createElement('div');
        rot.className = 'sl-rotate';
        rot.textContent = '⟳';
        rot.title = '拖拽旋转（Shift 吸附 15°）';
        el.appendChild(rot);
        const selData = ctl.slides[ctl.current].elements[ctl.selEl];
        rot.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const slideRect = slideEl.getBoundingClientRect();
          const elRect = el.getBoundingClientRect();
          const cx = elRect.left + elRect.width / 2, cy = elRect.top + elRect.height / 2;
          const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
          const origRotate = selData.rotate || 0;
          const move = (ev) => {
            const a = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI;
            let deg = origRotate + (a - startAngle);
            if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
            selData.rotate = Math.round(((deg % 360) + 360) % 360);
            renderAll();
          };
          const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            syncElementsToOutline();
          };
          window.addEventListener('mousemove', move);
          window.addEventListener('mouseup', up);
        });
      }
    }
  }

  /** 画布选中元素样式工具条（字体/字号/颜色/加粗斜体/对齐/复制/层级/删除） */
  function renderStyleBar() {
    ctl.root.querySelector('.sl-stylebar')?.remove();
    if (!ctl.canvasMode || ctl.selEl < 0) return;
    const el = ctl.slides[ctl.current].elements[ctl.selEl];
    if (!el) return;
    el.style = el.style || {};
    const bar = document.createElement('div');
    bar.className = 'sl-stylebar';
    ctl.root.querySelector('.sl-stage')?.appendChild(bar);
    bar.style.cssText = 'position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:50;display:flex;gap:6px;align-items:center;background:var(--bg-elev);border:1px solid var(--border);border-radius:9px;padding:5px 10px;box-shadow:var(--shadow)';

    new FontFamilyPicker(bar, {
      onChange: (family) => { el.style.family = family; syncElementsToOutline(); renderAll(); },
    }).set?.(el.style.family);
    const sp = new FontSizePicker(bar, {
      onChange: (size) => { el.style.size = size; syncElementsToOutline(); renderAll(); },
    });
    sp.input.value = el.style.size || '';
    new ColorPicker(bar, { label: '色', onChange: (color) => { el.style.color = color; syncElementsToOutline(); renderAll(); } });

    const mkBtn = (label, title, fn, on) => {
      const b = document.createElement('button');
      b.className = 'rb-btn' + (on ? ' on' : '');
      b.style.flexDirection = 'row';
      b.innerHTML = label;
      b.title = title;
      b.addEventListener('click', fn);
      bar.appendChild(b);
      return b;
    };
    mkBtn('<b>B</b>', '加粗', () => { el.style.bold = !el.style.bold; syncElementsToOutline(); renderAll(); }, el.style.bold);
    mkBtn('<i>I</i>', '斜体', () => { el.style.italic = !el.style.italic; syncElementsToOutline(); renderAll(); }, el.style.italic);
    for (const [a, icon, t] of [['left', '⇤', '左对齐'], ['center', '↔', '居中'], ['right', '⇥', '右对齐']]) {
      mkBtn(icon, t, () => { el.style.align = el.style.align === a ? null : a; syncElementsToOutline(); renderAll(); }, el.style.align === a);
    }
    mkBtn('⧉', '复制元素', () => {
      const copy = { ...el, style: { ...el.style }, x: el.x + 3, y: el.y + 3 };
      ctl.slides[ctl.current].elements.push(copy);
      ctl.selEl = ctl.slides[ctl.current].elements.length - 1;
      syncElementsToOutline(); renderAll();
    });
    mkBtn('⬆', '置顶', () => {
      const els = ctl.slides[ctl.current].elements;
      els.push(els.splice(ctl.selEl, 1)[0]);
      ctl.selEl = els.length - 1;
      syncElementsToOutline(); renderAll();
    });
    mkBtn('⬇', '置底', () => {
      const els = ctl.slides[ctl.current].elements;
      els.unshift(els.splice(ctl.selEl, 1)[0]);
      ctl.selEl = 0;
      syncElementsToOutline(); renderAll();
    });
    mkBtn('✕', '删除', () => ctl.deleteSelected());
  }

  function addEl(el) {
    ctl.slides[ctl.current].elements = ctl.slides[ctl.current].elements || [];
    ctl.slides[ctl.current].elements.push(el);
    ctl.selEl = ctl.slides[ctl.current].elements.length - 1;
    syncElementsToOutline();
    renderAll();
  }

  function syncElementsToOutline() {
    // 画布元素/背景写回大纲（<!--canvas:...--> / <!--bg:...--> 注释）
    const slides = ctl.slides;
    ctl.outlineEl.value = serializeOutline(slides);
    // 主题注释保持在首行
    if (ctl.themeId !== SLIDE_THEMES[0].id) {
      ctl.outlineEl.value = `<!--theme:${ctl.themeId}-->\n` + ctl.outlineEl.value;
    }
    window.MazzHost?.notifyChange(container);
  }
  ctl.syncToOutline = syncElementsToOutline;

  ctl.deleteSelected = () => {
    const els = ctl.slides[ctl.current]?.elements;
    if (!els || ctl.selEl < 0) return;
    els.splice(ctl.selEl, 1);
    ctl.selEl = -1;
    syncElementsToOutline();
    renderAll();
  };

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' && ctl.canvasMode && ctl.selEl >= 0 && document.activeElement !== ctl.outlineEl) {
      ctl.deleteSelected();
      e.preventDefault();
    }
  });

  // 右键选单：页面操作（演示此前没有右键逻辑）
  root.addEventListener('contextmenu', async (e) => {
    if (e.target.closest('.sl-stylebar') || e.target.closest('.sl-zoomctl')) return;
    e.preventDefault();
    const { showDomMenu } = await import('../../lib/dom-menu.js');
    const onEl = !!e.target.closest('[data-el]');
    showDomMenu([
      { label: '新建页面', fn: () => window.MazzCommands.execute('slide.add') },
      { label: ctl.canvasMode ? '退出画布模式' : '进入画布模式', fn: () => window.MazzCommands.execute('slide.canvasMode') },
      { label: '添加文本框', fn: () => window.MazzCommands.execute('slide.addText') },
      { label: '添加图片', fn: () => window.MazzCommands.execute('slide.addImage') },
      '-',
      ...(onEl ? [
        { label: '复制元素', fn: () => { if (ctl.selEl >= 0) { const el = ctl.slides[ctl.current].elements[ctl.selEl]; const copy = { ...el, style: { ...(el.style || {}) }, x: el.x + 3, y: el.y + 3 }; ctl.slides[ctl.current].elements.push(copy); ctl.selEl = ctl.slides[ctl.current].elements.length - 1; ctl.syncToOutline(); ctl.render(); } } },
        { label: '删除元素', fn: () => ctl.deleteSelected() },
        '-',
      ] : []),
      { label: '放映（F5）', fn: () => window.MazzCommands.execute('slide.present') },
      { label: '导出 PPTX', fn: () => window.MazzCommands.execute('slide.exportPptx') },
    ], e.clientX, e.clientY);
  });

  // 初始内容（W36：默认 v2 起手式——openTab 空档/create 直接起 v2 面；旧档 setContent 随后覆盖定形（v1 路径全保留））
  {
    const doc = createSlideDoc('未命名演示', 'night');
    addSlideToDoc(doc, createV2Slide(null, { items: [
      createItem('text', { text: '演示文稿标题', style: { size: 44, bold: true, align: 'center' }, left: 10, top: 32, width: 80, height: 16 }),
      createItem('text', { left: 14, top: 54, width: 72, height: 34, list: { items: [{ text: '要点一', icon: '•' }, { text: '要点二', icon: '•' }, { text: '要点三', icon: '•' }] }, style: { size: 24 } }),
    ] }));
    enterV2(doc);
  }

  // ==================== v2 模式骨架（W36：页侧栏+画布容器；v1 路径不动） ====================
  function enterV2(doc) {
    ctl.doc2 = doc;
    ctl.themeId = doc.theme || 'ink';
    ctl.curSlideId = doc.layouts.main.frames[0]?.slideId || null;
    ctl.outlineEl.closest('.sl-editor').style.display = 'none';
    root.querySelector('.sl-preview').style.display = 'none';
    ctl.v2.style.display = 'flex';
    renderV2All();
  }
  function exitV2() {
    ctl.doc2 = null;
    ctl.v2.style.display = 'none';
    ctl.outlineEl.closest('.sl-editor').style.display = '';
    root.querySelector('.sl-preview').style.display = '';
    renderAll();
  }

  function curSlide() { return ctl.curSlideId ? ctl.doc2?.slides[ctl.curSlideId] : null; }
  function slideTitleOf(sl) {
    if (!sl) return '（空页）';
    const t = sl.items.find(i => i.type === 'text');
    const txt = t?.lines?.[0]?.text || t?.list?.items?.[0]?.text || '';
    return txt.trim().split('\n')[0].slice(0, 18) || '（无标题）';
  }

  /** 侧栏（W38 编排层：物料×编排双视图+帧属性面板+演讲者备注；W36 骨架的增删排序全保留） */
  function renderPageList() {
    const doc = ctl.doc2;
    const frames = doc.layouts.main.frames;
    const view = ctl.sideView || 'sequence';
    const inSeqCount = (sid) => frames.filter(f => f.slideId === sid).length;
    ctl.v2Side.innerHTML = `
      <div class="sl-v2-side-head">
        <span class="sl-v2-viewsw">
          <button class="sw ${view === 'library' ? 'on' : ''}" data-v="library" title="页库（全部物料）">物料</button><button class="sw ${view === 'sequence' ? 'on' : ''}" data-v="sequence" title="放映序（编排帧序列）">放映序</button>
        </span>
        <b>${view === 'library' ? `页库（${Object.keys(doc.slides).length}）` : `帧（${frames.length}）`}</b>
        <button class="rb-btn" data-a="add" title="新建页（追加到编排尾）">${iconHtml('＋')}</button>
      </div>
      <div class="sl-v2-list"></div>
      <div class="sl-v2-props"></div>
      <div class="sl-v2-notes">
        <div class="h">演讲者备注</div>
        <textarea placeholder="讲给自己听的……（放映演讲者视图可见，W39）" spellcheck="false"></textarea>
      </div>`;
    ctl.v2Side.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => { ctl.sideView = b.dataset.v; renderPageList(); }));
    ctl.v2Side.querySelector('[data-a=add]').addEventListener('click', () => {
      const sl = createV2Slide(null, { items: [createItem('text', { text: '新页标题', style: { size: 40, bold: true, align: 'center' }, left: 10, top: 38, width: 80, height: 16 })] });
      addSlideToDoc(doc, sl);
      ctl.curSlideId = sl.id;
      markDirty(); renderPageList(); renderCanvasShell();
    });
    const list = ctl.v2Side.querySelector('.sl-v2-list');
    if (view === 'sequence') renderSeqList(list, frames);
    else renderLibList(list);
    renderFrameProps(ctl.v2Side.querySelector('.sl-v2-props'), frames);
    renderNotesBox(ctl.v2Side.querySelector('.sl-v2-notes textarea'));
  }

  /** 放映序视图：帧序列（排序/禁用/切换标/到时标/动作标+复制） */
  function renderSeqList(list, frames) {
    frames.forEach((fr, i) => {
      const sl = ctl.doc2.slides[fr.slideId];
      const tr = TRANSITIONS.find(t => t.id === (fr.transition || 'fade'));
      const el = document.createElement('div');
      el.className = 'sl-v2-page' + (fr.slideId === ctl.curSlideId ? ' on' : '');
      el.draggable = true;
      el.dataset.i = i;
      el.innerHTML = `<span class="no">${i + 1}</span><span class="t" title="${slideTitleOf(sl).replace(/"/g, '&quot;')}">${slideTitleOf(sl)}</span>
        <span class="mk tr" title="切换：${tr.name}（W39 放映消费）">${tr.ico}</span>
        ${fr.nextAfter ? `<span class="mk na" title="到时自动翻页 ${fr.nextAfter}s">⏱${fr.nextAfter}</span>` : ''}
        ${fr.actions ? `<span class="mk ac" title="帧动作：${[fr.actions.clearMedia ? '清媒体' : '', fr.actions.stopTimer ? '停计时' : '', fr.actions.trigger ? '触发器' : ''].filter(Boolean).join('·')}">⚡</span>` : ''}
        ${sl?.notes ? `<span class="nt" title="有演讲者备注">≡</span>` : ''}
        ${fr.disabled ? `<span class="db" title="已禁用（放映跳过）">⊘</span>` : ''}
        <span class="acts"><i data-a="up" title="上移">↑</i><i data-a="dn" title="下移">↓</i><i data-a="dup" title="复制帧（克隆物料插入其后）">⧉</i><i data-a="del" title="删除帧">✕</i></span>`;
      el.addEventListener('click', (e) => {
        const a = e.target.dataset?.a;
        if (a === 'up' || a === 'dn') {
          const j = a === 'up' ? i - 1 : i + 1;
          if (j < 0 || j >= frames.length) return;
          [frames[i], frames[j]] = [frames[j], frames[i]];
          markDirty(); renderPageList(); return;
        }
        if (a === 'dup') {
          const cp = cloneSlide(sl);
          ctl.doc2.slides[cp.id] = cp;
          frames.splice(i + 1, 0, createFrame(cp.id, { transition: fr.transition, nextAfter: fr.nextAfter, actions: fr.actions ? { ...fr.actions } : null }));
          ctl.curSlideId = cp.id;
          markDirty(); renderPageList(); renderCanvasShell(); return;
        }
        if (a === 'del') {
          frames.splice(i, 1);
          if (!frames.some(f => f.slideId === fr.slideId)) delete ctl.doc2.slides[fr.slideId]; // 物料零引用才清（帧删物料留——页库视图可见）
          if (ctl.curSlideId === fr.slideId) ctl.curSlideId = frames[Math.max(0, i - 1)]?.slideId || null;
          markDirty(); renderPageList(); renderCanvasShell(); return;
        }
        ctl.curSlideId = fr.slideId;
        renderPageList(); renderCanvasShell();
      });
      // 拖拽排序（HTML5）
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); });
      el.addEventListener('dragover', (e) => e.preventDefault());
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = +e.dataTransfer.getData('text/plain');
        if (from === i || from < 0 || from >= frames.length) return;
        const [m] = frames.splice(from, 1);
        frames.splice(i, 0, m);
        markDirty(); renderPageList();
      });
      list.appendChild(el);
    });
  }

  /** 页库视图：全部物料（含未入编排）——点击进编辑/复制/入编排/删除 */
  function renderLibList(list) {
    const slides = Object.values(ctl.doc2.slides);
    if (!slides.length) { list.innerHTML = '<div style="padding:14px;font-size:12px;opacity:.55">页库为空——＋新建一页</div>'; return; }
    slides.forEach((sl, i) => {
      const n = ctl.doc2.layouts.main.frames.filter(f => f.slideId === sl.id).length;
      const el = document.createElement('div');
      el.className = 'sl-v2-page' + (sl.id === ctl.curSlideId ? ' on' : '');
      el.innerHTML = `<span class="no">${i + 1}</span><span class="t" title="${slideTitleOf(sl).replace(/"/g, '&quot;')}">${slideTitleOf(sl)}</span>
        ${n ? `<span class="mk in" title="在编排中 ${n} 次">×${n}</span>` : `<span class="mk out" title="未入编排">○</span>`}
        ${sl?.notes ? `<span class="nt" title="有演讲者备注">≡</span>` : ''}
        <span class="acts"><i data-a="enq" title="追加到编排尾">⇥</i><i data-a="dup" title="复制物料">⧉</i><i data-a="del" title="删除物料（引用它的帧一并清）">✕</i></span>`;
      el.addEventListener('click', (e) => {
        const a = e.target.dataset?.a;
        const frames = ctl.doc2.layouts.main.frames;
        if (a === 'enq') { frames.push(createFrame(sl.id)); ctl.sideView = 'sequence'; ctl.curSlideId = sl.id; markDirty(); renderPageList(); renderCanvasShell(); return; }
        if (a === 'dup') { const cp = cloneSlide(sl); ctl.doc2.slides[cp.id] = cp; markDirty(); renderPageList(); toast('已复制到页库'); return; }
        if (a === 'del') {
          ctl.doc2.layouts.main.frames = frames.filter(f => f.slideId !== sl.id);
          delete ctl.doc2.slides[sl.id];
          if (ctl.curSlideId === sl.id) ctl.curSlideId = ctl.doc2.layouts.main.frames[0]?.slideId || null;
          markDirty(); renderPageList(); renderCanvasShell(); return;
        }
        // 点击物料：有帧跳首帧，无帧建帧入编排并切放映序
        const fi = frames.findIndex(f => f.slideId === sl.id);
        if (fi < 0) { frames.push(createFrame(sl.id)); ctl.sideView = 'sequence'; }
        ctl.curSlideId = sl.id;
        markDirty(); renderPageList(); renderCanvasShell();
      });
      list.appendChild(el);
    });
  }

  /** 帧属性面板（编排层核心：transition/nextAfter/disabled/帧动作——W39 放映引擎消费） */
  function renderFrameProps(box, frames) {
    if ((ctl.sideView || 'sequence') !== 'sequence') { box.style.display = 'none'; return; }
    const fi = frames.findIndex(f => f.slideId === ctl.curSlideId);
    const fr = frames[fi];
    if (!fr) { box.style.display = 'none'; return; }
    box.style.display = '';
    const tr = fr.transition || 'fade';
    box.innerHTML = `
      <div class="h">帧 ${fi + 1} 属性</div>
      <div class="row"><span>切换</span><span class="trsw">${TRANSITIONS.map(t => `<button class="sw ${tr === t.id ? 'on' : ''}" data-tr="${t.id}" title="${t.name}">${t.ico} ${t.name}</button>`).join('')}</span></div>
      <div class="row"><span>到时翻页</span><input type="number" class="na" min="0" max="3600" step="0.5" value="${fr.nextAfter || 0}" title="秒，0=不自动"> <span class="u">秒</span></div>
      <div class="row"><label><input type="checkbox" class="dis" ${fr.disabled ? 'checked' : ''}> 禁用（放映跳过）</label></div>
      <div class="row"><label><input type="checkbox" class="acm" ${fr.actions?.clearMedia ? 'checked' : ''}> 到帧清媒体</label><label><input type="checkbox" class="act" ${fr.actions?.stopTimer ? 'checked' : ''}> 到帧停计时</label></div>`;
    box.querySelectorAll('[data-tr]').forEach(b => b.addEventListener('click', () => { fr.transition = b.dataset.tr; markDirty(); renderPageList(); }));
    box.querySelector('.na').addEventListener('change', (e) => { fr.nextAfter = Math.max(0, Math.min(3600, Number(e.target.value) || 0)); markDirty(); renderPageList(); });
    box.querySelector('.dis').addEventListener('change', (e) => { fr.disabled = !!e.target.checked; markDirty(); renderPageList(); });
    const syncActions = () => {
      const cm = box.querySelector('.acm').checked, st = box.querySelector('.act').checked;
      fr.actions = (cm || st) ? { ...(cm ? { clearMedia: true } : {}), ...(st ? { stopTimer: true } : {}) } : null;
      markDirty(); renderPageList();
    };
    box.querySelector('.acm').addEventListener('change', syncActions);
    box.querySelector('.act').addEventListener('change', syncActions);
  }

  /** 演讲者备注（物料层 notes——input 只存档不重渲，打字不丢焦） */
  function renderNotesBox(ta) {
    const sl = curSlide();
    ta.value = sl?.notes || '';
    ta.disabled = !sl;
    ta.addEventListener('input', () => { if (sl) { sl.notes = ta.value; markDirty(); } });
    ta.addEventListener('change', () => renderPageList()); // 失焦刷新 ≡ 标
  }

  /** 真画布（W37：SVG 1920×1080 逻辑面（viewBox 百分比锚）+Item 渲染+缩放控件） */
  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }
  function renderCanvasShell() {
    const sl = curSlide();
    const th = themeById(ctl.themeId);
    const stage = document.createElement('div');
    stage.className = 'sl-v2-stage2';
    stage.style.cssText = `width:min(100%,960px);aspect-ratio:16/9;border-radius:12px;box-shadow:var(--shadow);position:relative;background:${sl?.bg || th?.bg || '#1a1a1e'};overflow:hidden`;
    const svg = svgEl('svg', { class: 'sl-v2-svg', viewBox: `0 0 ${DESIGN.w} ${DESIGN.h}`, preserveAspectRatio: 'xMidYMid meet' });
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    const viewport = svgEl('g', { class: 'sl-v2-viewport' });
    svg.appendChild(viewport);
    stage.appendChild(svg);
    ctl.v2Canvas.innerHTML = '';
    ctl.v2Canvas.appendChild(stage);
    ctl._stage = stage;
    ctl._svg = svg;
    ctl._viewport = viewport;
    renderPageCanvas(svgEl, viewport, sl, th, { outW: DESIGN.w, outH: DESIGN.h, selId: ctl.selItem });
    bindCanvasInput(stage, svg);
    renderItemToolbar();
    // 缩放控件（与 v1 同族：角落控件）
    const zc = document.createElement('div');
    zc.className = 'sl-v2-zoom';
    zc.style.cssText = 'position:absolute;right:12px;bottom:12px;display:flex;gap:6px;align-items:center;background:rgba(20,20,24,.6);border-radius:999px;padding:4px 12px;font-size:12px;color:#eee;backdrop-filter:blur(4px)';
    zc.innerHTML = `<button data-z="out">－</button><span>${Math.round((ctl.stageZoom || 1) * 100)}%</span><button data-z="in">＋</button><button data-z="reset">1:1</button>`;
    zc.addEventListener('pointerdown', (e) => e.stopPropagation()); // 缩放控件同压画布——拦截防误触 selrect
    zc.querySelectorAll('button').forEach(b => {
      b.style.cssText = 'border:0;background:none;color:#eee;cursor:pointer;font-size:13px';
      b.addEventListener('click', () => {
        if (b.dataset.z === 'in') ctl.stageZoom = Math.min(2.5, (ctl.stageZoom || 1) * 1.25);
        else if (b.dataset.z === 'out') ctl.stageZoom = Math.max(0.3, (ctl.stageZoom || 1) / 1.25);
        else ctl.stageZoom = 1;
        applyStageZoom();
        renderCanvasShell();
      });
    });
    stage.appendChild(zc);
    applyStageZoom();
  }
  function applyStageZoom() {
    if (!ctl._stage) return;
    const z = ctl.stageZoom || 1;
    const wrap = ctl._stage.parentElement;
    if (wrap) wrap.scrollLeft = (ctl._stage.scrollWidth * (z - 1)) / 2;
    ctl._stage.style.transform = `scale(${z})`;
    ctl._stage.style.transformOrigin = 'center center';
  }
  // ==================== 画布交互（W37：拖拽移动/resize/磁吸/选框/多选/工具加建） ====================
  function stagePoint(e) {
    const r = ctl._svg.getBoundingClientRect();
    const zx = (e.clientX - r.left) / r.width * DESIGN.w;
    const zy = (e.clientY - r.top) / r.height * DESIGN.h;
    return { x: zx, y: zy };
  }
  function bindCanvasInput(stage, svg) {
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      ctl.stageZoom = Math.min(2.5, Math.max(0.3, (ctl.stageZoom || 1) * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      applyStageZoom();
    }, { passive: false });
    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = stagePoint(e);
      // 工具加建模式：拖框出对象（注意：不能 return——下方 pointermove/pointerup 监听必须照常注册，否则 ghost 拖框无耳朵全哑火）
      if (ctl._addTool) {
        startGhostAdd(p);
      } else {
        const it = hitItem(curSlide(), p.x, p.y, DESIGN.w, DESIGN.h);
        // resize 手柄命中（已选中 Item 右下角 18px 逻辑圈内 → resize 优先于移动；角点在 Item 体内，旧逻辑要求 !it 永假是死代码）
        if (it && ctl.selItem === it.id) {
          const bx = pctToPx(it.left + it.width, 'x', DESIGN.w, DESIGN.h), by = pctToPx(it.top + it.height, 'y', DESIGN.w, DESIGN.h);
          if (Math.abs(p.x - bx) < 18 && Math.abs(p.y - by) < 18) drag = { type: 'resize', it, sx: e.clientX, sy: e.clientY, ow: it.width, oh: it.height };
        }
        if (!drag) {
          if (it) {
            ctl.selItem = it.id;
            renderItemToolbar();
            const offX = p.x - pctToPx(it.left, 'x', DESIGN.w, DESIGN.h);
            const offY = p.y - pctToPx(it.top, 'y', DESIGN.w, DESIGN.h);
            drag = { type: 'item', it, sx: e.clientX, sy: e.clientY, offX, offY, moved: false };
          } else {
            ctl.selItem = null;
            drag = { type: 'selrect', sx: p.x, sy: p.y, cx: p.x, cy: p.y };
            renderItemToolbar();
          }
        }
      }
      window.addEventListener('pointermove', onCanvasMove, { passive: false });
      window.addEventListener('pointerup', (e2) => { if (drag?.type === 'ghost') drag.end = stagePoint(e2); onCanvasUp(); }, { once: true });
    });
    stage.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const p = stagePoint(e);
      const it = hitItem(curSlide(), p.x, p.y, DESIGN.w, DESIGN.h);
      if (it) { ctl.selItem = it.id; renderItemToolbar(); showItemMenu(e.clientX, e.clientY, it); }
    });
    // Delete 键删除（选中/多选；W37）
    stage.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelectedItems(); }
    });
    stage.tabIndex = 0;
    // 双击文本框进编辑（W37）
    stage.addEventListener('dblclick', (e) => {
      const p = stagePoint(e);
      const it = hitItem(curSlide(), p.x, p.y, DESIGN.w, DESIGN.h);
      if (it?.type === 'text') { ctl.selItem = it.id; editTextItem(it); }
    });
  }
  let drag = null;
  function onCanvasMove(e) {
    if (!drag) return;
    const sl = curSlide();
    if (drag.type === 'item') {
      const it = drag.it;
      const p = stagePoint(e);
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
      const nx = (p.x - drag.offX), ny = (p.y - drag.offY);
      // 磁吸（导图为母本：边缘/中线吸附）
      const snap = snapItem(sl, it, { x: nx, y: ny, w: pctToPx(it.width, 'w', DESIGN.w, DESIGN.h), h: pctToPx(it.height, 'h', DESIGN.w, DESIGN.h) }, DESIGN.w, DESIGN.h);
      it.left = pxToPct(nx + snap.dx, 'x', DESIGN.w, DESIGN.h);
      it.top = pxToPct(ny + snap.dy, 'y', DESIGN.w, DESIGN.h);
      it.left = Math.max(-it.width + 2, Math.min(98, it.left));
      it.top = Math.max(-it.height + 2, Math.min(98, it.top));
      renderCanvasShell();
    } else if (drag.type === 'resize') {
      const it = drag.it;
      const dw = (e.clientX - drag.sx) / (ctl._svg.getBoundingClientRect().width) * 100;
      const dh = (e.clientY - drag.sy) / (ctl._svg.getBoundingClientRect().height) * 100;
      it.width = Math.max(4, drag.ow + dw);
      it.height = Math.max(3, drag.oh + dh);
      drag.moved = true;
      renderCanvasShell();
    } else if (drag.type === 'selrect') {
      drag.cx = stagePoint(e).x; drag.cy = stagePoint(e).y;
      const x = Math.min(drag.sx, drag.cx), y = Math.min(drag.sy, drag.cy);
      const w = Math.abs(drag.cx - drag.sx), h = Math.abs(drag.cy - drag.sy);
      let box = ctl._viewport.querySelector('.sl-selrect');
      if (!box) { box = svgEl('rect', { class: 'sl-selrect', fill: 'rgba(79,70,229,.08)', stroke: 'var(--acc, #4f46e5)', 'stroke-width': 2, 'stroke-dasharray': '8 5' }); ctl._viewport.appendChild(box); }
      box.setAttribute('x', x); box.setAttribute('y', y);
      box.setAttribute('width', w); box.setAttribute('height', h);
    } else if (drag.type === 'ghost') {
      const p = stagePoint(e);
      const x = Math.min(drag.sx, p.x), y = Math.min(drag.sy, p.y);
      drag.ghost.style.cssText = `position:absolute;left:${x / DESIGN.w * 100}%;top:${y / DESIGN.h * 100}%;width:${Math.abs(p.x - drag.sx) / DESIGN.w * 100}%;height:${Math.abs(p.y - drag.sy) / DESIGN.h * 100}%;border:1.5px dashed var(--acc, #4f46e5);background:rgba(79,70,229,.12);pointer-events:none;z-index:5`;
    }
  }
  function onCanvasUp() {
    window.removeEventListener('pointermove', onCanvasMove);
    const sl = curSlide();
    if (drag?.type === 'item' && drag.moved) { resolveItemOverlap(sl, drag.it); markDirty(); }
    else if (drag?.type === 'resize' && drag.moved) markDirty();
    else if (drag?.type === 'selrect') {
      ctl._viewport.querySelector('.sl-selrect')?.remove();
      const x = Math.min(drag.sx, drag.cx), y = Math.min(drag.sy, drag.cy);
      const w = Math.abs(drag.cx - drag.sx), h = Math.abs(drag.cy - drag.sy);
      const hit = new Set();
      for (const it of (sl?.items || [])) {
        const ix = pctToPx(it.left, 'x', DESIGN.w, DESIGN.h), iy = pctToPx(it.top, 'y', DESIGN.w, DESIGN.h);
        const iw = pctToPx(it.width, 'w', DESIGN.w, DESIGN.h), ih = pctToPx(it.height, 'h', DESIGN.w, DESIGN.h);
        if (ix + iw >= x && ix <= x + w && iy + ih >= y && iy <= y + h) hit.add(it.id);
      }
      ctl.multiSel = hit;
      if (hit.size) toast(`已选中 ${hit.size} 个对象（Delete 删除 / 右键操作）`);
      renderItemToolbar();
    } else if (drag?.type === 'ghost') {
      drag.ghost?.remove();
      const p = drag.end || { x: drag.sx, y: drag.sy };
      finishGhostAdd(drag.tool, { x: Math.min(drag.sx, p.x), y: Math.min(drag.sy, p.y), w: Math.abs(p.x - drag.sx), h: Math.abs(p.y - drag.sy) });
    }
    drag = null;
  }
  function startGhostAdd(p) {
    const ghost = document.createElement('div');
    ctl._stage.appendChild(ghost);
    drag = { type: 'ghost', tool: ctl._addTool, sx: p.x, sy: p.y, ghost };
    toast('拖出区域创建「' + ITEM_TOOLS.find(t => t.id === ctl._addTool)?.name + '」');
  }
  function finishGhostAdd(tool, rect) {
    const sl = curSlide();
    if (!sl) { ctl._addTool = null; return; }
    const props = {
      left: Math.max(0, Math.min(96, pxToPct(rect.x, 'x', DESIGN.w, DESIGN.h))),
      top: Math.max(0, Math.min(96, pxToPct(rect.y, 'y', DESIGN.w, DESIGN.h))),
      width: Math.max(6, pxToPct(rect.w, 'w', DESIGN.w, DESIGN.h)),
      height: Math.max(5, pxToPct(rect.h, 'h', DESIGN.w, DESIGN.h)),
    };
    const it = createItem(tool === 'shape' ? 'shape' : tool, tool === 'text' ? { ...props, text: '双击编辑文本', style: { size: 22 } } : tool === 'shape' ? { ...props, shape: 'rect', style: { bg: 'rgba(79,70,229,.3)', stroke: 'var(--acc, #4f46e5)' } } : props);
    sl.items.push(it);
    ctl.selItem = it.id;
    ctl._addTool = null;
    markDirty(); renderCanvasShell();
    if (tool === 'text') toast('文本框已创建（双击编辑）');
  }
  function deleteSelectedItems() {
    const sl = curSlide();
    if (!sl) return;
    if (ctl.multiSel?.size) {
      const n = ctl.multiSel.size;
      sl.items = sl.items.filter(it => !ctl.multiSel.has(it.id));
      ctl.multiSel.clear();
      markDirty(); renderCanvasShell();
      toast(`已删除 ${n} 个对象`);
    } else if (ctl.selItem) {
      sl.items = sl.items.filter(it => it.id !== ctl.selItem);
      ctl.selItem = null;
      markDirty(); renderCanvasShell();
      renderItemToolbar();
    }
  }
  function showItemMenu(x, y, it) {
    document.querySelector('.mazz-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'mazz-menu';
    const items = [];
    if (it.type === 'text') items.push({ label: '编辑文本', fn: () => editTextItem(it) });
    // 逐点揭示（W39 reveal 引擎编辑器侧：order=max+1 入列 / 移出归 null）
    const rv = it.reveal?.order | 0;
    items.push(rv >= 1
      ? { label: `移出揭示序列（当前 #${rv}）`, fn: () => { it.reveal = null; markDirty(); renderCanvasShell(); } }
      : { label: '加入揭示序列（放映逐点显形）', fn: () => {
          const mx = Math.max(0, ...(curSlide()?.items || []).map(x => x.reveal?.order | 0));
          it.reveal = { mode: 'click', order: mx + 1 };
          markDirty(); renderCanvasShell(); toast(`揭示次序 #${mx + 1}（放映时 →/空格 逐点显形）`);
        } });
    items.push({ label: `${it.pinned ? '✓ ' : ''}钉住位置`, fn: () => { it.pinned = !it.pinned; markDirty(); renderCanvasShell(); } });
    items.push({ label: '自动避让', fn: () => { resolveItemOverlap(curSlide(), it); markDirty(); renderCanvasShell(); } });
    if (ctl.multiSel?.size >= 3) items.push(
      { label: '水平等距分布', fn: () => { distributeItems(curSlide(), ctl.multiSel, 'x'); markDirty(); renderCanvasShell(); } },
      { label: '垂直等距分布', fn: () => { distributeItems(curSlide(), ctl.multiSel, 'y'); markDirty(); renderCanvasShell(); } });
    items.push('-');
    items.push({ label: '删除', fn: () => deleteSelectedItems() });
    for (const it2 of items) {
      if (it2 === '-') { const s = document.createElement('div'); s.className = 'mazz-menu-sep'; menu.appendChild(s); continue; }
      const row = document.createElement('div');
      row.className = 'mazz-menu-item';
      row.textContent = it2.label;
      row.addEventListener('click', () => { menu.remove(); it2.fn?.(); });
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, innerWidth - rect.width - 8) + 'px';
    menu.style.top = Math.min(y, innerHeight - rect.height - 8) + 'px';
    setTimeout(() => window.addEventListener('mousedown', (e) => { if (!menu.contains(e.target)) menu.remove(); }, { once: true }), 0);
  }
  function editTextItem(it) {
    const v = window.prompt?.('编辑文本', it.lines?.[0]?.text || it.list?.items?.map(x => x.text).join('\n') || '') ?? null;
    if (v == null) return;
    if (it.list) it.list = { items: v.split('\n').filter(Boolean).map(t => ({ text: t, icon: '•' })) };
    else it.lines = [{ text: v, style: it.lines?.[0]?.style || null }];
    markDirty(); renderCanvasShell();
  }

  /** Item 加建工具条（W37：六件+选中样式栏） */
  function renderItemToolbar() {
    let bar = ctl.v2Canvas.querySelector('.sl-v2-tools');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'sl-v2-tools';
      bar.style.cssText = 'position:absolute;left:12px;top:12px;display:flex;gap:5px;z-index:6;flex-wrap:wrap;max-width:70%';
      bar.addEventListener('pointerdown', (e) => e.stopPropagation()); // 工具条压在画布上——拦截 pointerdown 防误触 selrect/ghost（否则点工具钮会在工具条位置生出一个微小对象）
      ctl._stage.appendChild(bar);
    }
    const sel = ctl.selItem ? curSlide()?.items.find(x => x.id === ctl.selItem) : null;
    bar.innerHTML = ITEM_TOOLS.map(t => `<button data-t="${t.id}" class="sl-tool ${ctl._addTool === t.id ? 'on' : ''}" title="加${t.name}（点击后画布拖框）">${iconHtml(t.ico)} ${t.name}</button>`).join('')
      + (sel ? `<span style="width:1px;background:rgba(255,255,255,.2)"></span><span style="font-size:11px;color:#ccc;align-self:center">${sel.type}${(sel.reveal?.order | 0) >= 1 ? '（揭示#' + sel.reveal.order + '）' : ''}${ctl.multiSel?.size ? '（+' + (ctl.multiSel.size - 1) + '）' : ''}</span><button data-a="del" title="删除选中（Delete）">✕</button>` : '');
    bar.querySelectorAll('[data-t]').forEach(b => {
      b.style.cssText = `border:1px solid rgba(255,255,255,.18);background:${b.classList.contains('on') ? 'var(--acc,#4f46e5)' : 'rgba(20,20,24,.7)'};color:#eee;border-radius:6px;padding:3px 8px;font-size:11.5px;cursor:pointer;backdrop-filter:blur(4px)`;
      b.addEventListener('click', () => {
        ctl._addTool = ctl._addTool === b.dataset.t ? null : b.dataset.t;
        renderItemToolbar();
      });
    });
    bar.querySelector('[data-a="del"]')?.addEventListener('click', deleteSelectedItems);
  }

  /** 手机遥控面板（W40：QR 扫码即连+在线数+伺服开关；指令消费：ctl._presenter 同口） */
  function showRemotePanel() {
    document.querySelector('.sl-remote-card')?.remove();
    window.mazz.invoke('slideRemote:start').then((r) => {
      if (!r?.url) { toast('遥控伺服启动失败'); return; }
      const card = document.createElement('div');
      card.className = 'sl-remote-card';
      card.innerHTML = `
        <div class="h"><b>📱 手机遥控</b><span class="cnt">在线 <em class="n">0</em> 台</span><i class="x" title="关闭面板（伺服保持）">✕</i></div>
        ${r.qr ? `<img class="qr" src="${r.qr}" alt="扫码进遥控页">` : ''}
        <div class="url">${r.url}</div>
        <div class="tip">手机与电脑同一局域网，扫码进页即遥控<br>先按 F5 放映，◀▶ 翻帧、黑屏（B）同键</div>
        <button class="stop">停止遥控伺服</button>`;
      document.body.appendChild(card);
      card.querySelector('.x').addEventListener('click', () => card.remove());
      card.querySelector('.stop').addEventListener('click', async () => {
        await window.mazz.invoke('slideRemote:stop').catch(() => {});
        card.remove(); toast('遥控伺服已停止');
      });
      const syncN = (n) => { const em = card.querySelector('.n'); if (em) em.textContent = String(n); };
      window.mazz.invoke('slideRemote:status').then(s => syncN(s?.clients || 0)).catch(() => {});
      if (!ctl._remoteEvtOn) {
        ctl._remoteEvtOn = true;
        window.mazz.on('slideRemote:client', (p) => { const em = document.querySelector('.sl-remote-card .n'); if (em) em.textContent = String(p?.clients || 0); });
        window.mazz.on('slideRemote:cmd', (p) => {
          const pr = ctl._presenter;
          if (!pr) {
            const now = Date.now();
            if (!ctl._remoteToastAt || now - ctl._remoteToastAt > 4000) { ctl._remoteToastAt = now; toast('手机遥控待命：请先放映（F5）'); }
            return;
          }
          if (p?.cmd === 'next') pr.step(1);
          else if (p?.cmd === 'prev') pr.step(-1);
          else if (p?.cmd === 'black') pr.black();
        });
      }
    }).catch(() => toast('遥控伺服启动失败'));
  }

  function renderV2All() { renderPageList(); renderCanvasShell(); }
  function markDirty() { ctl.doc2.meta.modifiedAt = Date.now(); window.MazzHost?.notifyChange(container); }

  ctl.showRemotePanel = showRemotePanel; // W40：命令面在模块作用域，经 ctl 钩子取（TDZ 同款纪律）
  ctl.enterV2 = enterV2;
  ctl.exitV2 = exitV2;
  ctl.renderV2All = renderV2All;
  ctl.curSlide = curSlide;
  ctl.markDirty = markDirty;
  return ctl;
}

function withCtl(fn) { return () => { if (current) fn(current); } }

/** AI 拆段成页（W41：无结构文稿→AI 拆→v2 本体；死转不带 BridgeRef） */
async function aiSplitMarkdownToSlides(md, title, { skipConfirm = false } = {}) {
  if (!skipConfirm) {
    const r = await window.mazz.invoke('dialog:confirm', {
      title: 'AI 拆段', message: '文档缺少标题/列表结构。\n用 AI 把文稿拆成演示页？', buttons: ['AI 拆段', '取消'],
    }).catch(() => null);
    if (!(r === 0 || r?.button === 0 || r === true)) return;
  }
  const { getProviderConfig, providerReady, chat } = await import('../factory/provider.js');
  const cfg = await getProviderConfig('blueprint');
  if (!providerReady(cfg)) { toast('请先在「智能创作」配置 AI（baseURL/模型/Key）'); return; }
  toast('AI 拆段中…');
  let text;
  try {
    text = await chat({
      cfg, role: 'blueprint', temperature: 0.3,
      system: '你是演示文稿排版助手。把用户文稿拆成演示页序列，只回 JSON 数组，每项 {"title":"页标题","bullets":["要点"],"notes":"讲者备注"}。3–12 页，每页 3–6 条要点，要点 ≤20 字。不输出任何 JSON 以外的文字。',
      user: String(md || '').slice(0, 12000),
    });
  } catch (e) { toast('AI 拆段失败：' + String(e.message || e).slice(0, 120)); return; }
  // 宽容解析：剥围栏/抓首个 JSON 数组
  const m = String(text || '').replace(/```(?:json)?/gi, '').match(/\[[\s\S]*\]/);
  let pages = [];
  try { pages = JSON.parse(m?.[0] || '[]'); } catch { pages = []; }
  pages = (Array.isArray(pages) ? pages : []).filter(p => p && (p.title || (p.bullets || []).length));
  if (!pages.length) { toast('AI 拆段失败：返回无法解析（换个模型再试）'); return; }
  const doc = createSlideDoc(title || 'AI 演示', 'night');
  for (const p of pages.slice(0, 12)) {
    const items = [];
    if (p.title) items.push(createItem('text', { text: String(p.title).slice(0, 40), style: { size: 40, bold: true, align: 'center' }, left: 10, top: 12, width: 80, height: 14 }));
    const bl = (p.bullets || []).filter(Boolean).slice(0, 6);
    if (bl.length) items.push(createItem('text', { left: 12, top: p.title ? 32 : 20, width: 76, height: p.title ? 58 : 70, list: { items: bl.map(t => ({ text: String(t).slice(0, 60), icon: '•' })) }, style: { size: 24 } }));
    addSlideToDoc(doc, createV2Slide(null, { notes: String(p.notes || ''), items }));
  }
  window.MazzHost?.openTab('slide', { title: (title || 'AI 演示') + '.mazzslide', content: serializeDoc(doc) });
  toast(`AI 拆段完成：${doc.layouts.main.frames.length} 页（本体死转，改文稿不联动）`);
}

// ==================== 模块契约 ====================
export default {
  displayName: '演示',
  icon: '📽',

  create(container) {
    const ctl = createSlide(container);
    instances.set(container, ctl);
    window.__activeSlideCtl = ctl; // 打印预览/桥接取数
    return { container };
  },
  activate(container) {
    const ctl = instances.get(container);
    if (!ctl) return;
    current = ctl;
    contextKeys.set('module', MODULE);
    contextKeys.set('hasSelection', false);
  },
  deactivate(container) {
    if (current === instances.get(container)) current = null;
  },

  getContent(state) {
    const ctl = instances.get(state.container);
    if (!ctl) return '';
    if (ctl.isV2) return serializeDoc(ctl.doc2); // v2 模式存 v2 文档（W36）
    return ctl.outlineEl.value;
  },
  /** 按扩展名导出：.pptx → base64；其余回落 getContent（大纲文本） */
  async exportAs(ext, state) {
    const ctl = instances.get(state.container);
    if (!ctl || ext !== '.pptx') return null;
    const { exportPptx } = await import('./pptx.js');
    const buf = await exportPptx(ctl.slides, ctl.theme);
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { base64: btoa(s) };
  },
  setContent(data, state) {
    const ctl = instances.get(state.container);
    if (!ctl) return;
    const text = typeof data === 'string' ? data : '';
    const trimmed = text.trim();
    // 空档= v2 起手式（file.newSlide 开空档默认 v2 文档模型（W36）——空串走 v1 空大纲实锤修正）
    if (!trimmed) {
      const doc = createSlideDoc('未命名演示', 'night');
      addSlideToDoc(doc, createV2Slide(null, { items: [
        createItem('text', { text: '演示文稿标题', style: { size: 44, bold: true, align: 'center' }, left: 10, top: 32, width: 80, height: 16 }),
        createItem('text', { left: 14, top: 54, width: 72, height: 34, list: { items: [{ text: '要点一', icon: '•' }, { text: '要点二', icon: '•' }, { text: '要点三', icon: '•' }] }, style: { size: 24 } }),
      ] }));
      ctl.enterV2(doc);
      return;
    }
    // v2 统一入口（W36）：JSON v2 直接进；v1 大纲也一律 parseDoc lazy 迁移进 v2 编辑面（再造演示全迁——v1 编辑器退位）
    const doc = parseDoc(text);
    if (doc?.v === 2) {
      if (doc.theme) ctl.themeId = doc.theme;
      else {
        const themeM = /^<!--theme:(\w+)-->/.exec(trimmed);
        if (themeM) { ctl.themeId = themeM[1]; doc.theme = themeM[1]; }
      }
      ctl.enterV2(doc);
      return;
    }
    // parseDoc 也解不出的兜底（理论上不会到）：v1 现状路径
    if (ctl.isV2) ctl.exitV2();
    const themeM = /^<!--theme:(\w+)-->/.exec(trimmed);
    if (themeM) ctl.themeId = themeM[1];
    ctl.outlineEl.value = text;
    ctl.slides = parseOutline(text);
    ctl.current = 0;
    ctl.render();
  },
  newDocument(state) {
    const ctl = instances.get(state.container);
    if (!ctl) return;
    // v2 起手式（W36：新建演示默认 v2 文档模型——v1 大纲开旧档时仍走 v1 路径）
    const doc = createSlideDoc('未命名演示', 'night');
    addSlideToDoc(doc, createV2Slide(null, { items: [
      createItem('text', { text: '演示文稿标题', style: { size: 44, bold: true, align: 'center' }, left: 10, top: 32, width: 80, height: 16 }),
      createItem('text', { left: 14, top: 54, width: 72, height: 34, list: { items: [{ text: '要点一', icon: '•' }, { text: '要点二', icon: '•' }, { text: '要点三', icon: '•' }] }, style: { size: 24 } }),
    ] }));
    ctl.enterV2(doc);
  },
  getCharCount(state) {
    const ctl = instances.get(state.container);
    if (!ctl) return 0;
    return ctl.isV2 ? serializeDoc(ctl.doc2).length : ctl.outlineEl.value.length;
  },
  getCursorPos(state) {
    const ctl = instances.get(state.container);
    if (!ctl) return '';
    if (ctl.isV2) {
      const i = ctl.doc2.layouts.main.frames.findIndex(f => f.slideId === ctl.curSlideId);
      return `第 ${i + 1}/${ctl.doc2.layouts.main.frames.length} 页（v2）`;
    }
    return `第 ${ctl.current + 1}/${ctl.slides.length} 页`;
  },

  toolbarHTML: `
    <div class="rb-group" data-label="页面">
      <button class="rb-btn" data-command="slide.prev"><i class="ico">◀</i><span>上一页</span></button>
      <button class="rb-btn" data-command="slide.next"><i class="ico">▶</i><span>下一页</span></button>
      <button class="rb-btn" data-command="slide.add"><i class="ico">＋</i><span>新页</span></button>
    </div>
    <div class="rb-group" data-label="主题">
      ${SLIDE_THEMES.map(t => `<button class="rb-btn" data-command="slide.theme" data-slide-theme="${t.id}" title="主题：${t.name}"><i class="ico" style="color:${t.accent}">●</i><span>${t.name}</span></button>`).join('')}
    </div>
    <div class="rb-group" data-label="画布">
      <button class="rb-btn" data-command="slide.canvasMode"><i class="ico">${iconHtml('✏')}</i><span>画布</span></button>
      <button class="rb-btn" data-command="slide.addText"><i class="ico">T</i><span>文本框</span></button>
      <button class="rb-btn" data-command="slide.addRect"><i class="ico">${iconHtml('▭')}</i><span>矩形</span></button>
      <button class="rb-btn" data-command="slide.addEllipse"><i class="ico">${iconHtml('◯')}</i><span>椭圆</span></button>
      <button class="rb-btn" data-command="slide.addImage"><i class="ico">${iconHtml('🖼')}</i><span>图片</span></button>
      <div id="sl-bg-picker"></div>
    </div>
    <div class="rb-group" data-label="放映">
      <button class="rb-btn" data-command="slide.present"><i class="ico">${iconHtml('▶')}</i><span>放映</span></button>
      <button class="rb-btn" data-command="slide.presentPv"><i class="ico">${iconHtml('🖥')}</i><span>演讲者</span></button>
      <button class="rb-btn" data-command="slide.remote"><i class="ico">${iconHtml('📱')}</i><span>遥控</span></button>
      <button class="rb-btn" data-command="slide.exportPptx"><i class="ico">${iconHtml('📦')}</i><span>导出pptx</span></button>
      <button class="rb-btn" data-command="slide.printPreview"><i class="ico">${iconHtml('🖨')}</i><span>打印/导PDF</span></button>
    </div>`,
  bindToolbar(panel) {
    panel.querySelectorAll('[data-command]').forEach(btn => {
      btn.addEventListener('click', () => window.MazzCommands.execute(btn.dataset.command, { theme: btn.dataset.slideTheme }));
    });
    new ColorPicker(panel.querySelector('#sl-bg-picker'), {
      label: '背景',
      onChange: (color) => window.MazzCommands.execute('slide.setBackground', { color }),
    });
  },

  contributes: {
    commands: [
      { id: 'slide.prev', title: '上一页', group: '演示', when: "module=='slide'",
        run: withCtl(ctl => { if (ctl.current > 0) { ctl.current--; ctl.render(); } }) },
      { id: 'slide.next', title: '下一页', group: '演示', when: "module=='slide'",
        run: withCtl(ctl => { if (ctl.current < ctl.slides.length - 1) { ctl.current++; ctl.render(); } }) },
      { id: 'slide.add', title: '新建页面', icon: '＋', group: '演示', when: "module=='slide'",
        run: withCtl(ctl => {
          ctl.outlineEl.value += (ctl.outlineEl.value.endsWith('\n') ? '' : '\n') + '---\n# 新页面\n- 要点\n';
          ctl.sync();
          ctl.current = ctl.slides.length - 1;
          ctl.render();
        }) },
      { id: 'slide.theme', title: '切换主题', group: '演示', when: "module=='slide'",
        run: (payload) => withCtl(ctl => {
          if (payload?.theme) {
            ctl.themeId = payload.theme;
            const text = ctl.outlineEl.value.replace(/^<!--theme:\w+-->\n?/, '');
            ctl.outlineEl.value = `<!--theme:${ctl.themeId}-->\n` + text;
            ctl.render();
            toast(`主题已切换：${themeById(ctl.themeId).name}`);
          }
        })() },
      { id: 'slide.canvasMode', title: '画布模式', icon: '✏', group: '演示', when: "module=='slide'",
        run: withCtl(ctl => {
          ctl.canvasMode = !ctl.canvasMode;
          ctl.tool = null;
          ctl.render();
          toast(ctl.canvasMode ? '画布模式：选择文本框/形状/图片后在页面上拖拽放置' : '已退出画布模式');
        }) },
      { id: 'slide.addText', title: '添加文本框', group: '演示', when: "module=='slide'",
        run: withCtl(ctl => { ctl.canvasMode = true; ctl.tool = 'text'; ctl.render(); toast('在页面上拖拽放置文本框'); }) },
      { id: 'slide.addRect', title: '添加矩形', group: '演示', when: "module=='slide'",
        run: withCtl(ctl => { ctl.canvasMode = true; ctl.tool = 'rect'; ctl.render(); }) },
      { id: 'slide.addEllipse', title: '添加椭圆', group: '演示', when: "module=='slide'",
        run: withCtl(ctl => { ctl.canvasMode = true; ctl.tool = 'ellipse'; ctl.render(); }) },
      { id: 'slide.addImage', title: '添加图片', group: '演示', when: "module=='slide'",
        run: withCtl(ctl => { ctl.canvasMode = true; ctl.tool = 'image'; ctl.render(); }) },
      { id: 'slide.setBackground', title: '本页背景色', group: '演示', when: "module=='slide'",
        run: (payload) => withCtl(ctl => {
          if (payload?.color) {
            ctl.slides[ctl.current].bg = payload.color;
            ctl.syncToOutline();
            ctl.render();
            toast('本页背景已设置');
          }
        })() },
      { id: 'slide.present', title: '开始放映', icon: '▶', group: '演示', when: "module=='slide'",
        run: withCtl(ctl => {
          // v2 放映引擎（W39：编排帧序+四切换+reveal+帧动作）；v1 大纲档走老 Presenter
          if (ctl.isV2 && ctl.doc2) {
            if (!ctl.doc2.layouts.main.frames.some(f => !f.disabled)) { toast('没有可放映的帧（全禁用或空编排）'); return; }
            const fi = ctl.doc2.layouts.main.frames.findIndex(f => f.slideId === ctl.curSlideId && !f.disabled);
            new Presenter2({ ctl, startIndex: fi >= 0 ? fi : ctl.doc2.layouts.main.frames.findIndex(f => !f.disabled) });
            return;
          }
          new Presenter({ slides: ctl.slides, theme: ctl.theme, startIndex: ctl.current });
        }) },
      { id: 'slide.presentPv', title: '演讲者视图放映', icon: '🖥', group: '演示', when: "module=='slide'",
        run: withCtl(ctl => {
          if (ctl.isV2 && ctl.doc2) {
            if (!ctl.doc2.layouts.main.frames.some(f => !f.disabled)) { toast('没有可放映的帧（全禁用或空编排）'); return; }
            const fi = ctl.doc2.layouts.main.frames.findIndex(f => f.slideId === ctl.curSlideId && !f.disabled);
            new Presenter2({ ctl, presenterView: true, startIndex: fi >= 0 ? fi : ctl.doc2.layouts.main.frames.findIndex(f => !f.disabled) });
            return;
          }
          const p = new Presenter({ slides: ctl.slides, theme: ctl.theme, startIndex: ctl.current });
          p.presenterView = true;
          p.render();
        }) },
      { id: 'slide.remote', title: '手机遥控（扫码即连）', icon: '📱', group: '演示', when: "module=='slide'",
        run: withCtl(ctl => {
          if (!ctl.isV2 || !ctl.doc2) { toast('手机遥控仅 v2 演示文档支持'); return; }
          ctl.showRemotePanel();
        }) },
      { id: 'slide.exportPptx', title: '导出 PPTX', icon: '📦', group: '演示', when: "module=='slide'",
        run: (payload) => withCtl(async (ctl) => {
          const isV2 = ctl.isV2 && ctl.doc2;
          const p = payload?.path || await window.mazz.invoke('dialog:saveFile', {
            defaultPath: (isV2 ? (ctl.doc2.name || '演示文稿') : (ctl.slides[0]?.title || '演示文稿')) + '.pptx',
            filters: [{ name: 'PowerPoint 演示文稿', extensions: ['pptx'] }],
          });
          if (!p) return;
          toast('正在编译 pptx…');
          try {
            // v2 走对象级导出（W42：Item→OOXML+reveal→Animation）；v1 大纲档走老管线
            const buf = isV2 ? await exportPptxV2(ctl.doc2, ctl.themeId) : await exportPptx(ctl.slides, ctl.theme);
            const bytes = new Uint8Array(buf);
            let s = '';
            for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
            await window.mazz.invoke('fs:writeFileBase64', { path: p, base64: btoa(s) });
            toast(`pptx 已导出：${p.split(/[\\/]/).pop()}`);
          } catch (e) {
            toast('pptx 导出失败：' + e.message);
          }
        })() },
      // 桥接 #3：文稿 → 演示（W41 一键成页本体：结构化死转 v2 文档直接落；无结构走 AI 拆段——死转不带 BridgeRef）
      { id: 'slide.compileFromMarkdown', title: '编译为演示（文稿 → 演示）', icon: '📽', group: '桥接',
        when: "module=='markdown'",
        run: (payload) => {
          // 从活动 markdown 实例取内容（优先当前标签页——多页并开不吃错）
          const reg = window.MazzModules;
          const activeId = window.MazzShell?.tabs?.activeId;
          const act = reg?.instances?.get?.(activeId);
          const inst = act?.name === 'markdown' ? act : [...(reg?.instances?.values() || [])].find(i => i.name === 'markdown');
          if (inst) {
            const md = inst.def.getContent(inst.state);
            const tabTitle = window.MazzShell?.tabs?.tabs?.find(t => t.id === activeId)?.title;
            const title = (tabTitle || inst.def.title || '演示').replace(/\.(md|markdown|txt)$/i, '');
            if (/^(#{1,2}\s|###\s|[-*]\s|>)/m.test(md)) {
              // 有结构：死转本体（outline→migrateFromOutline→v2 文档直落，不经大纲中间态）
              const doc = migrateFromOutline(markdownToOutline(md));
              doc.name = title;
              window.MazzHost?.openTab('slide', { title: title + '.mazzslide', content: serializeDoc(doc) });
              toast(`已编译为演示：${doc.layouts.main.frames.length} 页（本体死转，改文稿不联动）`);
              return;
            }
            // 无结构：AI 拆段成页（autoConfirm=测试口：原生确认框不阻塞自动化）
            aiSplitMarkdownToSlides(md, title, { skipConfirm: !!payload?.autoConfirm });
            return;
          }
          toast('未找到活动的 Markdown 文档');
        } },
    ],
    keybindings: [
      { command: 'slide.prev', key: 'pageup', when: "module=='slide'" },
      { command: 'slide.next', key: 'pagedown', when: "module=='slide'" },
      { command: 'slide.present', key: 'f5', when: "module=='slide'" },
      { command: 'slide.presentPv', key: 'shift+f5', when: "module=='slide'" },
    ],
    menus: {},
    bridges: [],
    aiActions: [],
  },
};
