// renderer/modules/slide/index.js —— 演示模块（slide.js）：大纲 → 成稿，画布双编辑，PptxGenJS 编译
import { parseOutline, serializeOutline, markdownToOutline } from './outline.js';
import { SLIDE_THEMES, themeById } from './themes.js';
import { renderSlideHTML } from './render.js';
import { Presenter } from './present.js';
import { exportPptx } from './pptx.js';
import { contextKeys } from '../../core/contextkey-service.js';
import { toast, inputModal } from '../../shell/shell.js';
import { FontFamilyPicker, FontSizePicker, ColorPicker } from '../../shell/pickers.js';

const MODULE = 'slide';
const instances = new Map();
let current = null;

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
    get theme() { return themeById(ctl.themeId); },
    sync: () => syncFromOutline(),
    render: () => renderAll(),
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
    ctl.stageEl.innerHTML = s ? renderSlideHTML(s, ctl.theme, { scale: 1, canvasMode: ctl.canvasMode }) : '';
    bindCanvasEvents();
    renderStyleBar();
    ctl.thumbsEl.innerHTML = '';
    ctl.slides.forEach((sl, i) => {
      const t = document.createElement('div');
      t.className = 'sl-thumb' + (i === ctl.current ? ' on' : '');
      t.innerHTML = renderSlideHTML(sl, ctl.theme, { scale: 0.16 });
      t.addEventListener('click', () => { ctl.current = i; renderAll(); });
      ctl.thumbsEl.appendChild(t);
    });
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
                const b64 = await window.mazz.invoke('fs:readFileBase64', { path });
                el.src = 'data:image/png;base64,' + b64;
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

    // 选中元素高亮 + 缩放手柄
    if (ctl.selEl >= 0) {
      const el = slideEl.querySelector(`[data-el="${ctl.selEl}"]`);
      if (el) {
        el.classList.add('sel');
        const h = document.createElement('div');
        h.className = 'sl-handle';
        el.appendChild(h);
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

  // 初始内容
  ctl.outlineEl.value = `<!--theme:ink-->\n` + serializeOutline(ctl.slides);
  renderAll();
  return ctl;
}

function withCtl(fn) { return () => { if (current) fn(current); } }

// ==================== 模块契约 ====================
export default {
  displayName: '演示',
  icon: '📽',

  create(container) {
    const ctl = createSlide(container);
    instances.set(container, ctl);
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
    return ctl ? ctl.outlineEl.value : '';
  },
  setContent(data, state) {
    const ctl = instances.get(state.container);
    if (!ctl) return;
    const text = typeof data === 'string' ? data : '';
    const themeM = /^<!--theme:(\w+)-->/.exec(text.trim());
    if (themeM) ctl.themeId = themeM[1];
    ctl.outlineEl.value = text;
    ctl.slides = parseOutline(text);
    ctl.current = 0;
    ctl.render();
  },
  newDocument(state) {
    const ctl = instances.get(state.container);
    if (!ctl) return;
    ctl.outlineEl.value = DEFAULT_OUTLINE;
    ctl.sync();
  },
  getCharCount(state) {
    const ctl = instances.get(state.container);
    return ctl ? ctl.outlineEl.value.length : 0;
  },
  getCursorPos(state) {
    const ctl = instances.get(state.container);
    return ctl ? `第 ${ctl.current + 1}/${ctl.slides.length} 页` : '';
  },

  toolbarHTML: `
    <div class="rb-group" data-label="页面">
      <button class="rb-btn" data-command="slide.prev"><i class="ico">◀</i><span>上一页</span></button>
      <button class="rb-btn" data-command="slide.next"><i class="ico">▶</i><span>下一页</span></button>
      <button class="rb-btn" data-command="slide.add"><i class="ico">＋</i><span>新页</span></button>
    </div>
    <div class="rb-group" data-label="主题">
      ${SLIDE_THEMES.map(t => `<button class="rb-btn" data-command="slide.theme" data-theme="${t.id}" title="主题：${t.name}"><i class="ico" style="color:${t.accent}">●</i><span>${t.name}</span></button>`).join('')}
    </div>
    <div class="rb-group" data-label="画布">
      <button class="rb-btn" data-command="slide.canvasMode"><i class="ico">✏</i><span>画布</span></button>
      <button class="rb-btn" data-command="slide.addText"><i class="ico">T</i><span>文本框</span></button>
      <button class="rb-btn" data-command="slide.addRect"><i class="ico">▭</i><span>矩形</span></button>
      <button class="rb-btn" data-command="slide.addEllipse"><i class="ico">◯</i><span>椭圆</span></button>
      <button class="rb-btn" data-command="slide.addImage"><i class="ico">🖼</i><span>图片</span></button>
      <div id="sl-bg-picker"></div>
    </div>
    <div class="rb-group" data-label="放映">
      <button class="rb-btn" data-command="slide.present"><i class="ico">▶</i><span>放映</span></button>
      <button class="rb-btn" data-command="slide.presentPv"><i class="ico">🖥</i><span>演讲者</span></button>
      <button class="rb-btn" data-command="slide.exportPptx"><i class="ico">📦</i><span>导出pptx</span></button>
    </div>`,
  bindToolbar(panel) {
    panel.querySelectorAll('[data-command]').forEach(btn => {
      btn.addEventListener('click', () => window.MazzCommands.execute(btn.dataset.command, { theme: btn.dataset.theme }));
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
        run: withCtl(ctl => new Presenter({ slides: ctl.slides, theme: ctl.theme, startIndex: ctl.current })) },
      { id: 'slide.presentPv', title: '演讲者视图放映', icon: '🖥', group: '演示', when: "module=='slide'",
        run: withCtl(ctl => {
          const p = new Presenter({ slides: ctl.slides, theme: ctl.theme, startIndex: ctl.current });
          p.presenterView = true;
          p.render();
        }) },
      { id: 'slide.exportPptx', title: '导出 PPTX', icon: '📦', group: '演示', when: "module=='slide'",
        run: withCtl(async (ctl) => {
          const p = await window.mazz.invoke('dialog:saveFile', {
            defaultPath: (ctl.slides[0]?.title || '演示文稿') + '.pptx',
            filters: [{ name: 'PowerPoint 演示文稿', extensions: ['pptx'] }],
          });
          if (!p) return;
          toast('正在编译 pptx…');
          try {
            const buf = await exportPptx(ctl.slides, ctl.theme);
            const bytes = new Uint8Array(buf);
            let s = '';
            for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
            await window.mazz.invoke('fs:writeFileBase64', { path: p, base64: btoa(s) });
            toast(`pptx 已导出：${p.split(/[\\/]/).pop()}`);
          } catch (e) {
            toast('pptx 导出失败：' + e.message);
          }
        }) },
      // 桥接 #3：文稿 → PPT（markdown 文档含 ##/--- → 后台编译）
      { id: 'slide.compileFromMarkdown', title: '编译为 PPT（文稿 → 演示）', icon: '📽', group: '桥接',
        when: "module=='markdown'",
        run: () => {
          // 从活动 markdown 实例取内容
          for (const [tabId, inst] of window.MazzModules.instances) {
            if (inst.name !== 'markdown') continue;
            const md = inst.def.getContent(inst.state);
            if (!/^(#{1,2}\s|###\s|[-*]\s|>)/m.test(md)) {
              toast('文档缺少标题/列表结构，无法编译为演示');
              return;
            }
            const outline = markdownToOutline(md);
            window.MazzHost?.openTab('slide', {
              title: (inst.def.title || '演示') + '.mazzslide',
              content: outline,
            });
            toast('PPT 管线就绪：已生成演示大纲，可导出 pptx');
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
