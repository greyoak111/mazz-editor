'use strict';

const { assertKnownKeys, deepFreeze, isPlainObject } = require('./plain-value');
const kernel = require('./organizational-kernel');
const { createEvidenceSliceRuntime } = require('./evidence-slice-runtime');

const ANIMATION_RECEIPT_SCHEMA = 'mazz.animation-short-tool-receipt/v0';
const ANIMATION_DECISION_SCHEMA = 'mazz.animation-short-authority-decision/v0';
const ANIMATION_RESULT_SCHEMA = 'mazz.animation-short-slice-result/v0';

const runtime = createEvidenceSliceRuntime({
  receiptSchema: ANIMATION_RECEIPT_SCHEMA,
  decisionSchema: ANIMATION_DECISION_SCHEMA,
  resultSchema: ANIMATION_RESULT_SCHEMA,
  workflowId: 'workflow:mazz-local-animation-short:v1',
  scope: 'local-animation-specimen',
  runtimeProtocol: 'w82d',
  receiptStages: [
    'audio-render', 'master-manifest', 'qc', 'storyboard-coverage',
    'timeline-assembly', 'visual-shot-01-render', 'visual-shot-02-render',
  ],
  gates: [
    {
      gateId: 'gate:preproduction',
      verification: [{ source: 'receipt', stage: 'storyboard-coverage', checkRef: 'check:storyboard-coverage' }],
      review: [{ source: 'decision', checkRef: 'review:script-storyboard' }],
      evaluation: [{ source: 'decision', checkRef: 'evaluation:creative-brief' }],
    },
    {
      gateId: 'gate:asset-production',
      verification: [
        { source: 'receipt', stage: 'audio-render', checkRef: 'check:audio-render' },
        { source: 'receipt', stage: 'visual-shot-01-render', checkRef: 'check:visual-shot-01' },
        { source: 'receipt', stage: 'visual-shot-02-render', checkRef: 'check:visual-shot-02' },
      ],
      review: [{ source: 'decision', checkRef: 'review:asset-consistency' }],
      evaluation: [{ source: 'decision', checkRef: 'evaluation:continuity' }],
    },
    {
      gateId: 'gate:timeline-qc',
      verification: [
        { source: 'receipt', stage: 'timeline-assembly', checkRef: 'check:timeline' },
        { source: 'receipt', stage: 'qc', checkRef: 'check:media-qc' },
      ],
      review: [{ source: 'decision', checkRef: 'review:independent-qc' }],
      evaluation: [{ source: 'decision', checkRef: 'evaluation:qc-risk' }],
    },
    {
      gateId: 'gate:master',
      verification: [{ source: 'receipt', stage: 'master-manifest', checkRef: 'check:master-manifest' }],
      review: [{ source: 'decision', checkRef: 'review:master-evidence' }],
      evaluation: [{ source: 'decision', checkRef: 'evaluation:master-readiness' }],
    },
  ],
  stageArtifacts: {
    'audio-render': 'artifact:audio-track',
    'master-manifest': 'artifact:master',
    qc: 'artifact:qc-report',
    'storyboard-coverage': 'artifact:storyboard',
    'timeline-assembly': 'artifact:timeline',
    'visual-shot-01-render': 'artifact:visual-shot-01',
    'visual-shot-02-render': 'artifact:visual-shot-02',
  },
  gateFailureArtifacts: {
    'gate:preproduction': 'artifact:storyboard',
    'gate:asset-production': 'artifact:visual-shot-01',
    'gate:timeline-qc': 'artifact:qc-report',
    'gate:master': 'artifact:master',
  },
  finalArtifactId: 'artifact:master',
  boundary: {
    durationRangeSeconds: '30-180',
    masterManifestOnly: true,
    binaryMasterProduced: false,
    sampleDPassed: false,
    publicationGranted: false,
  },
});

function delegation(seatId, artifactIds, qualificationRef) {
  return {
    allowed: false, maxDepth: 0, subcontractAllowed: false, liabilityOwner: seatId,
    requiredResultArtifactIds: artifactIds, qualificationRefs: [qualificationRef], authorityRefs: [],
  };
}

function seat({ id, team, label, responsibility, inputs, outputs, gates, authorities = [], capability, kind, qualification }) {
  return {
    seatId: id, teamId: team, label, responsibility,
    inputArtifactIds: inputs, outputArtifactIds: outputs, gateIds: gates, authorityRefs: authorities,
    requiredCapabilityIds: [capability], eligibleExecutorKinds: [kind], childSeatOf: '',
    qualificationRefs: [qualification], delegation: delegation(id, outputs, qualification),
  };
}

function artifact({ id, label, type, producer = '', consumers = [], dependsOn = [], invalidates = [], truthOwner = 'W73:production-record', evidence }) {
  return {
    artifactId: id, label, type, version: '1', producedBySeatId: producer,
    consumedBySeatIds: consumers, dependsOn, invalidates, truthOwner,
    evidenceRequirements: evidence, licensePolicy: 'Declared local fixture assets only; no public distribution.', required: true,
  };
}

function recovery(id, label, seats, artifacts, authorityRef) {
  return {
    recoveryPointId: id, label, resumeSeatIds: seats, affectedArtifactIds: artifacts,
    evidenceRequirements: ['failure-record', 'repair-decision'], authorityRef,
  };
}

function archaeology(sourceRole, targetSeatIds, reasonClass, rationale) {
  return { sourceRole, decision: 'preserve', targetSeatIds, reasonClass, rationale, evidenceRefs: ['evidence:animation-pipeline-practice'] };
}

function expert(capabilityId, identity, inputTypes, outputTypes, styleIdentity) {
  return {
    schema: kernel.EXPERT_CAPABILITY_SCHEMA, capabilityId, version: '1.0.0', identity,
    domain: 'animation-short', inputTypes, outputTypes,
    evidenceTypes: ['asset-receipt', 'continuity-review', 'decision-record'],
    attention: ['continuity', 'duration', 'rights', 'shot coverage'],
    decisions: ['accept', 'revise-shot', 'reassemble', 'escalate'],
    negativeKnowledge: ['do not regenerate unrelated shots', 'do not infer missing rights', 'do not self-approve master'],
    gateRefs: [], exceptionPolicy: 'Fail the smallest affected branch and preserve unrelated accepted assets.',
    authorityBoundary: 'Advisory only; cannot grant master approval or publication.',
    permissionScope: ['read:declared-assets', 'write:declared-artifacts'], styleIdentity,
    provenance: { source: 'W82d animation short slice', verifiedBy: 'contract-test' },
  };
}

function createAnimationWorkflowPackage() {
  return kernel.normalizeWorkflowPackage({
    schema: kernel.WORKFLOW_PACKAGE_SCHEMA,
    workflowId: runtime.definition.workflowId,
    version: '1.0.0',
    name: 'Mazz Local 30-180 Second Animation Short Specimen',
    domain: 'animation-short',
    deliverableType: 'animation.local-master-manifest',
    inputContract: {
      requiredInputKinds: ['goal', 'constraints', 'assets', 'method', 'budget'],
      constraintTypes: ['duration-seconds', 'production-boundary'],
      assetTypes: ['animation-brief', 'world-context'],
      methodRefs: ['method:w82d-animation-short'],
      budgetProfiles: [{ profileId: 'budget:w82d-local', currency: 'CNY', maxAmount: 2000, status: 'known' }],
    },
    teams: [
      { teamId: 'team:preproduction', label: 'Preproduction', responsibility: 'Turn the brief into an approved script and storyboard.', seatIds: ['seat:scriptwriter', 'seat:storyboard-artist'] },
      { teamId: 'team:asset-production', label: 'Visual and Audio Production', responsibility: 'Produce independent shot and audio branches under fixed contracts.', seatIds: ['seat:audio-producer', 'seat:visual-producer'] },
      { teamId: 'team:finishing', label: 'Timeline and QC', responsibility: 'Assemble accepted assets and perform independent media QC.', seatIds: ['seat:editor', 'seat:qc-reviewer'] },
      { teamId: 'team:master', label: 'Master Authority', responsibility: 'Approve only a local master manifest without publishing a binary.', seatIds: ['seat:master-owner'] },
    ],
    seats: [
      seat({ id: 'seat:scriptwriter', team: 'team:preproduction', label: 'Scriptwriter', responsibility: 'Produce a duration-bounded script from the declared brief.', inputs: ['artifact:brief'], outputs: ['artifact:script'], gates: ['gate:preproduction'], capability: 'capability:animation-script', kind: 'agent', qualification: 'qualification:scriptwriter' }),
      seat({ id: 'seat:storyboard-artist', team: 'team:preproduction', label: 'Storyboard Artist', responsibility: 'Translate the approved script into complete shot coverage.', inputs: ['artifact:script'], outputs: ['artifact:storyboard'], gates: ['gate:preproduction'], capability: 'capability:storyboard', kind: 'agent', qualification: 'qualification:storyboard' }),
      seat({ id: 'seat:visual-producer', team: 'team:asset-production', label: 'Visual Shot Producer', responsibility: 'Produce shot 01 and shot 02 under the same replaceable Seat contract.', inputs: ['artifact:storyboard'], outputs: ['artifact:visual-shot-01', 'artifact:visual-shot-02'], gates: ['gate:asset-production'], capability: 'capability:visual-shot-render', kind: 'tool', qualification: 'qualification:visual-renderer' }),
      seat({ id: 'seat:audio-producer', team: 'team:asset-production', label: 'Audio Producer', responsibility: 'Produce a duration-matched local audio track independent of visual shots.', inputs: ['artifact:script'], outputs: ['artifact:audio-track'], gates: ['gate:asset-production'], capability: 'capability:audio-render', kind: 'tool', qualification: 'qualification:audio-renderer' }),
      seat({ id: 'seat:editor', team: 'team:finishing', label: 'Timeline Editor', responsibility: 'Assemble accepted visual and audio assets deterministically.', inputs: ['artifact:audio-track', 'artifact:visual-shot-01', 'artifact:visual-shot-02'], outputs: ['artifact:timeline'], gates: ['gate:timeline-qc'], capability: 'capability:timeline-assembly', kind: 'script', qualification: 'qualification:timeline-tool' }),
      seat({ id: 'seat:qc-reviewer', team: 'team:finishing', label: 'Independent QC Reviewer', responsibility: 'Review duration, continuity, synchronization and evidence independently.', inputs: ['artifact:timeline'], outputs: ['artifact:qc-report'], gates: ['gate:timeline-qc'], authorities: ['authority:qc-owner'], capability: 'capability:media-qc', kind: 'human', qualification: 'qualification:media-qc' }),
      seat({ id: 'seat:master-owner', team: 'team:master', label: 'Local Master Owner', responsibility: 'Approve a local master manifest without granting publication.', inputs: ['artifact:qc-report', 'artifact:timeline'], outputs: ['artifact:master'], gates: ['gate:master'], authorities: ['authority:master-owner'], capability: 'capability:master-approval', kind: 'human', qualification: 'qualification:master-owner' }),
    ],
    artifacts: [
      artifact({ id: 'artifact:brief', label: 'Animation Brief', type: 'animation-brief', consumers: ['seat:scriptwriter'], truthOwner: 'workspace:animation-brief', evidence: ['duration', 'world-context', 'rights-boundary'] }),
      artifact({ id: 'artifact:script', label: 'Duration-bounded Script', type: 'animation-script', producer: 'seat:scriptwriter', consumers: ['seat:audio-producer', 'seat:storyboard-artist'], dependsOn: ['artifact:brief'], invalidates: ['artifact:storyboard', 'artifact:audio-track'], evidence: ['script-version', 'duration-estimate'] }),
      artifact({ id: 'artifact:storyboard', label: 'Storyboard', type: 'storyboard', producer: 'seat:storyboard-artist', consumers: ['seat:visual-producer'], dependsOn: ['artifact:script'], invalidates: ['artifact:visual-shot-01', 'artifact:visual-shot-02'], evidence: ['shot-coverage', 'continuity-map'] }),
      artifact({ id: 'artifact:visual-shot-01', label: 'Visual Shot 01', type: 'visual-shot', producer: 'seat:visual-producer', consumers: ['seat:editor'], dependsOn: ['artifact:storyboard'], invalidates: ['artifact:timeline'], evidence: ['render-receipt', 'shot-id'] }),
      artifact({ id: 'artifact:visual-shot-02', label: 'Visual Shot 02', type: 'visual-shot', producer: 'seat:visual-producer', consumers: ['seat:editor'], dependsOn: ['artifact:storyboard'], invalidates: ['artifact:timeline'], evidence: ['render-receipt', 'shot-id'] }),
      artifact({ id: 'artifact:audio-track', label: 'Audio Track', type: 'audio-track', producer: 'seat:audio-producer', consumers: ['seat:editor'], dependsOn: ['artifact:script'], invalidates: ['artifact:timeline'], evidence: ['audio-receipt', 'duration'] }),
      artifact({ id: 'artifact:timeline', label: 'Assembled Timeline', type: 'media-timeline', producer: 'seat:editor', consumers: ['seat:master-owner', 'seat:qc-reviewer'], dependsOn: ['artifact:audio-track', 'artifact:visual-shot-01', 'artifact:visual-shot-02'], invalidates: ['artifact:qc-report'], evidence: ['timeline-receipt', 'asset-version-map'] }),
      artifact({ id: 'artifact:qc-report', label: 'Media QC Report', type: 'media-qc-report', producer: 'seat:qc-reviewer', consumers: ['seat:master-owner'], dependsOn: ['artifact:timeline'], invalidates: ['artifact:master'], evidence: ['duration-check', 'sync-check', 'continuity-check'] }),
      artifact({ id: 'artifact:master', label: 'Local Master Manifest', type: 'animation.local-master-manifest', producer: 'seat:master-owner', dependsOn: ['artifact:qc-report', 'artifact:timeline'], evidence: ['manifest-digest', 'human-final', 'non-publication-boundary'] }),
    ],
    gates: [
      { gateId: 'gate:preproduction', label: 'Script and Storyboard', artifactIds: ['artifact:storyboard'], verificationRefs: ['check:storyboard-coverage'], reviewRefs: ['review:script-storyboard'], evaluationRefs: ['evaluation:creative-brief'], authorityRef: 'authority:creative-director', passState: 'PREPRODUCTION_APPROVED', failState: 'PREPRODUCTION_RECOVERY', recoveryPointId: 'recovery:preproduction', destructive: false, requiresHumanAuthority: true },
      { gateId: 'gate:asset-production', label: 'Visual and Audio Assets', artifactIds: ['artifact:audio-track', 'artifact:visual-shot-01', 'artifact:visual-shot-02'], verificationRefs: ['check:audio-render', 'check:visual-shot-01', 'check:visual-shot-02'], reviewRefs: ['review:asset-consistency'], evaluationRefs: ['evaluation:continuity'], authorityRef: 'authority:creative-director', passState: 'ASSETS_APPROVED', failState: 'ASSET_RECOVERY', recoveryPointId: 'recovery:assets', destructive: false, requiresHumanAuthority: true },
      { gateId: 'gate:timeline-qc', label: 'Timeline and QC', artifactIds: ['artifact:timeline', 'artifact:qc-report'], verificationRefs: ['check:media-qc', 'check:timeline'], reviewRefs: ['review:independent-qc'], evaluationRefs: ['evaluation:qc-risk'], authorityRef: 'authority:qc-owner', passState: 'QC_APPROVED', failState: 'QC_RECOVERY', recoveryPointId: 'recovery:timeline-qc', destructive: false, requiresHumanAuthority: true },
      { gateId: 'gate:master', label: 'Local Master Manifest', artifactIds: ['artifact:master'], verificationRefs: ['check:master-manifest'], reviewRefs: ['review:master-evidence'], evaluationRefs: ['evaluation:master-readiness'], authorityRef: 'authority:master-owner', passState: 'LOCAL_MASTER_APPROVED', failState: 'MASTER_RECOVERY', recoveryPointId: 'recovery:master', destructive: true, requiresHumanAuthority: true },
    ],
    authorities: [
      { authorityRef: 'authority:creative-director', kind: 'human', scope: 'preproduction and asset consistency decisions', decisionTypes: ['creative', 'recovery', 'routing'], cannotDelegate: true, prohibitedSeatIds: ['seat:scriptwriter', 'seat:storyboard-artist', 'seat:visual-producer'] },
      { authorityRef: 'authority:qc-owner', kind: 'human', scope: 'independent timeline and media QC', decisionTypes: ['qc', 'recovery', 'routing'], cannotDelegate: true, prohibitedSeatIds: ['seat:editor', 'seat:visual-producer'] },
      { authorityRef: 'authority:master-owner', kind: 'human', scope: 'local master manifest final; no publication', decisionTypes: ['master', 'recovery', 'routing'], cannotDelegate: true, prohibitedSeatIds: ['seat:editor', 'seat:scriptwriter', 'seat:visual-producer'] },
    ],
    recoveryPoints: [
      recovery('recovery:preproduction', 'Return to Script or Storyboard', ['seat:scriptwriter', 'seat:storyboard-artist'], ['artifact:script', 'artifact:storyboard', 'artifact:visual-shot-01', 'artifact:visual-shot-02', 'artifact:audio-track', 'artifact:timeline', 'artifact:qc-report', 'artifact:master'], 'authority:creative-director'),
      recovery('recovery:assets', 'Return to Affected Asset', ['seat:audio-producer', 'seat:visual-producer'], ['artifact:visual-shot-01', 'artifact:visual-shot-02', 'artifact:audio-track', 'artifact:timeline', 'artifact:qc-report', 'artifact:master'], 'authority:creative-director'),
      recovery('recovery:timeline-qc', 'Return to Timeline or QC', ['seat:editor', 'seat:qc-reviewer'], ['artifact:timeline', 'artifact:qc-report', 'artifact:master'], 'authority:qc-owner'),
      recovery('recovery:master', 'Return to Master Manifest', ['seat:master-owner'], ['artifact:master'], 'authority:master-owner'),
    ],
    routingPolicies: [
      { policyId: 'routing:preproduction', seatIds: ['seat:scriptwriter', 'seat:storyboard-artist'], mode: 'human-lock', requiresHumanDecision: true, evidenceRequirements: ['capability-snapshot', 'creative-director-routing'] },
      { policyId: 'routing:assets', seatIds: ['seat:audio-producer', 'seat:visual-producer'], mode: 'human-lock', requiresHumanDecision: true, evidenceRequirements: ['capability-snapshot', 'tool-compatibility'] },
      { policyId: 'routing:finishing', seatIds: ['seat:editor', 'seat:qc-reviewer'], mode: 'human-lock', requiresHumanDecision: true, evidenceRequirements: ['capability-snapshot', 'conflict-check'] },
      { policyId: 'routing:master', seatIds: ['seat:master-owner'], mode: 'human-lock', requiresHumanDecision: true, evidenceRequirements: ['capability-snapshot', 'master-owner-binding'] },
    ],
    delegationPolicy: { maxDepth: 0, allowSubcontract: false, requireExplicitSubcontract: true, preventCycles: true, authorityDelegable: false, qualificationDelegable: false, parentLiabilityRetained: true, costAccounting: 'full-chain', provenanceRequired: true, taskContractRequired: true },
    archaeology: [
      archaeology('scriptwriter', ['seat:scriptwriter'], 'professional-judgment', 'Script structure and duration remain explicit responsibilities.'),
      archaeology('storyboard-artist', ['seat:storyboard-artist'], 'professional-judgment', 'Shot coverage is a separate inspectable handoff.'),
      archaeology('visual-production', ['seat:visual-producer'], 'tool-boundary', 'Visual executor can be replaced without changing the Seat contract.'),
      archaeology('audio-production', ['seat:audio-producer'], 'tool-boundary', 'Audio remains an independent versioned branch.'),
      archaeology('editor', ['seat:editor'], 'tool-boundary', 'Timeline assembly is deterministic and evidence-backed.'),
      archaeology('quality-control', ['seat:qc-reviewer'], 'independent-review', 'QC cannot collapse into the editor or renderer.'),
      archaeology('master-director', ['seat:master-owner'], 'authority-separation', 'Master approval remains separate from production.'),
      { sourceRole: 'manual-render-farm-dispatcher', decision: 'remove', targetSeatIds: [], reasonClass: 'legacy-friction', rationale: 'Moving files and polling renders is transport friction, not judgment.', evidenceRefs: ['evidence:artifact-pipeline'] },
    ],
    expertCapabilities: [
      expert('expert:storyboard-continuity', 'Storyboard Continuity Specialist', ['animation-script'], ['storyboard'], 'continuity-first'),
      expert('expert:media-qc', 'Animation Media QC Specialist', ['media-timeline'], ['media-qc-report'], 'evidence-first-qc'),
    ],
    provenance: { source: 'W82d Animation Short Vertical Slice', boundary: 'local manifest fixture; no binary/publication', runtimeOwner: 'W73' },
  });
}

function executor(executorRef, kind, capability, qualification, version, amount) {
  return {
    executorRef, kind, capabilityIds: [capability], qualificationRefs: [qualification],
    harnessRef: kind === 'agent' ? 'W66:agent-harness' : '',
    toolAdapterRef: ['script', 'tool'].includes(kind) ? `adapter:${capability}` : '', providerRef: '',
    status: 'available', version, estimatedCost: { status: 'known', currency: 'CNY', amount },
  };
}

function createAnimationCompileRequest(options = {}) {
  if (!isPlainObject(options)) throw new Error('Animation Compile Request options 必须是对象');
  assertKnownKeys(options, ['requestId', 'durationSeconds', 'visualExecutorRef'], 'Animation Compile Request options');
  const durationSeconds = Number(options.durationSeconds ?? 60);
  if (!Number.isInteger(durationSeconds) || durationSeconds < 30 || durationSeconds > 180) throw new Error('W82d durationSeconds 必须是 30–180 的整数');
  const visualExecutorRef = String(options.visualExecutorRef || 'tool:visual-primary');
  if (!['tool:visual-backup', 'tool:visual-primary'].includes(visualExecutorRef)) throw new Error(`未知 Visual Executor: ${visualExecutorRef}`);
  const workflow = createAnimationWorkflowPackage();
  const routes = {
    'seat:scriptwriter': 'agent:animation-scriptwriter',
    'seat:storyboard-artist': 'agent:storyboard-artist',
    'seat:visual-producer': visualExecutorRef,
    'seat:audio-producer': 'tool:audio-renderer',
    'seat:editor': 'script:timeline-assembler',
    'seat:qc-reviewer': 'human:qc-reviewer',
    'seat:master-owner': 'human:master-owner',
  };
  return deepFreeze({
    schema: kernel.ORGANIZATION_COMPILE_REQUEST_SCHEMA,
    requestId: String(options.requestId || 'request:w82d-local-animation:001'),
    workflowRef: { workflowId: workflow.workflowId, version: workflow.version },
    goal: { goalId: 'goal:w82d-local-master', statement: `Produce a ${durationSeconds}-second local animation master manifest.`, deliverableType: workflow.deliverableType },
    constraints: [
      { constraintId: 'constraint:duration', type: 'duration-seconds', valueRef: String(durationSeconds), sourceRef: 'workspace:animation-brief' },
      { constraintId: 'constraint:boundary', type: 'production-boundary', valueRef: 'local-manifest:no-binary:no-publication', sourceRef: 'W82d:authority' },
    ],
    assets: [
      { assetId: 'asset:brief', type: 'animation-brief', version: 'fixture:1', sourceRef: 'workspace:animation-brief' },
      { assetId: 'asset:world', type: 'world-context', version: 'fixture:1', sourceRef: 'workspace:world-context' },
    ],
    method: { methodId: 'method:w82d-animation-short', version: '1.0.0', sourceRef: 'docs/engineering/W82D_ANIMATION_SHORT_SLICE_SPEC.md' },
    budget: { profileId: 'budget:w82d-local', currency: 'CNY', limit: 1500, status: 'known' },
    capabilitySnapshot: {
      snapshotId: 'snapshot:w82d-local:v1',
      executors: [
        executor('agent:animation-scriptwriter', 'agent', 'capability:animation-script', 'qualification:scriptwriter', 'W66:fixture', 100),
        executor('agent:storyboard-artist', 'agent', 'capability:storyboard', 'qualification:storyboard', 'W66:fixture', 120),
        executor('tool:visual-primary', 'tool', 'capability:visual-shot-render', 'qualification:visual-renderer', 'visual-fixture:primary', 200),
        executor('tool:visual-backup', 'tool', 'capability:visual-shot-render', 'qualification:visual-renderer', 'visual-fixture:backup', 240),
        executor('tool:audio-renderer', 'tool', 'capability:audio-render', 'qualification:audio-renderer', 'audio-fixture:1', 120),
        executor('script:timeline-assembler', 'script', 'capability:timeline-assembly', 'qualification:timeline-tool', 'timeline-fixture:1', 40),
        executor('human:qc-reviewer', 'human', 'capability:media-qc', 'qualification:media-qc', 'roster:1', 120),
        executor('human:master-owner', 'human', 'capability:master-approval', 'qualification:master-owner', 'roster:1', 150),
      ],
    },
    routingLocks: Object.entries(routes).map(([seatId, executorRef]) => ({
      seatId, executorRef,
      authorityRef: ['seat:scriptwriter', 'seat:storyboard-artist', 'seat:visual-producer', 'seat:audio-producer'].includes(seatId)
        ? 'authority:creative-director' : ['seat:editor', 'seat:qc-reviewer'].includes(seatId) ? 'authority:qc-owner' : 'authority:master-owner',
      reason: 'Pinned accountable executor for the local W82d specimen.',
    })),
    authorityBindings: [
      { authorityRef: 'authority:creative-director', actorRef: 'human:creative-director', actorKind: 'human' },
      { authorityRef: 'authority:qc-owner', actorRef: 'human:qc-reviewer', actorKind: 'human' },
      { authorityRef: 'authority:master-owner', actorRef: 'human:master-owner', actorKind: 'human' },
    ],
    provenance: { source: 'W82d local fixture', requestedBy: 'human:maintainer', binaryMasterProduced: false, publicationAuthorized: false },
  });
}

function evaluateAnimationSlice(input) {
  const duration = Number(input?.compileRequest?.constraints?.find(item => item.type === 'duration-seconds')?.valueRef);
  if (!Number.isInteger(duration) || duration < 30 || duration > 180) throw new Error('W82d Compile Request duration 必须保持 30–180 秒');
  return runtime.evaluate(input);
}

module.exports = {
  ANIMATION_RECEIPT_SCHEMA,
  ANIMATION_DECISION_SCHEMA,
  ANIMATION_RESULT_SCHEMA,
  createAnimationWorkflowPackage,
  createAnimationCompileRequest,
  normalizeAnimationReceipt: runtime.normalizeReceipt,
  normalizeAnimationDecision: runtime.normalizeDecision,
  evaluateAnimationSlice,
  toW73AnimationEvents: runtime.toW73Events,
};
