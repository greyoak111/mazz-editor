// W88 Library final convergence gates.
//
// Most W88 primitives have direct behavioural tests.  The remaining defects
// live inside createLibrary's private controller, so this file executes the
// small pure closures where possible and uses narrow source contracts only for
// lifecycle wiring that cannot be imported without opening a real Library tab.
import './_setup.mjs';
import { readFileSync } from 'node:fs';
import { describe, test, assert } from '../harness.mjs';

const indexUrl = new URL('../../renderer/modules/library/index.js', import.meta.url);
const source = readFileSync(indexUrl, 'utf8');
const mainSource = readFileSync(new URL('../../main/main.js', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('../../renderer/shell/shell.js', import.meta.url), 'utf8');
const {
  default: libraryModule,
  isExplicitMissingSourceStat,
  assertLibrarySourceWithinLimit,
  LIBRARY_SOURCE_LIMITS,
} = await import(indexUrl);

function functionBody(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing ${name}()`);
  const paramsOpen = source.indexOf('(', start);
  let parenDepth = 0;
  let paramsClose = -1;
  for (let i = paramsOpen; i < source.length; i++) {
    if (source[i] === '(') parenDepth++;
    else if (source[i] === ')' && --parenDepth === 0) { paramsClose = i; break; }
  }
  assert.ok(paramsClose > paramsOpen, `unterminated ${name}() parameters`);
  const open = source.indexOf('{', paramsClose);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  assert.fail(`unterminated ${name}()`);
}

function sliceBetween(left, right, from = 0) {
  const start = source.indexOf(left, from);
  assert.ok(start >= 0, `missing source marker: ${left}`);
  const end = source.indexOf(right, start + left.length);
  assert.ok(end > start, `missing source marker after ${left}: ${right}`);
  return source.slice(start, end);
}

function uncaughtAsyncCalls(callee) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${callee}\\s*\\(`);
  const call = new RegExp(`\\b${callee}\\s*\\(`);
  const awaited = new RegExp(`\\bawait\\s+${callee}\\s*\\(`);
  const caught = new RegExp(`\\b${callee}\\s*\\([^;]*\\)\\s*\\.catch\\s*\\(`);
  const guarded = new RegExp(`\\b(?:run|queue|guard|settle|fire|schedule)[A-Za-z0-9_]*\\s*\\([^;]*\\b${callee}\\s*\\(`);
  return source.split(/\r?\n/).flatMap((line, index) => {
    if (!call.test(line) || declaration.test(line) || awaited.test(line) || caught.test(line) || guarded.test(line)) return [];
    return [`${index + 1}: ${line.trim()}`];
  });
}

describe('W88 Library · final correctness and lifecycle gates', () => {
  test('settings CAS uses the same null token that IPC exposes for a missing key', () => {
    assert.match(mainSource, /store\.get\(entry\.key,\s*null\)/,
      'first Library bootstrap must not compare renderer null against main-process undefined forever');
  });

  test('Library locator 只有一个版本仲裁 owner，Shell generic relay 不得强制回灌', () => {
    assert.equal(libraryModule.ownsProgressPersistence, true,
      'Library must declare its workspace-scoped LocatorStore as the sole persistence owner');
    const captureStart = shellSource.indexOf('captureProgressFor(tabId');
    const captureEnd = shellSource.indexOf('\n  async restoreProgressFor', captureStart);
    const capture = shellSource.slice(captureStart, captureEnd);
    assert.match(capture, /inst\?\.def\?\.ownsProgressPersistence\)\s*return/,
      'generic capture must not create a competing whole-record writer');
    const restoreStart = shellSource.indexOf('async restoreProgressFor(tab, inst');
    const restoreEnd = shellSource.indexOf('\n  refreshOpenProgress()', restoreStart);
    const restore = shellSource.slice(restoreStart, restoreEnd);
    assert.match(restore, /inst\?\.def\?\.ownsProgressPersistence\)\s*return/,
      'sync events must not force-apply a remote record over a newer/in-flight local locator');
  });

  test('EPUB cache 与连续视口资源 owner 均绑定当前 LibraryRepository/渲染代次', () => {
    const open = functionBody('openBook');
    assert.match(open, /readBookCache\s*\([\s\S]*?workspace:\s*binding\.repository\.identity\.canonical/,
      '缓存读取路径必须来自页签捕获的 repository workspace');
    assert.match(open, /writeBookCache\s*\([\s\S]*?workspace:\s*binding\.repository\.identity\.canonical/,
      '缓存写入路径必须来自页签捕获的 repository workspace');
    const show = functionBody('showCurrent');
    assert.match(show, /textResourceOwner\s*=\s*Symbol/,
      '每代连续阅读视口必须持有独立章节资源 token');
    assert.match(show, /unloadOutside\?\.\(keepIds,\s*textResourceOwner\)/,
      '共享 EPUB unloadOutside 必须携带具体视口 token');
  });

  test('旧分栏回调既受当前 render generation 守卫，也能在 retire 时主动取消', () => {
    const flowRestore = sliceBetween('const pendingLocator = ctl._pendingAnchor;', 'ctl._flowNav = async');
    const raf = flowRestore.match(/requestAnimationFrame\s*\(\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*\)/)?.[1] || '';
    const settle = flowRestore.match(/setTimeout\s*\(\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*320\s*\)/)?.[1] || '';
    const resizeStart = flowRestore.indexOf('new ResizeObserver');
    const resizeEnd = flowRestore.indexOf('ctl._flowRO.observe', resizeStart);
    const resize = resizeStart >= 0 && resizeEnd > resizeStart
      ? flowRestore.slice(resizeStart, resizeEnd)
      : '';

    assert.match(raf, /renderAlive\s*\(\)/, '下一帧重排不得作用于已换代 reader');
    assert.match(settle, /renderAlive\s*\(\)/, '延迟落定不得清掉新一代 pending locator');
    assert.match(resize, /renderAlive\s*\(\)/, '旧 ResizeObserver 不得重排新 reader');
    assert.match(source, /cancelAnimationFrame\s*\(\s*ctl\._flow[A-Za-z0-9_]*\s*\)/,
      'retire 必须主动取消旧 flow requestAnimationFrame owner');
    assert.match(source, /clearTimeout\s*\(\s*ctl\._flow(?:Settle|Restore|Layout|Raf|Timer)[A-Za-z0-9_]*\s*\)/,
      'retire 必须主动取消旧 flow 延迟落定 owner');
    const retire = functionBody('retireFlowOwner');
    assert.match(retire, /cancelAnimationFrame\s*\(/);
    assert.match(retire, /clearTimeout\s*\(/);
    assert.match(retire, /_flowRO\?\.disconnect/);
    assert.match(functionBody('showCurrent'), /retireFlowOwner\s*\(/,
      '每代 showCurrent 建立新 owner 前必须先收走上一代 flow callbacks');
  });

  test('两页 CBZ 到达第二页时写出的 overallRatio 必须精确为 1', () => {
    const captureProgress = new Function(
      'ctl', 'captureAnchor', 'weightedPct', 'totalPages',
      `return (() => {${functionBody('progressRecord')}})();`,
    );
    const ctl = {
      book: { meta: { id: 'two-page-cbz', path: 'D:/books/two.cbz', format: 'cbz' } },
      chapterIdx: 0, pageIdx: 1, zhMode: '', _flowWrap: null, _flowRatio: null,
    };
    const record = captureProgress(ctl, () => null, () => 0, () => 2);
    assert.equal(record.page, 1);
    assert.equal(record.totalPages, 2);
    assert.equal(record.overallRatio, 1, 'zero-based last page is a completed 2/2, not 1/2');
  });

  test('连续文本进度保存章节内 locator，overallRatio 不得退化到章首', () => {
    const captureProgress = new Function(
      'ctl', 'captureAnchor', 'weightedPct', 'totalPages',
      `return (() => {${functionBody('progressRecord')}})();`,
    );
    const ctl = {
      book: {
        meta: { id: 'long-epub', path: 'D:/books/long.epub', format: 'epub' },
        _textViewport: {
          captureLocator: () => ({
            section: 3, sectionId: 'chapter-stable-id', ratio: 0.45,
            progression: 0.345, scrollTop: 6210,
          }),
        },
      },
      chapterIdx: 0, pageIdx: 0, zhMode: '', _flowWrap: null, _flowRatio: null,
    };
    const record = captureProgress(ctl, () => null, () => 0, () => 10);
    assert.equal(record.chapter, 3);
    assert.equal(record.spineItemId, 'chapter-stable-id');
    assert.equal(record.ratio, 0.45);
    assert.equal(record.progression, 0.345);
    assert.equal(record.overallRatio, 0.345, '书架进度必须保留连续滚动的章内位置');
    assert.equal(record.scrollTop, 6210, '原始像素只作为诊断/同布局回退证据保留');

    const show = functionBody('showCurrent');
    assert.match(show, /_textViewport\?\.captureLocator/, '重排前必须先抓取连续阅读 locator');
    assert.match(show, /initialLocator\s*:/, '重建 TextViewport 必须消费待恢复 locator');
    assert.match(show, /await\s+b\._textViewport\.ready/, '首帧保存/焦点交接不得抢在 locator 恢复前');
    const back = sliceBetween("root.querySelector('[data-a=back]').addEventListener", "root.querySelector('[data-a=toc]').addEventListener");
    assert.ok(back.indexOf('progressRecord()') < back.indexOf("readerView.style.display = 'none'"),
      '返回书架必须在 display:none 清空 iframe geometry 之前同步快照 locator');
    assert.match(back, /saveProgress\s*\(\s*retiringProgress\s*,\s*retiring\.meta\s*,\s*retiringBinding\s*\)/,
      '返回书架 durability write 必须消费预先抓取的 owner 快照');
  });

  test('源文件缺失只接受明确 ENOENT；权限、桥失败与损坏解析不误标', () => {
    assert.equal(isExplicitMissingSourceStat({ exists: false }), true, '兼容只返回 exists:false 的旧桥');
    assert.equal(isExplicitMissingSourceStat({ exists: false, code: 'ENOENT' }), true);
    assert.equal(isExplicitMissingSourceStat({ exists: false, code: 'EACCES' }), false);
    assert.equal(isExplicitMissingSourceStat({ exists: false, code: 'EPERM' }), false);
    assert.equal(isExplicitMissingSourceStat(null), false, '桥调用失败没有形成缺失证据');
    assert.equal(isExplicitMissingSourceStat({ exists: true }), false, 'stat 成功后的解析损坏不是源文件缺失');

    const open = functionBody('openBook');
    const stat = open.indexOf("invoke('fs:stat'");
    const parse = Math.min(...['parseEpub(', 'buildMangaBook(', 'parseMobi(', 'parseCbz(']
      .map(marker => open.indexOf(marker)).filter(index => index >= 0));
    assert.ok(stat >= 0 && stat < parse, '所有格式都必须在解析前完成统一 source stat');
    assert.match(open, /sourceMissing[\s\S]*?mutateShelf[\s\S]*?missing:\s*true/,
      '只有 sourceMissing 分类才可写入 missing:true');
    assert.match(open, /lastOpenedAt[\s\S]*?missing:\s*false/,
      '一次成功 render 必须清除历史 missing 状态');
    assert.match(mainSource, /fs:stat[\s\S]*?exists:\s*false,\s*code:/,
      '主进程 stat 必须保留 OS 错误码，不能把 EACCES 压扁成 ENOENT');
  });

  test('workspace rebind 是可失败回滚的 durability preflight，不先销毁旧 owner', () => {
    const begin = functionBody('beginWorkspaceRetirement');
    const prepare = functionBody('prepareWorkspaceRetirementDurability');
    const drain = functionBody('drainRetiringBinding');
    assert.match(begin, /ctl\._openGen\+\+[\s\S]*?ctl\._searchGen\+\+[\s\S]*?ctl\._exportGen\+\+/,
      'workspace event turn must invalidate open/search/export synchronously');
    assert.match(begin, /openCommit:\s*ctl\._openCommitTail/,
      'workspace event must capture the in-flight open gate before yielding');
    assert.match(prepare, /progressRecord\(\)[\s\S]*?locatorStore\.put/,
      'healthy old locator must be snapshotted into its immutable binding before hand-off');
    assert.match(prepare, /flushReaderAppearance\(retiring\)/,
      'old appearance owner must enter the same preflight');
    assert.ok(drain.indexOf('Promise.resolve(retirement.openCommit)')
      < drain.indexOf('prepareWorkspaceRetirementDurability(retirement)'),
    'candidate rollback must settle before the healthy owner/locator is captured');
    assert.doesNotMatch(prepare, /\.catch\s*\(\s*\(\)\s*=>\s*\[\]\s*\)/,
      'durability failure must not be normalized into success');
    assert.doesNotMatch(begin, /disposeBookHandle|retireReaderFrame|ctl\.book\s*=\s*null/,
      'old visual/resource owner must survive until preflight and new bootstrap succeed');

    const request = functionBody('requestWorkspaceRebind');
    assert.ok(request.indexOf('await drainRetiringBinding(retirement)') < request.indexOf('createRepositoryBinding(target)'),
      'new repository must not initialize before old durable work drains');
    assert.ok(request.indexOf('await next.ready') < request.indexOf('commitWorkspaceRetirement(retirement, next)'),
      'new repository identity/bootstrap must succeed before old owner release');
    assert.ok(request.indexOf('await waitForDestroyPreflight()') < request.indexOf('commitWorkspaceRetirement(retirement, next)'),
      'successful rebind must wait for a concurrent destroy preflight before publishing B');
    assert.match(request, /restoreWorkspaceRetirement\(retirement,\s*error\)/,
      'latest failed request must restore the old binding for retry');

    const destroyGate = functionBody('waitForDestroyPreflight');
    assert.match(destroyGate, /while\s*\(ctl\._destroying\s*&&\s*!ctl\._destroyed\)[\s\S]*?await\s+destroyTask/,
      'rebind success and rollback must both wait until destroy releases its final locator snapshot');
    const restore = functionBody('restoreWorkspaceRetirement');
    assert.match(restore, /await waitForDestroyPreflight\(\)/,
      'rebind rollback must share the destroy gate with the success path');
    assert.match(restore, /retirement\.binding\.retiring\s*=\s*false/);
    assert.match(restore, /ctl\._workspaceRebinding\s*=\s*false/);
    assert.match(restore, /releaseLifecycleInert\(['"]workspace['"]\)/);
    const commit = functionBody('commitWorkspaceRetirement');
    assert.match(commit, /ctl\._destroying/,
      'commit must retain its own no-install-during-destroy invariant');
    assert.match(commit, /disposeBookHandle\(retiring\)[\s\S]*?installRepositoryBinding\(next\)/,
      'successful commit releases A before exposing B');
    assert.match(commit, /releaseLifecycleInert\(['"]workspace['"]\)/);

    const syncInert = functionBody('syncLifecycleInert');
    assert.match(syncInert, /lifecycleInertOwners\.size\s*>\s*0/,
      'Back/rebind/destroy must compose inert ownership instead of restoring stale booleans');
    assert.doesNotMatch(source, /const\s+wasInert\s*=\s*!!root\.inert/,
      'no lifecycle transaction may cache and later replay root.inert');
  });

  test('整源 Base64 读取在主进程读盘前后均受硬上限保护', () => {
    assert.equal(
      assertLibrarySourceWithinLimit({ size: LIBRARY_SOURCE_LIMITS.archiveBytes }, 'epub'),
      LIBRARY_SOURCE_LIMITS.archiveBytes,
    );
    assert.throws(
      () => assertLibrarySourceWithinLimit({ size: LIBRARY_SOURCE_LIMITS.archiveBytes + 1 }, 'cbz', '大卷'),
      error => error?.code === 'LIBRARY_SOURCE_TOO_LARGE' && error.limit === LIBRARY_SOURCE_LIMITS.archiveBytes,
    );
    assert.throws(
      () => assertLibrarySourceWithinLimit({ size: LIBRARY_SOURCE_LIMITS.textBytes + 1 }, 'txt', '长文本'),
      error => error?.code === 'LIBRARY_SOURCE_TOO_LARGE' && error.limit === LIBRARY_SOURCE_LIMITS.textBytes,
    );
    assert.match(mainSource, /fs:readFileBase64[\s\S]*?fs\.promises\.stat\(p\)[\s\S]*?stat\.size\s*>\s*limit/,
      '主进程必须在 readFile 之前按 stat 拒绝超限源');
    assert.match(mainSource, /fs\.promises\.readFile\(p\)[\s\S]*?data\.byteLength\s*>\s*limit/,
      'TOCTOU 后实际读得的 bytes 仍须复验');
    const open = functionBody('openBook');
    assert.match(open, /assertLibrarySourceWithinLimit\(sourceStat,\s*book\.format/);
    assert.match(open, /fs:readFileBase64[^\n]*maxBytes/);
    const prepare = functionBody('prepareImport');
    assert.match(prepare, /fs:stat[\s\S]*?assertLibrarySourceWithinLimit[\s\S]*?fs:readFileBase64[^\n]*maxBytes/,
      '导入也不得先整读再判断大小');
  });

  test('漫画文件夹恢复位置按扁平页总数夹紧，而不是按章节数截断', () => {
    const branch = sliceBetween("} else if (book.format === 'manga-folder') {", "} else if (book.format === 'pdf') {");
    assert.doesNotMatch(branch, /nextPage\s*=\s*Math\.min\([^;]*candidate\.manga\.chapters\.length\s*-\s*1/,
      '章节数不是漫画页数');
    assert.match(branch, /(?:flatManga\s*\(\s*candidate\s*\)\.length|chapters\.(?:reduce|flatMap)\s*\([\s\S]*?pages\.length)/,
      '恢复上界必须来自所有章节的扁平页总数');
    assert.match(branch, /nextPage\s*=\s*(?:Math\.max\s*\(\s*0\s*,\s*Math\.min|clamp[A-Za-z0-9_]*\s*\()/,
      '损坏的负数/超大 locator 都必须被夹到合法页域');
  });

  test('连续滚动模式的键盘翻页语义退回浏览器原生滚动', () => {
    let navCalls = 0;
    let boundaryCalls = 0;
    const ctl = { book: { meta: { format: 'cbz' } }, mode: 'scroll' };
    const handler = new Function(
      'ctl', 'root', 'tocEl', 'nav', 'jumpReaderBoundary', 'showSearch', 'renderToc', 'scheduleReaderAction',
      `return function handleReaderCommand(command, meta) {${functionBody('handleReaderCommand')}};`,
    )(
      ctl,
      { querySelector: () => null },
      { style: { display: 'none' } },
      () => { navCalls++; },
      () => { boundaryCalls++; },
      () => {},
      () => {},
      task => { task(); return Promise.resolve(); },
    );

    for (const command of ['next', 'previous', 'first', 'last']) {
      assert.equal(handler(command, { source: 'keyboard' }), false, `${command} 必须允许 scroll host 原生消费`);
    }
    assert.equal(navCalls, 0);
    assert.equal(boundaryCalls, 0);

    ctl.mode = 'single';
    assert.equal(handler('next', { source: 'keyboard' }), true, '分页模式仍应消费同一键盘语义');
    assert.equal(navCalls, 1);
  });

  test('书架查询/筛选重绘复用 ShelfViewModel.with，不在每次键入时重做全量规范化', () => {
    const paint = functionBody('paintShelfState');
    assert.match(paint, /ctl\.shelf\.(?:model|viewModel)/, 'controller 必须保留上一代 shelf model');
    assert.match(paint, /\.with\s*\(\s*\{/, '查询、筛选与排序只派生下一代 model');
    assert.match(paint, /createShelfViewModel\s*\(/, '首次加载仍需建立 model');
  });

  test('所有 fire-and-forget 翻页/重排都显式捕获异步失败', () => {
    assert.deepEqual(uncaughtAsyncCalls('nav'), [], 'nav() 不得留下 unhandled rejection');
    assert.deepEqual(uncaughtAsyncCalls('showCurrent'), [], 'showCurrent() 不得留下 unhandled rejection');
  });

  test('书签与本书净化规则跨 await 始终绑定入口 owner，不读切换后的 ctl.book', () => {
    const add = functionBody('addMark');
    assert.match(add, /const\s+owner\s*=\s*ctl\.book/);
    assert.match(add, /const\s+bookId\s*=\s*owner\.meta\.id/);
    assert.match(add, /const\s+pos\s*=\s*currentPos\(\)/,
      '书签 locator 必须在弹窗 await 之前冻结');
    assert.match(add, /await\s+ownedInputModal[\s\S]*?ctl\.book\s*!==\s*owner/,
      '弹窗返回后必须拒绝已换书 owner');
    assert.doesNotMatch(add, /bookId\s*=\s*ctl\.book/);

    const marks = functionBody('showMarks');
    assert.match(marks, /const\s+owner\s*=\s*ctl\.book/);
    assert.match(marks, /const\s+bookId\s*=\s*owner\.meta\.id/);
    assert.match(marks, /await\s+getMarks\(\)[\s\S]*?ctl\.book\s*!==\s*owner/);
    assert.match(marks, /mutateRepository\('bookmarks'[\s\S]*?draft\[bookId\]/,
      '删除必须使用捕获书籍 id，而不是弹层点击时的动态书籍');
    assert.doesNotMatch(marks, /ctl\.book\.meta\.(?:id|format)/,
      '旧书弹层回调不得读取新 owner 的 id/format');

    const rules = sliceBetween(
      "root.querySelector('[data-a=clean-rules]').addEventListener",
      'ctl.pageWidth = ctl.pageWidth ??',
    );
    assert.match(rules, /const\s+owner\s*=\s*ctl\.book/);
    assert.match(rules, /const\s+bookId\s*=\s*owner\.meta\.id/);
    assert.match(rules, /ownerAlive\s*=\s*\(\)\s*=>[\s\S]*?ctl\.book\s*===\s*owner/);
    assert.match(rules, /const\s+nextRule\s*=\s*\{[\s\S]*?\bbookId,\s*[\s\S]*?\};/,
      '本书规则必须持久化捕获的 bookId');
    assert.doesNotMatch(rules, /rulesForBook\([^)]*ctl\.book/,
      '规则刷新不得在 await 后重新选择动态 owner');
  });

  test('批量意图与全局浮层属于 Library controller 生命周期', () => {
    const batch = sliceBetween(
      "root.querySelector('[data-a=sel-moveto]').addEventListener",
      "root.querySelector('[data-a=sel-del]').addEventListener",
    );
    assert.ok(batch.indexOf('new Set(ctl.batchSel)') < batch.indexOf('await allCats()'),
      '批量移动必须在第一个 await 前冻结选中集合');
    assert.match(batch, /selectedIds\.has\(b\.id\)/);
    assert.doesNotMatch(batch, /ctl\.batchSel\.has\(b\.id\)/,
      'durability updater 不得读取用户后来改动的 live Set');
    assert.match(batch, /ownMask\(m\)/);

    const destroy = functionBody('closeOwnedOverlays');
    assert.match(destroy, /ctl\._ownedOverlays/);
    const controllerDestroy = sliceBetween('ctl.commitDestroy = (receipt', '\n\n  ctl.destroy = async');
    assert.match(controllerDestroy, /ctl\._lifecycleGen\+\+/);
    assert.match(controllerDestroy, /closeOwnedOverlays\(\)/);
    assert.match(source, /ownModal\(modal\('分类管理'\)\)/);
    assert.match(source, /ownModal\(modal\('净化规则'\)\)/);
    assert.match(source, /ownedInputModal\('PDF 页码'/);
    assert.match(source, /ownDomMenu\(showDomMenu\(/,
      'Library 自绘右键菜单必须进入 controller overlay ledger');
    const bookMenu = functionBody('showBookMenu');
    assert.match(bookMenu, /const\s+alive\s*=\s*\(\)\s*=>/);
    assert.match(bookMenu, /fn:\s*\(\)\s*=>\s*\{\s*if\s*\(alive\(\)\)/,
      '菜单动作必须在点击时再次验证 owner lifecycle');
    assert.doesNotMatch(source, /\binputModal\(/,
      'Library 不得再打开无法由自身 destroy 收走的全局输入浮层');
  });

  test('全选结果绑定同一 Workspace 与 lifecycle，迟到旧仓读取不得污染新选择集', () => {
    const selectAll = sliceBetween(
      "root.querySelector('[data-a=sel-all]').addEventListener",
      "root.querySelector('[data-a=sel-none]').addEventListener",
    );
    assert.match(selectAll, /const\s+binding\s*=\s*repositoryBinding/);
    assert.match(selectAll, /const\s+lifecycleGen\s*=\s*ctl\._lifecycleGen/);
    assert.match(selectAll, /await\s+getShelf\(binding\)/);
    assert.match(selectAll, /ctl\._lifecycleGen\s*!==\s*lifecycleGen/);
    assert.ok(selectAll.indexOf('requireActiveBinding(binding)') < selectAll.indexOf('ctl.batchSel.clear()'),
      '旧 Workspace 结果必须在写 live selection 前再次通过 binding owner 闸');
    assert.match(selectAll, /ctl\.shelf\.snapshot[\s\S]*?ctl\.shelf\.records/,
      '已绘制书架应优先使用同步 owner 投影，避免无意义的迟到全量读');
  });

  test('模块 dispose 把 controller durability promise 原样返回给宿主等待', async () => {
    let release;
    const durability = new Promise(resolve => { release = resolve; });
    const returned = libraryModule.dispose({ destroy: () => durability });
    assert.equal(returned, durability, 'module boundary 不得吞掉 destroy durability gate');
    let settled = false;
    returned.then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    release('durable');
    assert.equal(await returned, 'durable');
  });
});
