// W94B isolated Python expression adapter. No shell, imports, paths or network.
'use strict';

const { spawn, spawnSync } = require('child_process');
const os = require('os');
const contract = require('../capability-execution-contract');
const calcContract = require('../calc-chart-contract');

const DRIVER = String.raw`import ast, json, math, random, sys

FUNCS = {
  'sqrt': math.sqrt, 'cbrt': lambda x: x ** (1.0 / 3.0), 'abs': abs,
  'floor': math.floor, 'ceil': math.ceil, 'round': round, 'trunc': math.trunc,
  'exp': math.exp, 'log': math.log, 'ln': math.log, 'log2': math.log2, 'log10': math.log10,
  'pow': pow, 'min': min, 'max': max, 'hypot': math.hypot,
  'sin': math.sin, 'cos': math.cos, 'tan': math.tan,
  'asin': math.asin, 'acos': math.acos, 'atan': math.atan, 'atan2': math.atan2,
  'sinh': math.sinh, 'cosh': math.cosh, 'tanh': math.tanh,
}
CONSTS = {'pi': math.pi, 'e': math.e, 'tau': math.tau}
ALLOWED = (
  ast.Expression, ast.Constant, ast.Name, ast.Load, ast.BinOp, ast.UnaryOp,
  ast.Call, ast.List, ast.Tuple, ast.Dict,
  ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow,
  ast.UAdd, ast.USub,
)

def fail(message):
  sys.stderr.write(message + '\n')
  raise SystemExit(2)

def main():
  request = json.load(sys.stdin)
  expression = request['expression']
  bindings = request['bindings']
  seed = request['seed']
  tree = ast.parse(expression, mode='eval')
  for node in ast.walk(tree):
    if not isinstance(node, ALLOWED):
      fail('AST_NODE_FORBIDDEN:' + type(node).__name__)
    if isinstance(node, ast.Name):
      if node.id.startswith('__') or node.id not in bindings and node.id not in FUNCS and node.id not in CONSTS and node.id != 'random':
        fail('AST_NAME_FORBIDDEN:' + node.id)
    if isinstance(node, ast.Call):
      if not isinstance(node.func, ast.Name) or node.func.id not in FUNCS and node.func.id != 'random' or node.keywords:
        fail('AST_CALL_FORBIDDEN')
  rng = random.Random(seed)
  if seed is None and any(isinstance(node, ast.Name) and node.id == 'random' for node in ast.walk(tree)):
    fail('RANDOM_SEED_REQUIRED')
  scope = dict(FUNCS)
  scope.update(CONSTS)
  scope['random'] = rng.random
  scope.update(bindings)
  value = eval(compile(tree, '<mazz-calc>', 'eval'), {'__builtins__': {}}, scope)
  if isinstance(value, tuple):
    value = list(value)
  result = {
    'schema': 'mazz.calc-result/v1',
    'definitionId': request['definitionId'],
    'value': value,
    'valueType': 'null' if value is None else 'boolean' if isinstance(value, bool) else 'number' if isinstance(value, (int, float)) else 'string' if isinstance(value, str) else 'array' if isinstance(value, list) else 'object',
  }
  sys.stdout.write(json.dumps(result, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(',', ':')))
  sys.stdout.flush()

try:
  main()
except SystemExit:
  raise
except BaseException as error:
  sys.stderr.write(type(error).__name__ + '\n')
  raise SystemExit(3)
`;

function detectPython({ candidate = '', spawnProbe = spawnSync } = {}) {
  const candidates = candidate ? [candidate] : (process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']);
  for (const command of candidates) {
    try {
      const probe = spawnProbe(command, ['-I', '-S', '-c', 'import sys;print("%d.%d.%d"%sys.version_info[:3])'], {
        encoding: 'utf8', windowsHide: true, timeout: 5000,
      });
      if (probe.status === 0 && /^3\.\d+\.\d+$/.test(String(probe.stdout || '').trim())) {
        return Object.freeze({ command, version: String(probe.stdout).trim() });
      }
    } catch {}
  }
  return null;
}

function processError(code, message) {
  return contract.codedError(code, message);
}

function createCalcPythonAdapter({
  python = detectPython(),
  spawnProcess = spawn,
  resourceLedger = null,
  defaultTimeoutMs = 30_000,
} = {}) {
  const availability = python ? 'available' : 'unavailable';
  const descriptor = contract.normalizeCapabilityDescriptor({
    schema: contract.CAPABILITY_DESCRIPTOR_SCHEMA,
    capabilityId: 'mazz.calc.python-expression',
    version: '1.0.0',
    adapterId: 'mazz.calc.python-isolated',
    displayName: 'Mazz Isolated Python Expression',
    kind: 'compute',
    executionPlane: 'external-process',
    inputSchemas: [],
    outputSchemas: [calcContract.CALC_RESULT_SCHEMA],
    determinism: 'seeded',
    safetyClass: 'isolated',
    availability: {
      state: availability,
      checkedAt: new Date().toISOString(),
      reason: python ? 'PYTHON3_ISOLATED_AVAILABLE' : 'PYTHON3_NOT_FOUND',
      evidenceRef: python ? 'runtime:python3-isolated' : 'runtime:python3-unavailable',
    },
    cancelMode: 'process-tree',
    resumeMode: 'restart',
    provenance: { adapter: 'built-in', protocol: 'python-ast-expression', network: false, shell: false },
  });
  const active = new Map();

  return Object.freeze({
    protocol: contract.CAPABILITY_ADAPTER_PROTOCOL,
    descriptor,
    async execute({ proposal, signal, artifacts }) {
      if (!python) throw processError('CAPABILITY_CALC_PYTHON_UNAVAILABLE', 'Python 3 isolated runtime unavailable');
      contract.exactKeys(proposal.parameters, ['definition'], 'Calc proposal parameters');
      contract.exactKeys(proposal.constraints, ['timeoutMs'], 'Calc proposal constraints');
      const definition = calcContract.normalizeCalcDefinition(proposal.parameters.definition);
      const timeoutMs = proposal.constraints.timeoutMs === undefined ? defaultTimeoutMs : proposal.constraints.timeoutMs;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw processError('CAPABILITY_CALC_TIMEOUT_INVALID', 'Calc timeoutMs 非法');
      if (!artifacts || typeof artifacts.publishReadable !== 'function') {
        throw processError('CAPABILITY_ARTIFACT_PUBLISHER_MISSING', 'Calc adapter 缺 Artifact publisher');
      }
      if (signal.aborted) throw processError('CAPABILITY_CANCELLED', 'Calc cancelled');
      const child = spawnProcess(python.command, ['-I', '-S', '-u', '-c', DRIVER], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        cwd: os.tmpdir(),
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      const processKey = resourceLedger?.register({
        type: 'python-process', id: proposal.proposalId, owner: descriptor.adapterId, state: 'running',
        meta: { mode: 'isolated-expression' },
      }) || '';
      const record = { child, proposalId: proposal.proposalId, settled: false };
      active.set(proposal.proposalId, record);
      let stderr = '';
      let timedOut = false;
      child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
      child.stdin.on('error', () => {});
      let timeout = null;
      const closePromise = new Promise((resolve, reject) => {
        const settle = (error = null) => {
          if (record.settled) return;
          record.settled = true;
          if (timeout) clearTimeout(timeout);
          signal.removeEventListener('abort', abort);
          active.delete(proposal.proposalId);
          if (processKey) resourceLedger?.release(processKey, { reason: error ? 'calc-process-failed' : 'calc-process-exit', state: 'stopped' });
          if (error) reject(error); else resolve();
        };
        const abort = () => {
          try { child.kill(); } catch {}
        };
        signal.addEventListener('abort', abort, { once: true });
        child.once('error', () => settle(processError('CAPABILITY_CALC_PROCESS_FAILED', 'Calc process failed to start')));
        child.once('close', code => {
          if (signal.aborted) return settle(processError('CAPABILITY_CANCELLED', 'Calc cancelled'));
          if (timedOut) return settle(processError('CAPABILITY_CALC_TIMEOUT', 'Calc execution timed out'));
          if (code !== 0) return settle(processError(
            stderr.includes('AST_') || stderr.includes('RANDOM_SEED_REQUIRED')
              ? 'CAPABILITY_CALC_EXPRESSION_REJECTED' : 'CAPABILITY_CALC_PROCESS_FAILED',
            'Calc expression execution failed',
          ));
          settle();
        });
        timeout = setTimeout(() => { timedOut = true; try { child.kill(); } catch {} }, timeoutMs);
      });
      try {
        child.stdin.end(JSON.stringify({
          expression: definition.expression,
          bindings: definition.bindings,
          seed: definition.seed,
          definitionId: definition.definitionId,
        }));
        const publication = await artifacts.publishReadable({ readable: child.stdout, signal, beforeCommit: closePromise });
        return Object.freeze({
          status: 'completed',
          outputs: Object.freeze([Object.freeze({
            schema: contract.ARTIFACT_SCHEMA,
            kind: 'calc-result',
            mediaType: 'application/vnd.mazz.calc-result+json; charset=utf-8',
            contentSchema: calcContract.CALC_RESULT_SCHEMA,
            contentHash: publication.contentHash,
            definitionHash: calcContract.definitionHash(definition),
            storageRef: publication.storageRef,
            sourceArtifacts: proposal.inputs.map(row => row.artifactId),
            rightsRef: '',
            mutableHead: false,
          })]),
          environment: { runtime: 'python', version: python.version, isolated: true, sitePackages: false },
          diagnostics: { summaryRef: 'diagnostic:w94b-calc-complete' },
          resourceFinal: { activeProcesses: 0, stagingCount: artifacts.snapshot().stagingCount },
          provenance: { adapter: descriptor.adapterId, astPolicy: 'math-expression-v1' },
          seed: definition.seed,
        });
      } catch (error) {
        try { child.kill(); } catch {}
        await closePromise.catch(() => {});
        throw error;
      }
    },
    async cancel({ proposalId }) {
      const record = active.get(proposalId);
      if (!record) return false;
      try { record.child.kill(); } catch {}
      return true;
    },
    async dispose() {
      for (const record of active.values()) { try { record.child.kill(); } catch {} }
      await Promise.all([...active.values()].map(record => new Promise(resolve => record.child.once('close', resolve))));
      return { status: 'disposed', activeProcesses: active.size };
    },
  });
}

module.exports = { createCalcPythonAdapter, detectPython, DRIVER };
