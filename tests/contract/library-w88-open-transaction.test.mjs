// W88 Library owner transaction gates.
//
// openBook is a private createLibrary closure, so the queue itself is executed
// from the exact production source while narrow source-order assertions guard
// the install/render/rollback/release protocol around it.
import './_setup.mjs';
import { readFileSync } from 'node:fs';
import { describe, test, assert } from '../harness.mjs';

const source = readFileSync(new URL('../../renderer/modules/library/index.js', import.meta.url), 'utf8');

function functionBody(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing ${name}()`);
  const paramsOpen = source.indexOf('(', start);
  let parens = 0;
  let paramsClose = -1;
  for (let i = paramsOpen; i < source.length; i++) {
    if (source[i] === '(') parens++;
    else if (source[i] === ')' && --parens === 0) { paramsClose = i; break; }
  }
  const open = source.indexOf('{', paramsClose);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  assert.fail(`unterminated ${name}()`);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

describe('W88 Library · open owner transaction', () => {
  test('production commit gate serializes render ownership and survives a rejected predecessor', async () => {
    const ctl = {};
    const withOpenCommit = new Function(
      'ctl',
      `return function withOpenCommit(work) {${functionBody('withOpenCommit')}};`,
    )(ctl);
    const hold = deferred();
    const trace = [];
    const first = withOpenCommit(async () => {
      trace.push('A:start');
      await hold.promise;
      trace.push('A:fail');
      throw new Error('render A failed');
    });
    const second = withOpenCommit(async () => {
      trace.push('B:start');
      await Promise.resolve();
      trace.push('B:done');
      return 'B';
    });

    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(trace, ['A:start'], 'B must not install while A owns the render transaction');
    hold.resolve();
    await assert.rejects(first, /render A failed/);
    assert.equal(await second, 'B', 'a failed transaction must release the queue for the next candidate');
    assert.deepEqual(trace, ['A:start', 'A:fail', 'B:start', 'B:done']);
    assert.equal(ctl._openCommitTail, null, 'idle queue must not retain a completed gate');
  });

  test('candidate parsing stays outside the commit gate and owner mutation stays inside it', () => {
    const body = functionBody('openBook');
    const gate = body.indexOf('await withOpenCommit(async () =>');
    assert.ok(gate > 0, 'openBook must enter the serialized owner gate');
    for (const parseMarker of ['parseEpub(', 'buildMangaBook(', 'parseMobi(', 'parseCbz(']) {
      assert.ok(body.indexOf(parseMarker) >= 0 && body.indexOf(parseMarker) < gate,
        `${parseMarker} must remain in the concurrent candidate phase`);
    }
    assert.ok(body.indexOf('ctl.book = nextBook') > gate, 'candidate install must occur under the gate');
    assert.ok(body.indexOf('await showCurrent()', gate) > body.indexOf('ctl.book = nextBook'),
      'candidate must render only after its owner install');
  });

  test('render failure restores last healthy owner without an open-generation veto', () => {
    const body = functionBody('openBook');
    const failureStart = body.indexOf('catch (renderError)');
    const failureEnd = body.indexOf('throw renderError;', failureStart);
    assert.ok(failureStart >= 0 && failureEnd > failureStart, 'missing render rollback branch');
    const rollback = body.slice(failureStart, failureEnd);
    assert.match(rollback, /ctl\.book\s*=\s*rollback\.book/,
      'the prior owner must be reinstalled before rollback rendering');
    assert.match(rollback, /await\s+showCurrent\s*\(\s*\)/,
      'the prior healthy owner must be rendered before the queue is released');
    assert.doesNotMatch(rollback, /(?:gen\s*===\s*ctl\._openGen|ctl\._openGen\s*===\s*gen)/,
      'a newer queued request must not veto restoration of the last healthy owner');
  });

  test('old owner is released only after candidate render succeeds', () => {
    const body = functionBody('openBook');
    const render = body.indexOf('await showCurrent()');
    const renderCatch = body.indexOf('catch (renderError)', render);
    const release = body.indexOf('disposeBookHandle(oldBook)', renderCatch);
    assert.ok(render >= 0 && renderCatch > render && release > renderCatch,
      'old owner release must be in the post-render success path');
    assert.doesNotMatch(body.slice(body.indexOf('ctl.book = nextBook'), render), /disposeBookHandle\s*\(\s*oldBook\s*\)/,
      'the rollback owner must stay alive throughout candidate rendering');
  });

  test('close invalidates and drains an in-flight render commit before choosing the durable owner', () => {
    const open = functionBody('openBook');
    const render = open.indexOf('await showCurrent()');
    const staleCheck = open.indexOf('!stillCurrent() || ctl.book !== nextBook', render);
    const rollback = open.indexOf('catch (renderError)', render);
    assert.ok(render >= 0 && staleCheck > render && rollback > staleCheck,
      'a generation-invalidated showCurrent return must enter rollback, not release the healthy owner');

    const destroyStart = source.indexOf('ctl.prepareDestroy = () =>');
    const destroyEnd = source.indexOf('\n\n  ctl.commitDestroy', destroyStart);
    const destroy = source.slice(destroyStart, destroyEnd);
    const invalidate = destroy.indexOf('ctl._openGen++');
    const captureGate = destroy.indexOf('const openCommit = ctl._openCommitTail');
    const awaitGate = destroy.indexOf('Promise.resolve(openCommit)', captureGate);
    const chooseOwner = destroy.indexOf('const retiring = ctl.book', awaitGate);
    const captureLocator = destroy.indexOf('progressRecord()', chooseOwner);
    assert.ok(invalidate >= 0 && captureGate > invalidate && awaitGate > captureGate
      && chooseOwner > awaitGate && captureLocator > chooseOwner,
    'close must invalidate, drain the active commit, then choose/capture the rolled-back healthy owner');
  });

  test('workspace switch and Back drain an in-flight open before choosing the durable owner', () => {
    const beginStart = source.indexOf('function beginWorkspaceRetirement()');
    const prepareStart = source.indexOf('function prepareWorkspaceRetirementDurability', beginStart);
    const drainStart = source.indexOf('async function drainRetiringBinding', prepareStart);
    const destroyGate = source.indexOf('async function waitForDestroyPreflight', drainStart);
    const begin = source.slice(beginStart, prepareStart);
    const drain = source.slice(drainStart, destroyGate);
    assert.match(begin, /openCommit:\s*ctl\._openCommitTail/);
    assert.match(begin, /readerAction:\s*ctl\._readerActionTail/);
    const workspaceAwait = drain.indexOf('Promise.resolve(retirement.openCommit)');
    const workspaceCapture = drain.indexOf('prepareWorkspaceRetirementDurability(retirement)');
    assert.ok(workspaceAwait >= 0 && workspaceCapture > workspaceAwait,
      'workspace switch must settle candidate rollback before owner/locator capture');

    const backStart = source.indexOf("root.querySelector('[data-a=back]').addEventListener");
    const backEnd = source.indexOf("root.querySelector('[data-a=toc]').addEventListener", backStart);
    const back = source.slice(backStart, backEnd);
    const backGate = back.indexOf('const openCommit = ctl._openCommitTail');
    const backAwait = back.indexOf('Promise.resolve(openCommit)', backGate);
    const backOwner = back.indexOf('retiring = ctl.book', backAwait);
    const backLocator = back.indexOf('progressRecord()', backOwner);
    assert.ok(backGate >= 0 && backAwait > backGate && backOwner > backAwait && backLocator > backOwner,
      'Back must settle candidate rollback before owner/locator capture');
  });
});
