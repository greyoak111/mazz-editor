'use strict';

const { deepFreeze } = require('./plain-value');
const kernel = require('./organizational-kernel');

const GAME_SLICE_RESULT_SCHEMA = 'mazz.game-vertical-slice-evaluation/v0';

const delegation = (seatId, outputs, qualification) => ({
  allowed: false, maxDepth: 0, subcontractAllowed: false, liabilityOwner: seatId,
  requiredResultArtifactIds: outputs, qualificationRefs: [qualification], authorityRefs: [],
});

function seat(id, teamId, inputArtifactIds, outputArtifactIds, gateIds, capability, kind, qualification, authorityRefs = []) {
  return {
    seatId: id, teamId, label: id.split(':').pop(), responsibility: `Own ${outputArtifactIds.join(', ')} without self-approving downstream gates.`,
    inputArtifactIds, outputArtifactIds, gateIds, authorityRefs,
    requiredCapabilityIds: [capability], eligibleExecutorKinds: [kind], childSeatOf: '',
    qualificationRefs: [qualification], delegation: delegation(id, outputArtifactIds, qualification),
  };
}

function artifact(id, type, producer, consumers, dependsOn, invalidates, truthOwner = 'W73:production-record') {
  return {
    artifactId: id, label: id.split(':').pop(), type, version: '1', producedBySeatId: producer,
    consumedBySeatIds: consumers, dependsOn, invalidates, truthOwner,
    evidenceRequirements: ['version', 'content-digest', 'source-receipt'],
    licensePolicy: 'Declared local assets and compatible engine/tool licenses only.', required: true,
  };
}

function createGameVerticalSliceWorkflow() {
  return kernel.normalizeWorkflowPackage({
    schema: kernel.WORKFLOW_PACKAGE_SCHEMA,
    workflowId: 'workflow:game-vertical-slice:v1', version: '1.0.0',
    name: 'Local Visual Novel / Game Vertical Slice', domain: 'interactive-media',
    deliverableType: 'game.local-build-manifest',
    inputContract: {
      requiredInputKinds: ['goal', 'constraints', 'assets', 'method', 'budget'],
      constraintTypes: ['engine-boundary', 'vertical-slice-scope'],
      assetTypes: ['game-blueprint-source', 'world-context'],
      methodRefs: ['method:game-vertical-slice:v1'],
      budgetProfiles: [{ profileId: 'budget:game-local', currency: 'CNY', maxAmount: 3000, status: 'known' }],
    },
    teams: [
      { teamId: 'team:design', label: 'Design', responsibility: 'Freeze blueprint and design bible.', seatIds: ['seat:game-designer'] },
      { teamId: 'team:production', label: 'Production', responsibility: 'Produce declared assets and code.', seatIds: ['seat:asset-producer', 'seat:game-developer'] },
      { teamId: 'team:integration', label: 'Integration', responsibility: 'Build through a structured external engine adapter.', seatIds: ['seat:integrator'] },
      { teamId: 'team:quality', label: 'Playtest and QA', responsibility: 'Independently verify the playable slice.', seatIds: ['seat:playtester', 'seat:release-owner'] },
    ],
    seats: [
      seat('seat:game-designer', 'team:design', ['artifact:idea', 'artifact:world'], ['artifact:blueprint', 'artifact:design-bible'], ['gate:prototype'], 'capability:game-design', 'agent', 'qualification:game-design'),
      seat('seat:asset-producer', 'team:production', ['artifact:design-bible'], ['artifact:asset-pack'], ['gate:integration'], 'capability:game-assets', 'tool', 'qualification:game-assets'),
      seat('seat:game-developer', 'team:production', ['artifact:blueprint', 'artifact:design-bible'], ['artifact:code'], ['gate:integration'], 'capability:game-code', 'agent', 'qualification:game-code'),
      seat('seat:integrator', 'team:integration', ['artifact:asset-pack', 'artifact:code'], ['artifact:build'], ['gate:integration'], 'capability:external-engine-build', 'tool', 'qualification:engine-adapter'),
      seat('seat:playtester', 'team:quality', ['artifact:build'], ['artifact:playtest'], ['gate:playtest'], 'capability:independent-playtest', 'human', 'qualification:playtest', ['authority:qa']),
      seat('seat:release-owner', 'team:quality', ['artifact:build', 'artifact:playtest'], ['artifact:local-manifest'], ['gate:local-build'], 'capability:local-build-approval', 'human', 'qualification:release-owner', ['authority:release-owner']),
    ],
    artifacts: [
      artifact('artifact:idea', 'game-idea', '', ['seat:game-designer'], [], ['artifact:blueprint', 'artifact:design-bible'], 'workspace:game-idea'),
      artifact('artifact:world', 'world-context', '', ['seat:game-designer'], [], ['artifact:design-bible'], 'workspace:world-context'),
      artifact('artifact:blueprint', 'game-blueprint', 'seat:game-designer', ['seat:game-developer'], ['artifact:idea'], ['artifact:code', 'artifact:build']),
      artifact('artifact:design-bible', 'game-design-bible', 'seat:game-designer', ['seat:asset-producer', 'seat:game-developer'], ['artifact:idea', 'artifact:world'], ['artifact:asset-pack', 'artifact:code', 'artifact:build']),
      artifact('artifact:asset-pack', 'game-asset-pack', 'seat:asset-producer', ['seat:integrator'], ['artifact:design-bible'], ['artifact:build']),
      artifact('artifact:code', 'game-code', 'seat:game-developer', ['seat:integrator'], ['artifact:blueprint', 'artifact:design-bible'], ['artifact:build']),
      artifact('artifact:build', 'game-local-build', 'seat:integrator', ['seat:playtester', 'seat:release-owner'], ['artifact:asset-pack', 'artifact:code'], ['artifact:playtest', 'artifact:local-manifest']),
      artifact('artifact:playtest', 'game-playtest-report', 'seat:playtester', ['seat:release-owner'], ['artifact:build'], ['artifact:local-manifest']),
      artifact('artifact:local-manifest', 'game.local-build-manifest', 'seat:release-owner', [], ['artifact:build', 'artifact:playtest'], []),
    ],
    gates: [
      { gateId: 'gate:prototype', label: 'Prototype Scope', artifactIds: ['artifact:blueprint', 'artifact:design-bible'], verificationRefs: ['check:scope'], reviewRefs: ['review:design'], evaluationRefs: ['evaluation:feasibility'], authorityRef: 'authority:design-owner', passState: 'DESIGN_APPROVED', failState: 'DESIGN_RECOVERY', recoveryPointId: 'recovery:design', destructive: false, requiresHumanAuthority: true },
      { gateId: 'gate:integration', label: 'Engine Integration', artifactIds: ['artifact:asset-pack', 'artifact:code', 'artifact:build'], verificationRefs: ['check:engine-receipt'], reviewRefs: ['review:integration'], evaluationRefs: ['evaluation:tool-risk'], authorityRef: 'authority:integration-owner', passState: 'BUILD_READY', failState: 'BUILD_RECOVERY', recoveryPointId: 'recovery:integration', destructive: false, requiresHumanAuthority: true },
      { gateId: 'gate:playtest', label: 'Independent Playtest', artifactIds: ['artifact:playtest'], verificationRefs: ['check:playtest'], reviewRefs: ['review:qa'], evaluationRefs: ['evaluation:playability'], authorityRef: 'authority:qa', passState: 'PLAYTEST_PASSED', failState: 'PLAYTEST_RECOVERY', recoveryPointId: 'recovery:playtest', destructive: false, requiresHumanAuthority: true },
      { gateId: 'gate:local-build', label: 'Local Build Manifest', artifactIds: ['artifact:local-manifest'], verificationRefs: ['check:manifest'], reviewRefs: ['review:evidence'], evaluationRefs: ['evaluation:local-readiness'], authorityRef: 'authority:release-owner', passState: 'LOCAL_BUILD_APPROVED', failState: 'LOCAL_BUILD_RECOVERY', recoveryPointId: 'recovery:manifest', destructive: true, requiresHumanAuthority: true },
    ],
    authorities: [
      { authorityRef: 'authority:design-owner', kind: 'human', scope: 'vertical slice design', decisionTypes: ['design', 'recovery', 'routing'], cannotDelegate: true, prohibitedSeatIds: ['seat:game-designer'] },
      { authorityRef: 'authority:integration-owner', kind: 'human', scope: 'external engine integration', decisionTypes: ['integration', 'recovery', 'routing'], cannotDelegate: true, prohibitedSeatIds: ['seat:integrator'] },
      { authorityRef: 'authority:qa', kind: 'human', scope: 'independent playtest', decisionTypes: ['qa', 'recovery', 'routing'], cannotDelegate: true, prohibitedSeatIds: ['seat:game-developer', 'seat:integrator'] },
      { authorityRef: 'authority:release-owner', kind: 'human', scope: 'local manifest only; no publication', decisionTypes: ['release', 'recovery', 'routing'], cannotDelegate: true, prohibitedSeatIds: ['seat:integrator'] },
    ],
    recoveryPoints: [
      { recoveryPointId: 'recovery:design', label: 'Repair design', resumeSeatIds: ['seat:game-designer'], affectedArtifactIds: ['artifact:blueprint', 'artifact:design-bible', 'artifact:asset-pack', 'artifact:code', 'artifact:build', 'artifact:playtest', 'artifact:local-manifest'], evidenceRequirements: ['failure-record', 'repair-decision'], authorityRef: 'authority:design-owner' },
      { recoveryPointId: 'recovery:integration', label: 'Repair affected build branch', resumeSeatIds: ['seat:asset-producer', 'seat:game-developer', 'seat:integrator'], affectedArtifactIds: ['artifact:asset-pack', 'artifact:code', 'artifact:build', 'artifact:playtest', 'artifact:local-manifest'], evidenceRequirements: ['tool-receipt', 'repair-decision'], authorityRef: 'authority:integration-owner' },
      { recoveryPointId: 'recovery:playtest', label: 'Repair playtest finding', resumeSeatIds: ['seat:game-developer', 'seat:integrator', 'seat:playtester'], affectedArtifactIds: ['artifact:code', 'artifact:build', 'artifact:playtest', 'artifact:local-manifest'], evidenceRequirements: ['playtest-finding', 'repair-decision'], authorityRef: 'authority:qa' },
      { recoveryPointId: 'recovery:manifest', label: 'Repair local manifest', resumeSeatIds: ['seat:release-owner'], affectedArtifactIds: ['artifact:local-manifest'], evidenceRequirements: ['manifest-finding', 'repair-decision'], authorityRef: 'authority:release-owner' },
    ],
    routingPolicies: [
      { policyId: 'routing:design', seatIds: ['seat:game-designer'], mode: 'human-lock', requiresHumanDecision: true, evidenceRequirements: ['capability-snapshot'] },
      { policyId: 'routing:production', seatIds: ['seat:asset-producer', 'seat:game-developer', 'seat:integrator'], mode: 'human-lock', requiresHumanDecision: true, evidenceRequirements: ['capability-snapshot', 'engine-compatibility'] },
      { policyId: 'routing:quality', seatIds: ['seat:playtester', 'seat:release-owner'], mode: 'human-lock', requiresHumanDecision: true, evidenceRequirements: ['independence-check'] },
    ],
    delegationPolicy: { maxDepth: 0, allowSubcontract: false, requireExplicitSubcontract: true, preventCycles: true, authorityDelegable: false, qualificationDelegable: false, parentLiabilityRetained: true, costAccounting: 'full-chain', provenanceRequired: true, taskContractRequired: true },
    archaeology: [
      { sourceRole: 'game-designer', decision: 'preserve', targetSeatIds: ['seat:game-designer'], reasonClass: 'professional-judgment', rationale: 'Blueprint and rules require explicit design judgment.', evidenceRefs: ['evidence:vertical-slice-method'] },
      { sourceRole: 'asset-production', decision: 'preserve', targetSeatIds: ['seat:asset-producer'], reasonClass: 'tool-boundary', rationale: 'Asset production remains a separately replaceable capability.', evidenceRefs: ['evidence:artifact-contract'] },
      { sourceRole: 'game-development', decision: 'preserve', targetSeatIds: ['seat:game-developer'], reasonClass: 'responsibility', rationale: 'Code production remains accountable for declared source artifacts.', evidenceRefs: ['evidence:artifact-contract'] },
      { sourceRole: 'engine-operator', decision: 'merge', targetSeatIds: ['seat:integrator'], reasonClass: 'tool-boundary', rationale: 'Engine execution is a replaceable external Capability.', evidenceRefs: ['evidence:structured-tool-adapter'] },
      { sourceRole: 'self-certifying-developer', decision: 'merge', targetSeatIds: ['seat:playtester'], reasonClass: 'independent-review', rationale: 'Self-certification is replaced by an explicit independent playtest responsibility.', evidenceRefs: ['evidence:authority-separation'] },
      { sourceRole: 'release-owner', decision: 'preserve', targetSeatIds: ['seat:release-owner'], reasonClass: 'authority-separation', rationale: 'Local build approval remains separate from implementation and integration.', evidenceRefs: ['evidence:authority-separation'] },
    ],
    expertCapabilities: [],
    provenance: { source: 'W82f local vertical slice', engineOwnedByMazz: false, publicationAuthorized: false },
  });
}

function executor(executorRef, kind, capabilityId, qualificationRef, toolAdapterRef = '') {
  return { executorRef, kind, capabilityIds: [capabilityId], qualificationRefs: [qualificationRef], harnessRef: kind === 'agent' ? 'W66' : '', toolAdapterRef, providerRef: '', status: 'available', version: 'fixture:1', estimatedCost: { status: 'known', currency: 'CNY', amount: 100 } };
}

function createGameCompileRequest({ requestId = 'request:game-slice:001', engineAdapterRef = 'tool:external-game-engine', engineAvailable = true } = {}) {
  const workflow = createGameVerticalSliceWorkflow();
  const routes = {
    'seat:game-designer': 'agent:game-designer', 'seat:asset-producer': 'tool:asset-producer',
    'seat:game-developer': 'agent:game-developer', 'seat:integrator': engineAdapterRef,
    'seat:playtester': 'human:playtester', 'seat:release-owner': 'human:release-owner',
  };
  const executors = [
    executor('agent:game-designer', 'agent', 'capability:game-design', 'qualification:game-design'),
    executor('tool:asset-producer', 'tool', 'capability:game-assets', 'qualification:game-assets', 'W79:asset-tool'),
    executor('agent:game-developer', 'agent', 'capability:game-code', 'qualification:game-code'),
    { ...executor(engineAdapterRef, 'tool', 'capability:external-engine-build', 'qualification:engine-adapter', 'W79:external-game-engine'), status: engineAvailable ? 'available' : 'unavailable' },
    executor('human:playtester', 'human', 'capability:independent-playtest', 'qualification:playtest'),
    executor('human:release-owner', 'human', 'capability:local-build-approval', 'qualification:release-owner'),
  ];
  return {
    schema: kernel.ORGANIZATION_COMPILE_REQUEST_SCHEMA, requestId,
    workflowRef: { workflowId: workflow.workflowId, version: workflow.version },
    goal: { goalId: 'goal:game-local-slice', statement: 'Produce one inspectable local playable vertical slice.', deliverableType: workflow.deliverableType },
    constraints: [
      { constraintId: 'constraint:engine', type: 'engine-boundary', valueRef: 'external-structured-adapter:no-mazz-engine', sourceRef: 'W82f' },
      { constraintId: 'constraint:scope', type: 'vertical-slice-scope', valueRef: 'one-map-one-dialogue-one-quest', sourceRef: 'human:maintainer' },
    ],
    assets: [
      { assetId: 'asset:idea', type: 'game-blueprint-source', version: 'fixture:1', sourceRef: 'workspace:idea' },
      { assetId: 'asset:world', type: 'world-context', version: 'fixture:1', sourceRef: 'workspace:world' },
    ],
    method: { methodId: 'method:game-vertical-slice:v1', version: '1.0.0', sourceRef: 'docs/plans/W82_ORGANIZATIONAL_COMPILER.md' },
    budget: { profileId: 'budget:game-local', currency: 'CNY', limit: 1000, status: 'known' },
    capabilitySnapshot: { snapshotId: 'snapshot:game-local:v1', executors },
    routingLocks: Object.entries(routes).map(([seatId, executorRef]) => ({ seatId, executorRef, authorityRef: seatId.includes('playtester') ? 'authority:qa' : seatId.includes('release-owner') ? 'authority:release-owner' : seatId.includes('integrator') ? 'authority:integration-owner' : 'authority:design-owner', reason: 'Explicit local vertical-slice route.' })),
    authorityBindings: [
      { authorityRef: 'authority:design-owner', actorRef: 'human:design-owner', actorKind: 'human' },
      { authorityRef: 'authority:integration-owner', actorRef: 'human:integration-owner', actorKind: 'human' },
      { authorityRef: 'authority:qa', actorRef: 'human:playtester', actorKind: 'human' },
      { authorityRef: 'authority:release-owner', actorRef: 'human:release-owner', actorKind: 'human' },
    ],
    provenance: { source: 'W82f local compile request', engineAvailable, publicationAuthorized: false, externalMutationAuthorized: false },
  };
}

function compileGameVerticalSlice(options = {}) {
  const workflow = createGameVerticalSliceWorkflow();
  const request = createGameCompileRequest(options);
  const plan = kernel.compileOrganization(workflow, request);
  return deepFreeze({ workflow, request, plan, boundary: { mazzGameEngineBuilt: false, externalEngineRequired: true, publicationAuthorized: false } });
}

function evaluateGameToolReceipt({ state, stage, artifactId = '', evidenceRefs = [], message = '' }) {
  const allowedStates = ['completed', 'failed', 'cancelled', 'tool-missing'];
  if (!allowedStates.includes(state)) throw new Error(`未知 tool receipt state: ${state}`);
  const affectedRoot = ({ design: 'artifact:blueprint', assets: 'artifact:asset-pack', code: 'artifact:code', build: 'artifact:build', playtest: 'artifact:playtest', manifest: 'artifact:local-manifest' })[stage];
  if (!affectedRoot) throw new Error(`未知 vertical slice stage: ${stage}`);
  const workflow = createGameVerticalSliceWorkflow();
  const affectedArtifactIds = state === 'completed' ? [] : kernel.affectedArtifacts(workflow, [affectedRoot]);
  return deepFreeze({
    schema: GAME_SLICE_RESULT_SCHEMA, state: state === 'completed' ? 'READY_FOR_NEXT_GATE' : state === 'cancelled' ? 'RECOVERY_REQUIRED_CANCELLED' : state === 'tool-missing' ? 'BLOCKED_TOOL_MISSING' : 'RECOVERY_REQUIRED_FAILED',
    stage, artifactId, evidenceRefs: [...new Set(evidenceRefs.map(String))].sort(), message: String(message).slice(0, 500),
    affectedArtifactIds, unrelatedBranchesPreserved: true,
    runtimeTruthOwner: 'W73', publicationAuthorized: false,
  });
}

module.exports = {
  GAME_SLICE_RESULT_SCHEMA, createGameVerticalSliceWorkflow, createGameCompileRequest,
  compileGameVerticalSlice, evaluateGameToolReceipt,
};
