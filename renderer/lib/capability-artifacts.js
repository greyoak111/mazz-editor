// W94B renderer-side proposal client. It never receives filesystem paths or base64 bodies.

function desktopInvoke() {
  if (!window.mazz?.isElectron || typeof window.mazz.invoke !== 'function') {
    throw new Error('能力资产链需要桌面版');
  }
  return window.mazz.invoke.bind(window.mazz);
}

async function workspace(invoke) {
  const value = await invoke('workspace:get');
  if (typeof value !== 'string' || !value) throw new Error('当前 Workspace 不可用');
  return value;
}

export async function executeCapability({ capabilityId, capabilityVersion, adapterId, parameters, expectedOutputs, constraints = {}, taskId, seatId = 'human' }) {
  const invoke = desktopInvoke();
  const workspacePath = await workspace(invoke);
  const submitted = await invoke('capability:submitProposal', {
    workspacePath,
    proposal: {
      taskId,
      seatId,
      capabilityId,
      capabilityVersion,
      adapterId,
      inputs: [],
      parameters,
      expectedOutputs,
      constraints,
      authorityRef: `human:${taskId}`,
    },
  });
  return invoke('capability:executeProposal', { workspacePath, proposalId: submitted.proposal.proposalId });
}

export async function grantArtifact(artifactId) {
  const invoke = desktopInvoke();
  const workspacePath = await workspace(invoke);
  return invoke('capability:artifactGrant', { workspacePath, artifactId });
}

export async function fetchArtifactText(artifactId, { onChunk = null, signal = null } = {}) {
  const grant = await grantArtifact(artifactId);
  const response = await fetch(grant.url, { cache: 'no-store', signal });
  if (!response.ok || !response.body) throw new Error(`Artifact stream 不可用（${response.status}）`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    text += chunk;
    onChunk?.(chunk);
  }
  const tail = decoder.decode();
  text += tail;
  if (tail) onChunk?.(tail);
  return { text, grant };
}

export async function executeCalcExpression(expression, { bindings = {}, seed = null, timeoutMs = 30_000, onChunk = null } = {}) {
  const execution = await executeCapability({
    capabilityId: 'mazz.calc.python-expression',
    capabilityVersion: '1.0.0',
    adapterId: 'mazz.calc.python-isolated',
    parameters: { definition: { schema: 'mazz.calc-definition/v1', language: 'python-expression', expression, bindings, resultSchema: 'mazz.calc-result/v1', seed } },
    expectedOutputs: ['mazz.calc-result/v1'],
    constraints: { timeoutMs },
    taskId: 'calc-expression',
  });
  const artifact = execution.artifacts.find(row => row.contentSchema === 'mazz.calc-result/v1');
  if (!artifact) throw new Error('Calc execution 未返回结果 Artifact');
  const loaded = await fetchArtifactText(artifact.artifactId, { onChunk });
  let result;
  try { result = JSON.parse(loaded.text); } catch { throw new Error('Calc result Artifact 不是合法 JSON'); }
  return { execution, artifact, result, raw: loaded.text };
}

export async function executeChartSpec(spec) {
  const execution = await executeCapability({
    capabilityId: 'mazz.chart.svg',
    capabilityVersion: '1.0.0',
    adapterId: 'mazz.chart.svg-deterministic',
    parameters: { spec },
    expectedOutputs: ['mazz.chart-spec/v1', 'mazz.chart-svg/v1'],
    constraints: {},
    taskId: 'sheet-chart',
  });
  const artifact = execution.artifacts.find(row => row.contentSchema === 'mazz.chart-svg/v1');
  if (!artifact) throw new Error('Chart execution 未返回 SVG Artifact');
  const grant = await grantArtifact(artifact.artifactId);
  return { execution, artifact, grant };
}

export function displayCalcValue(result) {
  if (!result || result.schema !== 'mazz.calc-result/v1') return '';
  if (result.valueType === 'string') return result.value;
  if (result.value === null) return 'null';
  if (typeof result.value === 'object') return JSON.stringify(result.value, null, 2);
  return String(result.value);
}
