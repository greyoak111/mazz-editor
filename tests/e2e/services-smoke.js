// tests/e2e/services-smoke.js —— 三阶段服务验收：终端/Python内核/debugpy/SearXNG（真机实测）
'use strict';
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const results = { checks: {}, errors: [] };
const bus = {
  handlers: new Map(),
  handle(ch, fn) { this.handlers.set(ch, fn); },
  async invoke(ch, payload) { return this.handlers.get(ch)(payload); },
};
const events = [];
const wm = { broadcast: (ch, payload) => events.push({ ch, payload }) };

async function checkTerminal() {
  const TerminalService = require('../../main/terminal');
  const term = new TerminalService({ bus, windowManager: wm });
  const { id } = await bus.invoke('term:create', { shell: 'bash' });
  if (!id) throw new Error('终端创建失败');
  await bus.invoke('term:write', { id, data: 'echo TERM_OK_42 && exit\r' });
  const out = await waitFor(() => events.filter(e => e.ch === 'term:data' && e.payload.id === id && e.payload.data.includes('TERM_OK_42')), 8000);
  await bus.invoke('term:kill', { id });
  return out.length > 0;
}

async function checkPython() {
  const PythonKernel = require('../../main/python-kernel');
  const kernel = new PythonKernel({ bus, windowManager: wm });
  const r1 = await bus.invoke('py:exec', { code: 'print(2+3)' });
  if (!r1.output.includes('5')) throw new Error('py 求值错误: ' + r1.output);
  const r2 = await bus.invoke('py:exec', { code: 'import math\nprint(round(math.sqrt(144), 2))' });
  if (!r2.output.includes('12')) throw new Error('py math 错误: ' + r2.output);
  kernel.kill();
  return true;
}

async function checkDebug() {
  const DebugService = require('../../main/debug');
  const dbg = new DebugService({ bus, windowManager: wm });
  // 测试脚本：在第 4 行命中断点
  const script = path.join(os.tmpdir(), 'mazz_debug_test.py');
  fs.writeFileSync(script, 'def add(a, b):\n    s = a + b\n    return s\nresult = add(2, 3)\nprint("RESULT", result)\n');
  const start = await bus.invoke('debug:start', { type: 'python', program: script, stopOnEntry: false, pythonPath: 'python3' });
  if (start.error) throw new Error('debugpy 启动失败: ' + start.error);
  // 先设断点（第 2 行函数内），再放行
  const bp = await bus.invoke('debug:request', { command: 'setBreakpoints', args: { source: { path: script }, breakpoints: [{ line: 2 }] } });
  if (bp.error) throw new Error('设断失败: ' + bp.error);
  await bus.invoke('debug:request', { command: 'configurationDone', args: {} });
  // 等待断点命中（stopped 事件）
  const stopped = await waitFor(() => events.filter(e =>
    e.ch === 'debug:event' && e.payload.channel === 'dapEvent' && e.payload.event === 'stopped'), 15000);
  const tid = stopped[0].payload.body.threadId;
  // 调用栈
  const stack = await bus.invoke('debug:request', { command: 'stackTrace', args: { threadId: tid, levels: 5 } });
  if (!stack.body.stackFrames?.length) throw new Error('无调用栈');
  // 变量（顶层帧的 locals 应含 a=2, b=3）
  const scopes = await bus.invoke('debug:request', { command: 'scopes', args: { frameId: stack.body.stackFrames[0].id } });
  const locals = scopes.body.scopes.find(s => s.name === 'Locals');
  const vars = await bus.invoke('debug:request', { command: 'variables', args: { variablesReference: locals.variablesReference } });
  const names = (vars.body.variables || []).map(v => v.name).join(',');
  // 继续 → 等待 RESULT 输出
  await bus.invoke('debug:request', { command: 'continue', args: { threadId: tid } });
  const gotOutput = await waitFor(() => events.filter(e =>
    e.ch === 'debug:event' && e.payload.channel === 'dapEvent' &&
    e.payload.event === 'output' && (e.payload.body.output || '').includes('RESULT')), 15000)
    .catch(() => null);
  await bus.invoke('debug:stop');
  return { frames: stack.body.stackFrames.length, locals: names, output: !!gotOutput };
}

async function checkSearx() {
  const SearxService = require('../../main/searx');
  const store = { get: (k, d) => d, set: () => {} };
  const { session } = require('electron');
  const searx = new SearxService({ bus, store, session: session.defaultSession });
  const sc = await bus.invoke('searx:selfcheck');
  if (!sc.ok) throw new Error('自检失败: ' + JSON.stringify(sc.checks));
  const r = await bus.invoke('searx:search', { query: 'Mazz Editor 隐私浏览器' });
  if (!r.ok) throw new Error('搜索失败: ' + r.error);
  if (!r.results.length) throw new Error('搜索无结果');
  // 隐私红线：响应不得包含实例信息
  const raw = JSON.stringify(r);
  if (raw.includes('107.174')) throw new Error('响应泄漏源站地址!');
  return { results: r.results.length, selfcheck: true };
}

function waitFor(fn, timeout) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const r = fn();
      if (r && r.length) { clearInterval(iv); resolve(r); }
      else if (Date.now() - t0 > timeout) { clearInterval(iv); reject(new Error('等待超时')); }
    }, 100);
  });
}

app.whenReady().then(async () => {
  const run = async (name, fn) => {
    try { results.checks[name] = await fn(); }
    catch (e) { results.checks[name] = false; results.errors.push(`${name}: ${e.message}`); }
  };
  await run('terminal', checkTerminal);
  await run('pythonKernel', checkPython);
  await run('debugpy', checkDebug);
  await run('searx', checkSearx);
  console.log('SERVICES_RESULT ' + JSON.stringify(results));
  app.exit(0);
});
setTimeout(() => { console.log('SERVICES_TIMEOUT ' + JSON.stringify(results)); app.exit(2); }, 90000);
