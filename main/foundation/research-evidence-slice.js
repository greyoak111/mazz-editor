'use strict';

const { deepFreeze, isPlainObject } = require('./plain-value');
const kernel = require('./organizational-kernel');
const { createEvidenceSliceRuntime } = require('./evidence-slice-runtime');

const RESEARCH_RECEIPT_SCHEMA = 'mazz.research-evidence-tool-receipt/v0';
const RESEARCH_DECISION_SCHEMA = 'mazz.research-evidence-authority-decision/v0';
const RESEARCH_RESULT_SCHEMA = 'mazz.research-evidence-slice-result/v0';

const runtime = createEvidenceSliceRuntime({
  receiptSchema: RESEARCH_RECEIPT_SCHEMA,
  decisionSchema: RESEARCH_DECISION_SCHEMA,
  resultSchema: RESEARCH_RESULT_SCHEMA,
  workflowId: 'workflow:mazz-local-evidence-research:v1',
  scope: 'local-research-specimen',
  runtimeProtocol: 'w82c',
  receiptStages: ['analysis-trace', 'citations', 'data-integrity', 'replication', 'report-audit', 'statistics'],
  gates: [
    {
      gateId: 'gate:evidence-method',
      verification: [{ source: 'receipt', stage: 'citations', checkRef: 'check:citations' }],
      review: [{ source: 'decision', checkRef: 'review:method' }],
      evaluation: [{ source: 'decision', checkRef: 'evaluation:research-design' }],
    },
    {
      gateId: 'gate:analysis-review',
      verification: [
        { source: 'receipt', stage: 'analysis-trace', checkRef: 'check:analysis-trace' },
        { source: 'receipt', stage: 'data-integrity', checkRef: 'check:data-integrity' },
        { source: 'receipt', stage: 'statistics', checkRef: 'check:statistics' },
      ],
      review: [{ source: 'decision', checkRef: 'review:adversarial' }],
      evaluation: [{ source: 'decision', checkRef: 'evaluation:claim-strength' }],
    },
    {
      gateId: 'gate:replication',
      verification: [{ source: 'receipt', stage: 'replication', checkRef: 'check:replication' }],
      review: [{ source: 'decision', checkRef: 'review:replication' }],
      evaluation: [{ source: 'decision', checkRef: 'evaluation:reproducibility' }],
    },
    {
      gateId: 'gate:report',
      verification: [{ source: 'receipt', stage: 'report-audit', checkRef: 'check:report-audit' }],
      review: [{ source: 'decision', checkRef: 'review:report-evidence' }],
      evaluation: [{ source: 'decision', checkRef: 'evaluation:publication-readiness' }],
    },
  ],
  stageArtifacts: {
    'analysis-trace': 'artifact:analysis',
    citations: 'artifact:literature',
    'data-integrity': 'artifact:data',
    replication: 'artifact:replication',
    'report-audit': 'artifact:report',
    statistics: 'artifact:statistics',
  },
  gateFailureArtifacts: {
    'gate:evidence-method': 'artifact:method',
    'gate:analysis-review': 'artifact:analysis',
    'gate:replication': 'artifact:replication',
    'gate:report': 'artifact:report',
  },
  finalArtifactId: 'artifact:report',
  boundary: {
    reportPublished: false,
    humanFinalRequired: true,
    deterministicCalculationOwner: 'script-executor',
    modelJudgmentAuthority: false,
  },
});

function delegation(seatId, artifactId, qualificationRef) {
  return {
    allowed: false, maxDepth: 0, subcontractAllowed: false, liabilityOwner: seatId,
    requiredResultArtifactIds: [artifactId], qualificationRefs: [qualificationRef], authorityRefs: [],
  };
}

function seat({ id, team, label, responsibility, inputs, output, gates, authorities = [], capability, kind, qualification }) {
  return {
    seatId: id, teamId: team, label, responsibility,
    inputArtifactIds: inputs, outputArtifactIds: [output], gateIds: gates, authorityRefs: authorities,
    requiredCapabilityIds: [capability], eligibleExecutorKinds: [kind], childSeatOf: '',
    qualificationRefs: [qualification], delegation: delegation(id, output, qualification),
  };
}

function artifact({ id, label, type, producer = '', consumers = [], dependsOn = [], invalidates = [], truthOwner = 'W73:production-record', evidence }) {
  return {
    artifactId: id, label, type, version: '1', producedBySeatId: producer,
    consumedBySeatIds: consumers, dependsOn, invalidates, truthOwner,
    evidenceRequirements: evidence, licensePolicy: 'Declared source/data license and citation policy; local specimen only.', required: true,
  };
}

function recovery(id, label, seats, artifacts, authorityRef) {
  return {
    recoveryPointId: id, label, resumeSeatIds: seats, affectedArtifactIds: artifacts,
    evidenceRequirements: ['failure-record', 'repair-decision'], authorityRef,
  };
}

function archaeology(sourceRole, targetSeatIds, reasonClass, rationale) {
  return {
    sourceRole, decision: 'preserve', targetSeatIds, reasonClass, rationale,
    evidenceRefs: ['evidence:research-practice'],
  };
}

function expert(capabilityId, identity, inputTypes, outputTypes, styleIdentity) {
  return {
    schema: kernel.EXPERT_CAPABILITY_SCHEMA, capabilityId, version: '1.0.0', identity,
    domain: 'evidence-research', inputTypes, outputTypes,
    evidenceTypes: ['citation-record', 'decision-record', 'tool-receipt'],
    attention: ['counter-evidence', 'method limits', 'source traceability'],
    decisions: ['accept', 'revise', 'falsify', 'escalate'],
    negativeKnowledge: ['do not invent citations', 'do not replace statistics with prose', 'do not self-validate'],
    gateRefs: [], exceptionPolicy: 'Expose missing evidence and failed replication instead of smoothing them into prose.',
    authorityBoundary: 'Advisory only; cannot sign final report or grant publication.',
    permissionScope: ['read:declared-corpus', 'write:declared-artifact'], styleIdentity,
    provenance: { source: 'W82c research evidence slice', verifiedBy: 'contract-test' },
  };
}

function createResearchWorkflowPackage() {
  return kernel.normalizeWorkflowPackage({
    schema: kernel.WORKFLOW_PACKAGE_SCHEMA,
    workflowId: runtime.definition.workflowId,
    version: '1.0.0',
    name: 'Mazz Local Evidence Research Specimen',
    domain: 'evidence-research',
    deliverableType: 'research.local-evidence-report',
    inputContract: {
      requiredInputKinds: ['goal', 'constraints', 'assets', 'method', 'budget'],
      constraintTypes: ['citation-policy', 'research-scope'],
      assetTypes: ['research-question', 'source-corpus'],
      methodRefs: ['method:w82c-evidence-research'],
      budgetProfiles: [{ profileId: 'budget:w82c-local', currency: 'CNY', maxAmount: 1500, status: 'known' }],
    },
    teams: [
      { teamId: 'team:discovery', label: 'Evidence Discovery', responsibility: 'Collect traceable literature and freeze a reviewable method.', seatIds: ['seat:literature-researcher', 'seat:method-lead'] },
      { teamId: 'team:analysis', label: 'Deterministic and Interpretive Analysis', responsibility: 'Keep data checks, statistics, and model judgment as separate artifacts.', seatIds: ['seat:analyst', 'seat:data-steward', 'seat:statistician'] },
      { teamId: 'team:validation', label: 'Independent Validation', responsibility: 'Attack claims and reproduce deterministic results independently.', seatIds: ['seat:adversarial-reviewer', 'seat:replicator'] },
      { teamId: 'team:publication', label: 'Report Authority', responsibility: 'Synthesize a local report and hold non-delegable Human Final.', seatIds: ['seat:research-lead'] },
    ],
    seats: [
      seat({ id: 'seat:literature-researcher', team: 'team:discovery', label: 'Literature Researcher', responsibility: 'Assemble a source-addressable corpus without inventing citations.', inputs: ['artifact:question'], output: 'artifact:literature', gates: ['gate:evidence-method'], capability: 'capability:literature-trace', kind: 'agent', qualification: 'qualification:evidence-research' }),
      seat({ id: 'seat:method-lead', team: 'team:discovery', label: 'Method Lead', responsibility: 'Define the method and approve only evidence-backed research design.', inputs: ['artifact:literature', 'artifact:question'], output: 'artifact:method', gates: ['gate:evidence-method'], authorities: ['authority:method-owner'], capability: 'capability:research-method', kind: 'human', qualification: 'qualification:method-lead' }),
      seat({ id: 'seat:data-steward', team: 'team:analysis', label: 'Data Steward', responsibility: 'Produce a versioned data snapshot and deterministic integrity receipt.', inputs: ['artifact:method'], output: 'artifact:data', gates: ['gate:analysis-review'], capability: 'capability:data-integrity', kind: 'script', qualification: 'qualification:data-tool' }),
      seat({ id: 'seat:statistician', team: 'team:analysis', label: 'Statistician Executor', responsibility: 'Calculate declared statistics without model substitution.', inputs: ['artifact:data', 'artifact:method'], output: 'artifact:statistics', gates: ['gate:analysis-review'], capability: 'capability:deterministic-statistics', kind: 'script', qualification: 'qualification:statistics-tool' }),
      seat({ id: 'seat:analyst', team: 'team:analysis', label: 'Interpretive Analyst', responsibility: 'Interpret declared evidence while exposing uncertainty and counter-evidence.', inputs: ['artifact:literature', 'artifact:method', 'artifact:statistics'], output: 'artifact:analysis', gates: ['gate:analysis-review'], capability: 'capability:evidence-analysis', kind: 'agent', qualification: 'qualification:research-analysis' }),
      seat({ id: 'seat:adversarial-reviewer', team: 'team:validation', label: 'Adversarial Reviewer', responsibility: 'Challenge the analysis independently of its author.', inputs: ['artifact:analysis', 'artifact:statistics'], output: 'artifact:adversarial-review', gates: ['gate:analysis-review'], authorities: ['authority:analysis-review'], capability: 'capability:adversarial-review', kind: 'human', qualification: 'qualification:adversarial-reviewer' }),
      seat({ id: 'seat:replicator', team: 'team:validation', label: 'Independent Replicator', responsibility: 'Re-run the declared method against the frozen data snapshot.', inputs: ['artifact:data', 'artifact:method', 'artifact:statistics'], output: 'artifact:replication', gates: ['gate:replication'], capability: 'capability:replication', kind: 'script', qualification: 'qualification:replication-tool' }),
      seat({ id: 'seat:research-lead', team: 'team:publication', label: 'Research Lead', responsibility: 'Synthesize evidence and hold final report authority without granting publication.', inputs: ['artifact:adversarial-review', 'artifact:analysis', 'artifact:replication'], output: 'artifact:report', gates: ['gate:replication', 'gate:report'], authorities: ['authority:replication-owner', 'authority:research-lead'], capability: 'capability:research-synthesis', kind: 'human', qualification: 'qualification:research-lead' }),
    ],
    artifacts: [
      artifact({ id: 'artifact:question', label: 'Research Question', type: 'research-question', consumers: ['seat:literature-researcher', 'seat:method-lead'], truthOwner: 'workspace:research-brief', evidence: ['question-source', 'scope'] }),
      artifact({ id: 'artifact:literature', label: 'Traceable Literature Corpus', type: 'source-corpus', producer: 'seat:literature-researcher', consumers: ['seat:analyst', 'seat:method-lead'], dependsOn: ['artifact:question'], invalidates: ['artifact:method'], evidence: ['citation-manifest', 'source-addresses'] }),
      artifact({ id: 'artifact:method', label: 'Research Method', type: 'research-method', producer: 'seat:method-lead', consumers: ['seat:analyst', 'seat:data-steward', 'seat:replicator', 'seat:statistician'], dependsOn: ['artifact:literature', 'artifact:question'], invalidates: ['artifact:data', 'artifact:statistics', 'artifact:analysis', 'artifact:replication'], evidence: ['method-version', 'authority-decision'] }),
      artifact({ id: 'artifact:data', label: 'Frozen Data Snapshot', type: 'research-data', producer: 'seat:data-steward', consumers: ['seat:replicator', 'seat:statistician'], dependsOn: ['artifact:method'], invalidates: ['artifact:statistics', 'artifact:replication'], evidence: ['data-digest', 'integrity-receipt'] }),
      artifact({ id: 'artifact:statistics', label: 'Deterministic Statistics', type: 'calculation-result', producer: 'seat:statistician', consumers: ['seat:adversarial-reviewer', 'seat:analyst', 'seat:replicator'], dependsOn: ['artifact:data', 'artifact:method'], invalidates: ['artifact:analysis', 'artifact:replication'], evidence: ['script-version', 'calculation-receipt'] }),
      artifact({ id: 'artifact:analysis', label: 'Traceable Analysis', type: 'research-analysis', producer: 'seat:analyst', consumers: ['seat:adversarial-reviewer', 'seat:research-lead'], dependsOn: ['artifact:literature', 'artifact:method', 'artifact:statistics'], invalidates: ['artifact:adversarial-review'], evidence: ['claim-evidence-links', 'uncertainty-record'] }),
      artifact({ id: 'artifact:adversarial-review', label: 'Adversarial Review', type: 'review-record', producer: 'seat:adversarial-reviewer', consumers: ['seat:research-lead'], dependsOn: ['artifact:analysis', 'artifact:statistics'], invalidates: ['artifact:report'], evidence: ['counter-evidence', 'reviewer-decision'] }),
      artifact({ id: 'artifact:replication', label: 'Replication Record', type: 'replication-record', producer: 'seat:replicator', consumers: ['seat:research-lead'], dependsOn: ['artifact:data', 'artifact:method', 'artifact:statistics'], invalidates: ['artifact:report'], evidence: ['replication-receipt', 'difference-report'] }),
      artifact({ id: 'artifact:report', label: 'Local Evidence Report', type: 'research.local-evidence-report', producer: 'seat:research-lead', dependsOn: ['artifact:adversarial-review', 'artifact:analysis', 'artifact:replication'], evidence: ['citation-audit', 'human-final', 'non-publication-boundary'] }),
    ],
    gates: [
      { gateId: 'gate:evidence-method', label: 'Evidence and Method', artifactIds: ['artifact:literature', 'artifact:method'], verificationRefs: ['check:citations'], reviewRefs: ['review:method'], evaluationRefs: ['evaluation:research-design'], authorityRef: 'authority:method-owner', passState: 'METHOD_APPROVED', failState: 'EVIDENCE_METHOD_RECOVERY', recoveryPointId: 'recovery:evidence-method', destructive: false, requiresHumanAuthority: true },
      { gateId: 'gate:analysis-review', label: 'Analysis and Adversarial Review', artifactIds: ['artifact:statistics', 'artifact:analysis', 'artifact:adversarial-review'], verificationRefs: ['check:analysis-trace', 'check:data-integrity', 'check:statistics'], reviewRefs: ['review:adversarial'], evaluationRefs: ['evaluation:claim-strength'], authorityRef: 'authority:analysis-review', passState: 'ANALYSIS_ACCEPTED', failState: 'ANALYSIS_RECOVERY', recoveryPointId: 'recovery:analysis', destructive: false, requiresHumanAuthority: true },
      { gateId: 'gate:replication', label: 'Independent Replication', artifactIds: ['artifact:replication'], verificationRefs: ['check:replication'], reviewRefs: ['review:replication'], evaluationRefs: ['evaluation:reproducibility'], authorityRef: 'authority:replication-owner', passState: 'REPLICATION_ACCEPTED', failState: 'REPLICATION_RECOVERY', recoveryPointId: 'recovery:replication', destructive: false, requiresHumanAuthority: true },
      { gateId: 'gate:report', label: 'Local Report Final', artifactIds: ['artifact:report'], verificationRefs: ['check:report-audit'], reviewRefs: ['review:report-evidence'], evaluationRefs: ['evaluation:publication-readiness'], authorityRef: 'authority:research-lead', passState: 'LOCAL_REPORT_APPROVED', failState: 'REPORT_RECOVERY', recoveryPointId: 'recovery:report', destructive: true, requiresHumanAuthority: true },
    ],
    authorities: [
      { authorityRef: 'authority:method-owner', kind: 'human', scope: 'method approval and evidence recovery', decisionTypes: ['method', 'recovery', 'routing'], cannotDelegate: true, prohibitedSeatIds: ['seat:literature-researcher'] },
      { authorityRef: 'authority:analysis-review', kind: 'human', scope: 'adversarial analysis review and recovery', decisionTypes: ['recovery', 'review', 'routing'], cannotDelegate: true, prohibitedSeatIds: ['seat:analyst', 'seat:statistician'] },
      { authorityRef: 'authority:replication-owner', kind: 'human', scope: 'replication acceptance and recovery', decisionTypes: ['recovery', 'replication', 'routing'], cannotDelegate: true, prohibitedSeatIds: ['seat:analyst', 'seat:replicator'] },
      { authorityRef: 'authority:research-lead', kind: 'human', scope: 'local report final only; no publication grant', decisionTypes: ['recovery', 'report', 'routing'], cannotDelegate: true, prohibitedSeatIds: ['seat:analyst', 'seat:literature-researcher'] },
    ],
    recoveryPoints: [
      recovery('recovery:evidence-method', 'Return to Evidence or Method', ['seat:literature-researcher', 'seat:method-lead'], ['artifact:literature', 'artifact:method', 'artifact:data', 'artifact:statistics', 'artifact:analysis', 'artifact:adversarial-review', 'artifact:replication', 'artifact:report'], 'authority:method-owner'),
      recovery('recovery:analysis', 'Return to Data, Statistics, or Analysis', ['seat:data-steward', 'seat:statistician', 'seat:analyst'], ['artifact:data', 'artifact:statistics', 'artifact:analysis', 'artifact:adversarial-review', 'artifact:replication', 'artifact:report'], 'authority:analysis-review'),
      recovery('recovery:replication', 'Return to Replication', ['seat:replicator'], ['artifact:replication', 'artifact:report'], 'authority:replication-owner'),
      recovery('recovery:report', 'Return to Report Synthesis', ['seat:research-lead'], ['artifact:report'], 'authority:research-lead'),
    ],
    routingPolicies: [
      { policyId: 'routing:discovery', seatIds: ['seat:literature-researcher', 'seat:method-lead'], mode: 'human-lock', requiresHumanDecision: true, evidenceRequirements: ['capability-snapshot', 'method-owner-routing'] },
      { policyId: 'routing:analysis', seatIds: ['seat:analyst', 'seat:data-steward', 'seat:statistician'], mode: 'human-lock', requiresHumanDecision: true, evidenceRequirements: ['capability-snapshot', 'method-compatibility'] },
      { policyId: 'routing:validation', seatIds: ['seat:adversarial-reviewer', 'seat:replicator'], mode: 'human-lock', requiresHumanDecision: true, evidenceRequirements: ['capability-snapshot', 'conflict-check'] },
      { policyId: 'routing:publication', seatIds: ['seat:research-lead'], mode: 'human-lock', requiresHumanDecision: true, evidenceRequirements: ['capability-snapshot', 'human-final-binding'] },
    ],
    delegationPolicy: { maxDepth: 0, allowSubcontract: false, requireExplicitSubcontract: true, preventCycles: true, authorityDelegable: false, qualificationDelegable: false, parentLiabilityRetained: true, costAccounting: 'full-chain', provenanceRequired: true, taskContractRequired: true },
    archaeology: [
      archaeology('librarian', ['seat:literature-researcher'], 'professional-judgment', 'Source discovery remains explicit and traceable.'),
      archaeology('principal-investigator-method', ['seat:method-lead'], 'authority-separation', 'Method approval is separate from evidence collection.'),
      archaeology('data-steward', ['seat:data-steward'], 'tool-boundary', 'Data integrity is deterministic and versioned.'),
      archaeology('statistician', ['seat:statistician'], 'tool-boundary', 'Statistics cannot be replaced by model prose.'),
      archaeology('analyst', ['seat:analyst'], 'professional-judgment', 'Interpretation remains distinct from calculation.'),
      archaeology('peer-reviewer', ['seat:adversarial-reviewer'], 'independent-review', 'Claim review cannot collapse into authorship.'),
      archaeology('replication-team', ['seat:replicator'], 'independent-review', 'Replication uses an independent execution boundary.'),
      archaeology('research-editor', ['seat:research-lead'], 'authority-separation', 'Final report authority remains human and non-delegable.'),
      { sourceRole: 'manual-citation-copy-clerk', decision: 'remove', targetSeatIds: [], reasonClass: 'legacy-friction', rationale: 'Copying citation strings is transport friction, not independent judgment.', evidenceRefs: ['evidence:citation-pipeline'] },
    ],
    expertCapabilities: [
      expert('expert:evidence-analysis', 'Traceable Evidence Analyst', ['calculation-result', 'research-method', 'source-corpus'], ['research-analysis'], 'claim-evidence-first'),
      expert('expert:adversarial-review', 'Adversarial Research Reviewer', ['calculation-result', 'research-analysis'], ['review-record'], 'falsification-first'),
    ],
    provenance: { source: 'W82c Research / Evidence Organization Slice', boundary: 'local report; no publication', runtimeOwner: 'W73' },
  });
}

function executor(executorRef, kind, capability, qualification, version, amount) {
  return {
    executorRef, kind, capabilityIds: [capability], qualificationRefs: [qualification],
    harnessRef: kind === 'agent' ? 'W66:agent-harness' : '',
    toolAdapterRef: kind === 'script' ? `adapter:${capability}` : '', providerRef: '',
    status: 'available', version, estimatedCost: { status: 'known', currency: 'CNY', amount },
  };
}

function createResearchCompileRequest(options = {}) {
  if (!isPlainObject(options)) throw new Error('Research Compile Request options 必须是对象');
  const allowed = new Set(['requestId', 'sourceCorpusVersion', 'questionVersion']);
  const unknown = Object.keys(options).filter(key => !allowed.has(key));
  if (unknown.length) throw new Error(`Research Compile Request options 含未冻结字段: ${unknown.join(', ')}`);
  const workflow = createResearchWorkflowPackage();
  const authorities = {
    'authority:method-owner': 'human:method-lead',
    'authority:analysis-review': 'human:adversarial-reviewer',
    'authority:replication-owner': 'human:replication-owner',
    'authority:research-lead': 'human:research-lead',
  };
  const routes = {
    'seat:literature-researcher': 'agent:literature-researcher',
    'seat:method-lead': 'human:method-lead',
    'seat:data-steward': 'script:data-integrity',
    'seat:statistician': 'script:statistics',
    'seat:analyst': 'agent:evidence-analyst',
    'seat:adversarial-reviewer': 'human:adversarial-reviewer',
    'seat:replicator': 'script:replicator',
    'seat:research-lead': 'human:research-lead',
  };
  const executorRows = [
    executor('agent:literature-researcher', 'agent', 'capability:literature-trace', 'qualification:evidence-research', 'W66:fixture', 100),
    executor('human:method-lead', 'human', 'capability:research-method', 'qualification:method-lead', 'roster:1', 120),
    executor('script:data-integrity', 'script', 'capability:data-integrity', 'qualification:data-tool', 'data-check:1', 20),
    executor('script:statistics', 'script', 'capability:deterministic-statistics', 'qualification:statistics-tool', 'statistics:1', 20),
    executor('agent:evidence-analyst', 'agent', 'capability:evidence-analysis', 'qualification:research-analysis', 'W66:fixture', 120),
    executor('human:adversarial-reviewer', 'human', 'capability:adversarial-review', 'qualification:adversarial-reviewer', 'roster:1', 120),
    executor('script:replicator', 'script', 'capability:replication', 'qualification:replication-tool', 'replicator:1', 30),
    executor('human:research-lead', 'human', 'capability:research-synthesis', 'qualification:research-lead', 'roster:1', 150),
  ];
  return deepFreeze({
    schema: kernel.ORGANIZATION_COMPILE_REQUEST_SCHEMA,
    requestId: String(options.requestId || 'request:w82c-local-research:001'),
    workflowRef: { workflowId: workflow.workflowId, version: workflow.version },
    goal: { goalId: 'goal:w82c-local-report', statement: 'Produce a traceable local evidence report without publication.', deliverableType: workflow.deliverableType },
    constraints: [
      { constraintId: 'constraint:citations', type: 'citation-policy', valueRef: 'all-claims-addressable', sourceRef: 'W82c:authority' },
      { constraintId: 'constraint:scope', type: 'research-scope', valueRef: 'local-specimen:no-publication', sourceRef: 'W82c:authority' },
    ],
    assets: [
      { assetId: 'asset:question', type: 'research-question', version: String(options.questionVersion || 'fixture:1'), sourceRef: 'workspace:research-question' },
      { assetId: 'asset:corpus', type: 'source-corpus', version: String(options.sourceCorpusVersion || 'fixture:1'), sourceRef: 'workspace:source-corpus' },
    ],
    method: { methodId: 'method:w82c-evidence-research', version: '1.0.0', sourceRef: 'docs/engineering/W82C_RESEARCH_EVIDENCE_SLICE_SPEC.md' },
    budget: { profileId: 'budget:w82c-local', currency: 'CNY', limit: 1000, status: 'known' },
    capabilitySnapshot: { snapshotId: 'snapshot:w82c-local:v1', executors: executorRows },
    routingLocks: Object.entries(routes).map(([seatId, executorRef]) => ({
      seatId, executorRef,
      authorityRef: ['seat:literature-researcher', 'seat:method-lead'].includes(seatId) ? 'authority:method-owner'
        : ['seat:analyst', 'seat:data-steward', 'seat:statistician'].includes(seatId) ? 'authority:analysis-review'
          : seatId === 'seat:replicator' ? 'authority:replication-owner' : 'authority:research-lead',
      reason: 'Pinned accountable executor for the local W82c specimen.',
    })),
    authorityBindings: Object.entries(authorities).map(([authorityRef, actorRef]) => ({ authorityRef, actorRef, actorKind: 'human' })),
    provenance: { source: 'W82c local fixture', requestedBy: 'human:maintainer', publicationAuthorized: false },
  });
}

module.exports = {
  RESEARCH_RECEIPT_SCHEMA,
  RESEARCH_DECISION_SCHEMA,
  RESEARCH_RESULT_SCHEMA,
  createResearchWorkflowPackage,
  createResearchCompileRequest,
  normalizeResearchReceipt: runtime.normalizeReceipt,
  normalizeResearchDecision: runtime.normalizeDecision,
  evaluateResearchSlice: runtime.evaluate,
  toW73ResearchEvents: runtime.toW73Events,
};
