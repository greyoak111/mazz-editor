// W94A narrow renderer bridge. It never accepts executable paths, scripts or arbitrary Workspaces.
'use strict';

const path = require('path');
const contract = require('./capability-execution-contract');

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32'
    ? a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US')
    : a === b;
}

function assertTrusted(event, isTrustedSender) {
  if (typeof isTrustedSender !== 'function' || isTrustedSender(event) !== true) {
    throw contract.codedError('CAPABILITY_UNTRUSTED_SENDER', 'Capability IPC 只允许可信 Mazz app shell');
  }
}

function assertReady(isStartupReady) {
  if (typeof isStartupReady !== 'function' || isStartupReady() !== true) {
    throw contract.codedError('CAPABILITY_STARTUP_HOLD', 'Capability restart recovery 尚未完成');
  }
}

function currentWorkspaceSelector(payload, currentWorkspace) {
  const request = contract.exactKeys(payload, ['workspacePath'], 'Capability Workspace request');
  const requested = contract.exactText(request.workspacePath, 'workspacePath');
  const owned = contract.exactText(currentWorkspace(), 'current Workspace');
  // Compare before service.openWorkspace/realpath so renderer input cannot be
  // used as an arbitrary filesystem existence probe.
  if (!samePath(requested, owned)) throw contract.codedError('CAPABILITY_WORKSPACE_MISMATCH', 'Capability request 不属于当前 Workspace');
  return owned;
}

function registerCapabilityExecutionIpc({
  bus,
  service,
  currentWorkspace,
  isTrustedSender,
  isStartupReady = () => true,
} = {}) {
  if (!bus || typeof bus.handle !== 'function') throw new TypeError('Capability IPC 需要 bus');
  if (!service || typeof service.listCapabilities !== 'function'
      || typeof service.openWorkspace !== 'function'
      || typeof service.submitProposal !== 'function'
      || typeof service.executeProposal !== 'function'
      || typeof service.cancelProposal !== 'function'
      || typeof service.grantArtifact !== 'function') {
    throw new TypeError('Capability IPC 需要 CapabilityExecutionService');
  }
  if (typeof currentWorkspace !== 'function') throw new TypeError('Capability IPC 需要 currentWorkspace');

  bus.handle('capability:list', async (payload, event) => {
    assertTrusted(event, isTrustedSender);
    assertReady(isStartupReady);
    contract.exactKeys(payload || {}, [], 'Capability list request');
    return service.listCapabilities();
  });

  bus.handle('capability:workspaceSnapshot', async (payload, event) => {
    assertTrusted(event, isTrustedSender);
    assertReady(isStartupReady);
    const workspacePath = currentWorkspaceSelector(payload, currentWorkspace);
    return service.workspaceSnapshot(workspacePath);
  });

  bus.handle('capability:submitProposal', async (payload, event) => {
    assertTrusted(event, isTrustedSender);
    assertReady(isStartupReady);
    const request = contract.exactKeys(payload, ['workspacePath', 'proposal'], 'Capability submit request');
    const workspacePath = currentWorkspaceSelector({ workspacePath: request.workspacePath }, currentWorkspace);
    contract.exactKeys(request.proposal, [
      'taskId', 'seatId', 'capabilityId', 'capabilityVersion', 'adapterId', 'inputs',
      'parameters', 'expectedOutputs', 'constraints', 'authorityRef',
    ], 'Capability submit proposal');
    const authorityRef = contract.opaqueRef(request.proposal.authorityRef, 'authorityRef');
    if (!authorityRef.startsWith('human:')) {
      throw contract.codedError('CAPABILITY_HUMAN_AUTHORITY_REQUIRED', 'Renderer Capability Proposal 必须由 human Authority 提交');
    }
    return service.submitProposal(workspacePath, request.proposal);
  });

  bus.handle('capability:executeProposal', async (payload, event) => {
    assertTrusted(event, isTrustedSender);
    assertReady(isStartupReady);
    const request = contract.exactKeys(payload, ['workspacePath', 'proposalId'], 'Capability execute request');
    const workspacePath = currentWorkspaceSelector({ workspacePath: request.workspacePath }, currentWorkspace);
    return service.executeProposal(workspacePath, contract.safeId(request.proposalId, 'proposalId'));
  });

  bus.handle('capability:cancelProposal', async (payload, event) => {
    assertTrusted(event, isTrustedSender);
    assertReady(isStartupReady);
    const request = contract.exactKeys(payload, ['workspacePath', 'proposalId', 'authorityRef'], 'Capability cancel request');
    const workspacePath = currentWorkspaceSelector({ workspacePath: request.workspacePath }, currentWorkspace);
    const authorityRef = contract.opaqueRef(request.authorityRef, 'authorityRef');
    if (!authorityRef.startsWith('human:')) throw contract.codedError('CAPABILITY_HUMAN_AUTHORITY_REQUIRED', 'Renderer cancel 必须由 human Authority 提交');
    return service.cancelProposal(workspacePath, contract.safeId(request.proposalId, 'proposalId'), authorityRef);
  });

  bus.handle('capability:artifactGrant', async (payload, event) => {
    assertTrusted(event, isTrustedSender);
    assertReady(isStartupReady);
    const request = contract.exactKeys(payload, ['workspacePath', 'artifactId'], 'Capability Artifact grant request');
    const workspacePath = currentWorkspaceSelector({ workspacePath: request.workspacePath }, currentWorkspace);
    return service.grantArtifact(workspacePath, contract.safeId(request.artifactId, 'artifactId'));
  });

  return Object.freeze({ channels: Object.freeze([
    'capability:list', 'capability:workspaceSnapshot', 'capability:submitProposal',
    'capability:executeProposal', 'capability:cancelProposal', 'capability:artifactGrant',
  ]) });
}

async function initializeCurrentCapabilityExecution({ service, currentWorkspace } = {}) {
  if (!service || typeof service.openWorkspace !== 'function' || typeof service.recoverWorkspace !== 'function') {
    throw new TypeError('Capability startup 需要 CapabilityExecutionService');
  }
  if (typeof currentWorkspace !== 'function') throw new TypeError('Capability startup 需要 currentWorkspace');
  const opened = service.openWorkspace(contract.exactText(currentWorkspace(), 'current Workspace'));
  return service.recoverWorkspace(opened);
}

module.exports = {
  registerCapabilityExecutionIpc,
  initializeCurrentCapabilityExecution,
  _forTests: { samePath, currentWorkspaceSelector },
};
