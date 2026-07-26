// v45 实机回归：IPC 白名单完整性 + 帮助章节无空洞 + 图片主题包全量键 + UA 与内核一致 + 导航队列免疫 + PDF 管线 + 写删回退
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'fs';
import path from 'path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8').replace(/\r\n/g, '\n'); // Windows 工作区 CRLF 归一

describe('v45 实机回归', () => {

  test('IPC 白名单完整性（workspace:add 类漏登记绝育）', () => {
    const bridge = readSrc('preload/bridge.js');
    const grab = (name) => new Set([...bridge.split(name)[1].split(']);')[0].matchAll(/'([a-zA-Z0-9:_-]+)'/g)].map(m => m[1]));
    const inv = grab('INVOKE_CHANNELS'), evt = grab('EVENT_CHANNELS');
    const usedI = new Set(), usedE = new Set();
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!['dist', 'vendor', 'node_modules'].includes(e.name)) walk(p); continue; }
        if (!e.name.endsWith('.js')) continue;
        const t = fs.readFileSync(p, 'utf8');
        for (const m of t.matchAll(/mazz\.invoke\(\s*['"`]([a-zA-Z0-9:_-]+)['"`]/g)) usedI.add(m[1]);
        for (const m of t.matchAll(/mazz\.on\(\s*['"`]([a-zA-Z0-9:_-]+)['"`]/g)) usedE.add(m[1]);
      }
    };
    walk(path.resolve('renderer'));
    const missI = [...usedI].filter(c => !inv.has(c));
    const missE = [...usedE].filter(c => !evt.has(c));
    assert.deepEqual(missI, [], `invoke 缺登记: ${missI.join(',')}`);
    assert.deepEqual(missE, [], `event 缺登记: ${missE.join(',')}`);
    for (const c of ['workspace:list', 'workspace:add', 'workspace:remove', 'workspace:rename', 'workspace:setCurrent'])
      assert.ok(inv.has(c), `${c} 必须在白名单`);
    assert.ok(evt.has('workspace:changed'), 'workspace:changed 事件必须在白名单');
  });

  test('帮助章节数组无空洞（双逗号绝育）', async () => {
    const { HELP_SECTIONS } = await import('../../renderer/help/content.js');
    const { SENIOR_SECTIONS } = await import('../../renderer/help/content-senior.js');
    for (const [name, arr] of [['HELP', HELP_SECTIONS], ['SENIOR', SENIOR_SECTIONS]]) {
      assert.equal(arr.filter(x => x).length, arr.length, `${name} 存在稀疏空洞`);
      const ids = arr.map(s => s.id);
      assert.equal(new Set(ids).size, ids.length, `${name} 章节 id 重复`);
    }
  });

  test('图片主题落盘含全量构成主义变量', () => {
    const src = readSrc('renderer/theme-custom.js');
    const seg = src.slice(src.indexOf('packVars'), src.indexOf('packVars') + 900);
    for (const k of ['danger', 'warn', 'ok', 'shadow', 'doc-bg'])
      assert.ok(seg.includes(k), `packVars 缺 ${k}`);
    assert.ok(src.includes("theme:broadcast', { id: 'custom' }"), '图片主题必须广播子窗');
  });

  test('隐私浏览器 UA 与真实内核一致（破 B站 412）', () => {
    const src = readSrc('main/browser-session.js');
    assert.ok(src.includes('process.versions.chrome'), 'UA 必须取 process.versions.chrome');
    const ua = src.split('BROWSER_UA')[1]?.slice(0, 300) || '';
    assert.ok(!/Chrome\/9\d\.0\.0\.0|Chrome\/10\d\.0\.0\.0|Chrome\/11\d\.0\.0\.0|Chrome\/12\d\.0\.0\.0/.test(ua), '不许硬编码过时 UA');
  });

  test('浏览器导航队列免疫拒绝（冻住绝育）', () => {
    const src = readSrc('renderer/modules/browser/index.js');
    assert.ok(src.includes(".catch(() => {});\n    tab.navQueue = tab.navQueue.then"), '队首必须 catch 免疫');
    assert.ok((src.match(/isConnected/g) || []).length >= 3, 'webview 挂载守卫至少 3 处');
  });

  test('导出 PDF 走模块分页管线（不打整窗）', () => {
    const src = readSrc('renderer/shell/shell.js');
    const seg = src.slice(src.indexOf("R('file.exportPDF'"), src.indexOf("R('file.exportPDF'") + 4500);
    assert.ok(seg.includes('buildPrintDocument'), '必须走 buildPrintDocument');
    assert.ok(seg.includes('buildSheetPages'), '表格必须分页管线');
    assert.ok(seg.includes('buildSlidePages'), '演示必须分页管线');
  });

  test('写盘原子回退与删除重试（静态守卫）', () => {
    const main = readSrc('main/main.js');
    assert.ok(main.includes('writeAtomic'), 'writeAtomic 必须存在');
    assert.ok(main.includes("['EPERM', 'EACCES', 'EBUSY']"), 'Windows 占用回退必须存在');
    assert.ok(main.includes('trashItem(norm)') && main.includes('rmSync(norm'), '删除必须 trashItem 重试 + rm 兜底');
    assert.ok(main.includes('suspend()') || readSrc('main/file-watcher.js').includes('suspend'), '监视挂起必须存在');
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes('回收站不可用，已直接删除'), '直删必须如实告知');
  });

  test('外部打开临时文件唯一名（防占用撞名）', () => {
    const src = readSrc('renderer/lib/extern-convert.js');
    assert.ok(src.includes('Date.now().toString(36)'), '占用时必须有唯一名回退');
  });

  test('快捷方式 IconLocation 指向自家 ico（dev 不用 electron.exe）', () => {
    const src = readSrc('main/main.js');
    assert.ok(src.includes("resources', 'icons', 'app.ico"), 'dev 态 IconLocation 必须直指 app.ico');
  });

  test('工作区切换活取根路径+缓存失效+重挂监听', () => {
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes("mazz.on('workspace:changed'"), '壳必须监听 workspace:changed');
    assert.ok(sh.includes('invalidateWsCache'), '必须使 ws-path 缓存失效');
    assert.ok(sh.includes("invoke('workspace:get').catch(() => null)"), 'getWorkspace 必须活取');
  });

  test('浏览器客进程崩溃复活（僵尸标签绝育）', () => {
    const src = readSrc('renderer/modules/browser/index.js');
    assert.ok(src.includes('render-process-gone'), '必须监听客进程崩溃');
    assert.ok(src.includes('reviveView'), '必须有复活函数');
    // 波次二十 WebContentsView 迁移：主进程持有一等视图，webview 标签与 dom-ready 赌注一并废除
    assert.ok(src.includes('bv:create'), '必须走 WebContentsView 创建通道');
    assert.ok(!src.includes("document.createElement('webview')"), 'Electron 路径不得再创建 webview 标签');
  });

  test('分屏预览框清理三路兜底（粘连绝育）', () => {
    const src = readSrc('renderer/shell/shell.js');
    assert.ok(src.includes('cleanup'), '清理必须收拢唯一真源');
    assert.ok(src.includes('armDog') && src.includes('1500'), '看门狗必须有（无 dragover 判死）');
    assert.ok(src.includes("addEventListener('pointerup'"), 'pointerup 兜底必须有（dragend 被源毁灭吞掉的活口）');
    assert.ok(src.includes("addEventListener('blur', cleanup)"), 'blur 兜底必须有');
    assert.ok(src.includes('armDog(); e.preventDefault()') || src.includes('armDog()'), '活跃拖拽必须喂狗');
  });

  test('主题包全量 22 键+结构镜像', () => {
    const store = readSrc('renderer/lib/theme-store.js');
    for (const k of ["'acc'", "'bd'", "'bd2'", "'card'", "'mut'", "'faint'", "'sh'"])
      assert.ok(store.includes(k), `VAR_KEYS 缺 ${k}`);
    assert.ok(store.includes('structure'), 'applyPack 必须支持结构镜像');
    const cust = readSrc('renderer/theme-custom.js');
    assert.ok(cust.includes("structure: 'custom'"), '图片主题包必须声明结构镜像');
    const seg = cust.slice(cust.indexOf('packVars'), cust.indexOf('packVars') + 1200);
    for (const k of ['acc', 'bd2', 'card', 'mut', 'faint', 'sh']) assert.ok(seg.includes(k), `packVars 缺模块键 ${k}`);
  });

  test('码字工厂实时预览+编辑应用回去', () => {
    const src = readSrc('renderer/modules/factory/index.js');
    assert.ok(src.includes('liveStart') && src.includes('liveUpdate') && src.includes('liveDone'), '直播三件套必须存在');
    assert.ok(src.includes('liveEditApply'), '编辑应用必须存在');
    assert.ok(src.includes('buildStateSummaryPrompt(prevSnap'), '应用回去必须重建叙事快照');
  });

  // ==================== v45 波次二 b ====================

  test('播放器：图标 SVG 化 + 快捷键门控 + GIF 忙锁', () => {
    const src = readSrc('renderer/modules/viewer/player.js');
    assert.ok(src.includes("import { iconHtml }"), '播放器必须用 iconHtml');
    assert.ok(!src.includes(">🔊</button>"), '静音不得再用裸 emoji');
    assert.ok(src.includes('offsetParent'), '快捷键必须做可见性门控');
    assert.ok(src.includes('stopPropagation'), '命中必须 stopPropagation 防全局撞车');
    assert.ok(src.includes("btn.disabled = true"), 'GIF 转码必须忙锁');
  });

  test('画板：坐标缩放归一（pane-zoom 漂移绝育）', () => {
    const src = readSrc('renderer/modules/draw/index.js');
    const seg = src.slice(src.indexOf('function toWorld'), src.indexOf('function toWorld') + 700);
    assert.ok(seg.includes('canvas.width / dpr') && seg.includes('rect.width'), 'toWorld 必须除回缩放比');
  });

  test('搜索：类型细分 + 纯文本行跳 + 逐个替换', () => {
    const idx = readSrc('renderer/modules/search/indexer.js');
    for (const g of ['mindmap', 'slide', 'draw']) assert.ok(idx.includes(g), `TYPE_GROUPS 缺 ${g}`);
    const ui = readSrc('renderer/modules/search/index.js');
    assert.ok(ui.includes('jumpToLine'), '纯文本必须行跳');
    assert.ok(ui.includes('data-ln'), '命中必须带行号');
    const rp = readSrc('renderer/modules/search/replace.js');
    assert.ok(rp.includes('replaceSequential'), '必须有逐个替换');
    assert.ok(!ui.includes('请先「预览替换」确认命中后再执行'), '全部替换不得再只是嘴炮');
  });

  test('书库：扁平漫画 + 页宽 + 进度粘滞 + 语言嗅探 + 分类可删', () => {
    const lib = readSrc('renderer/modules/library/index.js');
    assert.ok(lib.includes('flatManga'), '漫画文件夹必须扁平页流');
    assert.ok(lib.includes('pageWidth'), '必须有页宽控制');
    assert.ok(lib.includes('progManualFold'), '进度条手动收起必须粘滞');
    assert.ok(lib.includes('data-delcat'), '分类必须可删');
    assert.ok(lib.includes('Math.max(50,'), '图宽下限必须 50');
    const mobi = readSrc('renderer/modules/library/mobi.js');
    assert.ok(mobi.includes('COMMON_HAN') && mobi.includes('langScore'), 'mobi 必须语言命中率嗅探');
  });

  test('大纲：展收单绑定 + 公共切换函数', () => {
    const src = readSrc('renderer/shell/sidebar-panels.js');
    assert.ok(src.includes('_olSetClosed'), '必须暴露公共切换');
    assert.ok(!src.includes("arrow.closest('.sb-ol-node').classList.toggle('closed')"), '代理双重切换必须清除');
  });

  test('导图：导出剔除交互件 + 打开确定性管道', () => {
    const mm = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(mm.includes('.mm-fold, .mm-wp'), '导出必须剔除折叠钮/手柄');
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes('parseMindmapFile'), '打开必须走确定性解析管道');
    assert.ok(!sh.includes('importMindmapToCtl(filePath);\n      }, 350)'), '350ms 竞态旧管道必须清除');
  });

  test('右键菜单：陈旧检测 + 启动自愈', () => {
    const imp = readSrc('main/importer.js');
    assert.ok(imp.includes('stale'), 'status 必须报陈旧');
    const main = readSrc('main/main.js');
    assert.ok(main.includes('自愈'), '必须有启动自愈');
  });

  test('分屏拖放捕获相 + 拖图让位', () => {
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes("dragover', (e) => {\n      if (!e.dataTransfer?.types?.includes('mazz/tab')) return;\n      // 标签栏") && sh.includes('}, true);'), '分屏 dragover 必须捕获相');
    assert.ok(sh.includes("closest?.('.ProseMirror, [data-file-drop]')"), '编辑器拖图必须让位');
  });

  test('录屏采集存活检测', () => {
    const src = readSrc('renderer/lib/recorder.js');
    assert.ok(src.includes('readyState >= 2') && (src.includes('v.videoWidth > 0') || src.includes('naturalWidth > 0')), '必须有采集存活检测（naturalWidth 兼容自录 img 源）');
  });

  test('文件树图标 SVG 化', () => {
    const src = readSrc('renderer/shell/file-tree.js');
    assert.ok(src.includes("from '../lib/svg-icons.js'"), '文件树必须引图标库');
    assert.ok(src.includes('FT_ICONS'), '必须有图标映射表');
    assert.ok(!src.includes("ico.textContent = entry.isDir ? (isOpen ? '▾' : '▸') : iconFor(entry.name)"), '不得再 textContent 塞 emoji');
  });

  test('主进程 handler 覆盖 preload 全部 invoke 通道（双白名单同步绝育）', () => {
    const bridge = readSrc('preload/bridge.js');
    const inv = [...bridge.split('INVOKE_CHANNELS')[1].split(']);')[0].matchAll(/'([a-zA-Z0-9:_-]+)'/g)].map(m => m[1]);
    // main 目录全部文件合并审计（handler 可能住在任何子模块）
    const main = fs.readdirSync(path.resolve('main')).filter(f => f.endsWith('.js'))
      .map(f => readSrc('main/' + f)).join('\n');
    const missing = inv.filter(ch => !main.includes(`'${ch}'`));
    assert.deepEqual(missing, [], `主进程缺 handler（channel not allowed 的病根）: ${missing.join(',')}`);
  });

  test('F11 全屏逃生三件套', () => {
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes('fs-exit'), '浮动退出钮必须存在');
    assert.ok(sh.includes("window:fullscreen"), '必须监听全屏状态');
    const main = readSrc('main/main.js');
    assert.ok(main.includes("window:isFullScreen"), '主进程必须有 isFullScreen handler');
    assert.ok(main.includes('enter-full-screen'), '必须广播全屏进出');
  });

  test('导图格式解析产物带 v:3（打开为空绝育）', () => {
    const src = readSrc('renderer/modules/mindmap/formats.js');
    assert.ok(src.includes("const newDoc = () => ({ v: 3,"), 'formats newDoc 必须带 v:3');
  });

  test('嵌套窗格分支方向不被 CSS 强压（三轮元凶绝育）', () => {
    const css = readSrc('renderer/styles/base.css').replace(/\/\*[\s\S]*?\*\//g, ''); // 先剥注释（注释里的旧规则描述会误报）
    const m = css.match(/\.pane-branch\s*>\s*\.pane-branch\s*\{[^}]*\}/);
    assert.ok(m, '嵌套分支规则必须存在');
    assert.ok(!/flex-direction\s*:/.test(m[0]), '嵌套分支规则不得强写 flex-direction（row 会被压成 column）');
  });

  test('图标库 MAP 键唯一（43 重复键死代码绝育：后者覆盖前者，风格混库不确定）', () => {
    const src = readSrc('renderer/lib/svg-icons.js');
    const keys = [...src.matchAll(/^\s*'(.*?)': S\(/gm)].map(m => m[1]);
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.ok(keys.length >= 140, `图标库应 ≥140 枚（实际 ${keys.length}）`);
    assert.ok(dup.length === 0, `MAP 存在重复键：${[...new Set(dup)].join(' ')}（后者覆盖前者，生效看行号运气）`);
  });
});
