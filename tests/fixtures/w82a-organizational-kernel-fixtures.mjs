const WORKFLOW_SCHEMA = 'mazz.workflow-package/v0';
const REQUEST_SCHEMA = 'mazz.organization-compile-request/v0';
const EXPERT_SCHEMA = 'mazz.expert-capability-asset/v0';

function clone(value) {
  return structuredClone(value);
}

function delegation(liabilityOwner, requiredResultArtifactIds, qualificationRefs = []) {
  return {
    allowed: false,
    maxDepth: 0,
    subcontractAllowed: false,
    liabilityOwner,
    requiredResultArtifactIds,
    qualificationRefs,
    authorityRefs: [],
  };
}

function capability(capabilityId, identity, domain, inputTypes, outputTypes, styleIdentity) {
  return {
    schema: EXPERT_SCHEMA,
    capabilityId,
    version: '1.0.0',
    identity,
    domain,
    inputTypes,
    outputTypes,
    evidenceTypes: ['decision-log', 'review-record'],
    attention: ['boundary conditions', 'counter-evidence'],
    decisions: ['accept', 'revise', 'escalate'],
    negativeKnowledge: ['do not infer missing evidence', 'do not self-authorize'],
    gateRefs: [],
    exceptionPolicy: 'Stop and expose UNKNOWN or BLOCKED when required evidence is absent.',
    authorityBoundary: 'Advisory capability only; it cannot approve its own work or expand authority.',
    permissionScope: ['read:declared-inputs', 'write:declared-outputs'],
    styleIdentity,
    provenance: { source: 'W82a paper fixture', verifiedBy: 'contract-test' },
  };
}

const software = {
  schema: WORKFLOW_SCHEMA,
  workflowId: 'workflow:software-release:v1',
  version: '1.0.0',
  name: 'Evidence-backed Software Release',
  domain: 'software-release',
  deliverableType: 'software.release-specimen',
  inputContract: {
    requiredInputKinds: ['goal', 'constraints', 'assets', 'method', 'budget'],
    constraintTypes: ['release-policy', 'platform'],
    assetTypes: ['source-repository', 'release-requirement'],
    methodRefs: ['method:software-release'],
    budgetProfiles: [{ profileId: 'budget:software-small', currency: 'CNY', maxAmount: 1000, status: 'known' }],
  },
  teams: [{
    teamId: 'team:release',
    label: 'Release Team',
    responsibility: 'Produce, independently verify, and authorize one release specimen.',
    seatIds: ['seat:developer', 'seat:release-owner', 'seat:verifier'],
  }],
  seats: [
    {
      seatId: 'seat:developer', teamId: 'team:release', label: 'Developer',
      responsibility: 'Produce the change without holding release authority.',
      inputArtifactIds: ['artifact:requirement'], outputArtifactIds: ['artifact:change'],
      gateIds: ['gate:change-review'], authorityRefs: [],
      requiredCapabilityIds: ['capability:software-change'], eligibleExecutorKinds: ['human'],
      childSeatOf: '', qualificationRefs: ['qualification:developer'],
      delegation: delegation('seat:developer', ['artifact:change'], ['qualification:developer']),
    },
    {
      seatId: 'seat:verifier', teamId: 'team:release', label: 'Independent Verifier',
      responsibility: 'Verify the change and produce evidence independently of its author.',
      inputArtifactIds: ['artifact:change'], outputArtifactIds: ['artifact:test-report'],
      gateIds: ['gate:change-review', 'gate:release'], authorityRefs: [],
      requiredCapabilityIds: ['capability:release-verification'], eligibleExecutorKinds: ['script'],
      childSeatOf: '', qualificationRefs: ['qualification:test-harness'],
      delegation: delegation('seat:verifier', ['artifact:test-report'], ['qualification:test-harness']),
    },
    {
      seatId: 'seat:release-owner', teamId: 'team:release', label: 'Release Owner',
      responsibility: 'Assemble the specimen and make the non-delegable final release decision.',
      inputArtifactIds: ['artifact:test-report'], outputArtifactIds: ['artifact:release-specimen'],
      gateIds: ['gate:release'], authorityRefs: ['authority:release-owner'],
      requiredCapabilityIds: ['capability:release-assembly'], eligibleExecutorKinds: ['human'],
      childSeatOf: '', qualificationRefs: ['qualification:release-owner'],
      delegation: delegation('seat:release-owner', ['artifact:release-specimen'], ['qualification:release-owner']),
    },
  ],
  artifacts: [
    {
      artifactId: 'artifact:requirement', label: 'Release Requirement', type: 'requirement', version: '1',
      producedBySeatId: '', consumedBySeatIds: ['seat:developer'], dependsOn: [], invalidates: [],
      truthOwner: 'workspace:release-input', evidenceRequirements: ['source-ref'], licensePolicy: 'Project policy', required: true,
    },
    {
      artifactId: 'artifact:change', label: 'Change Set', type: 'source-change', version: '1',
      producedBySeatId: 'seat:developer', consumedBySeatIds: ['seat:verifier'], dependsOn: ['artifact:requirement'],
      invalidates: ['artifact:test-report'], truthOwner: 'workspace:repository',
      evidenceRequirements: ['diff', 'build-log'], licensePolicy: 'Project policy', required: true,
    },
    {
      artifactId: 'artifact:test-report', label: 'Test Report', type: 'verification-report', version: '1',
      producedBySeatId: 'seat:verifier', consumedBySeatIds: ['seat:release-owner'], dependsOn: ['artifact:change'],
      invalidates: ['artifact:release-specimen'], truthOwner: 'W73:production-record',
      evidenceRequirements: ['test-log'], licensePolicy: 'Project policy', required: true,
    },
    {
      artifactId: 'artifact:release-specimen', label: 'Release Specimen', type: 'software.release-specimen', version: '1',
      producedBySeatId: 'seat:release-owner', consumedBySeatIds: [], dependsOn: ['artifact:test-report'], invalidates: [],
      truthOwner: 'W73:production-record', evidenceRequirements: ['artifact-hash', 'package-audit'], licensePolicy: 'Project policy', required: true,
    },
  ],
  gates: [
    {
      gateId: 'gate:change-review', label: 'Change Review', artifactIds: ['artifact:change'],
      verificationRefs: ['check:build'], reviewRefs: ['review:independent'], evaluationRefs: ['evaluation:risk'],
      authorityRef: 'authority:release-owner', passState: 'CHANGE_ACCEPTED', failState: 'CHANGE_REWORK',
      recoveryPointId: 'recovery:change', destructive: false, requiresHumanAuthority: true,
    },
    {
      gateId: 'gate:release', label: 'Release Approval', artifactIds: ['artifact:test-report', 'artifact:release-specimen'],
      verificationRefs: ['check:package'], reviewRefs: ['review:release'], evaluationRefs: ['evaluation:release-risk'],
      authorityRef: 'authority:release-owner', passState: 'RELEASE_APPROVED', failState: 'RELEASE_BLOCKED',
      recoveryPointId: 'recovery:release', destructive: true, requiresHumanAuthority: true,
    },
  ],
  authorities: [{
    authorityRef: 'authority:release-owner', kind: 'human', scope: 'routing, review, release, and recovery decisions',
    decisionTypes: ['recovery', 'release', 'review', 'routing'], cannotDelegate: true,
    prohibitedSeatIds: ['seat:developer'],
  }],
  recoveryPoints: [
    {
      recoveryPointId: 'recovery:change', label: 'Return to Change', resumeSeatIds: ['seat:developer'],
      affectedArtifactIds: ['artifact:change', 'artifact:test-report', 'artifact:release-specimen'],
      evidenceRequirements: ['failure-record'], authorityRef: 'authority:release-owner',
    },
    {
      recoveryPointId: 'recovery:release', label: 'Return to Verification', resumeSeatIds: ['seat:verifier'],
      affectedArtifactIds: ['artifact:test-report', 'artifact:release-specimen'],
      evidenceRequirements: ['release-blocker'], authorityRef: 'authority:release-owner',
    },
  ],
  routingPolicies: [{
    policyId: 'routing:release', seatIds: ['seat:developer', 'seat:release-owner', 'seat:verifier'],
    mode: 'human-lock', requiresHumanDecision: true, evidenceRequirements: ['capability-snapshot', 'routing-reason'],
  }],
  delegationPolicy: {
    maxDepth: 1, allowSubcontract: false, requireExplicitSubcontract: true, preventCycles: true,
    authorityDelegable: false, qualificationDelegable: false, parentLiabilityRetained: true,
    costAccounting: 'full-chain', provenanceRequired: true, taskContractRequired: true,
  },
  archaeology: [
    {
      sourceRole: 'developer', decision: 'preserve', targetSeatIds: ['seat:developer'], reasonClass: 'responsibility',
      rationale: 'Change authorship remains an explicit accountable responsibility.', evidenceRefs: ['evidence:release-practice'],
    },
    {
      sourceRole: 'tester', decision: 'preserve', targetSeatIds: ['seat:verifier'], reasonClass: 'independent-review',
      rationale: 'Independent verification is retained instead of being collapsed into authorship.', evidenceRefs: ['evidence:release-practice'],
    },
    {
      sourceRole: 'release-manager', decision: 'preserve', targetSeatIds: ['seat:release-owner'], reasonClass: 'authority-separation',
      rationale: 'Final release authority remains separate from the developer.', evidenceRefs: ['evidence:release-policy'],
    },
    {
      sourceRole: 'manual-copy-clerk', decision: 'remove', targetSeatIds: [], reasonClass: 'legacy-friction',
      rationale: 'Repetitive file copying is a historical transport friction, not professional judgment.', evidenceRefs: ['evidence:artifact-pipeline'],
    },
  ],
  expertCapabilities: [
    capability('expert:change-author', 'Software Change Author', 'software', ['requirement'], ['source-change'], 'precise-minimal-diff'),
    capability('expert:release-reviewer', 'Independent Release Reviewer', 'software-quality', ['source-change'], ['verification-report'], 'adversarial-evidence-first'),
  ],
  provenance: { source: 'W82a software paper fixture', revision: '1' },
};

const softwareRequestData = {
  schema: REQUEST_SCHEMA,
  requestId: 'request:software-release:001',
  workflowRef: { workflowId: software.workflowId, version: software.version },
  goal: { goalId: 'goal:release', statement: 'Produce a verified Windows release specimen.', deliverableType: software.deliverableType },
  constraints: [
    { constraintId: 'constraint:platform', type: 'platform', valueRef: 'windows-x64', sourceRef: 'maintainer:brief' },
    { constraintId: 'constraint:policy', type: 'release-policy', valueRef: 'human-final-required', sourceRef: 'policy:release' },
  ],
  assets: [
    { assetId: 'asset:repo', type: 'source-repository', version: 'abc123', sourceRef: 'workspace:repo' },
    { assetId: 'asset:requirement', type: 'release-requirement', version: '1', sourceRef: 'workspace:requirement' },
  ],
  method: { methodId: 'method:software-release', version: '1', sourceRef: 'method-library:software-release' },
  budget: { profileId: 'budget:software-small', currency: 'CNY', limit: 500, status: 'known' },
  capabilitySnapshot: {
    snapshotId: 'snapshot:software:001',
    executors: [
      {
        executorRef: 'human:developer-a', kind: 'human', capabilityIds: ['capability:software-change'],
        qualificationRefs: ['qualification:developer'], harnessRef: '', toolAdapterRef: '', providerRef: '',
        status: 'available', version: 'personnel-roster:1', estimatedCost: { status: 'known', currency: 'CNY', amount: 100 },
      },
      {
        executorRef: 'script:test-runner', kind: 'script', capabilityIds: ['capability:release-verification'],
        qualificationRefs: ['qualification:test-harness'], harnessRef: '', toolAdapterRef: '', providerRef: '',
        status: 'available', version: 'test-runner:1', estimatedCost: { status: 'known', currency: 'CNY', amount: 20 },
      },
      {
        executorRef: 'human:release-owner', kind: 'human', capabilityIds: ['capability:release-assembly'],
        qualificationRefs: ['qualification:release-owner'], harnessRef: '', toolAdapterRef: '', providerRef: '',
        status: 'available', version: 'personnel-roster:1', estimatedCost: { status: 'known', currency: 'CNY', amount: 80 },
      },
    ],
  },
  routingLocks: [
    { seatId: 'seat:developer', executorRef: 'human:developer-a', authorityRef: 'authority:release-owner', reason: 'Qualified author selected by release owner.' },
    { seatId: 'seat:verifier', executorRef: 'script:test-runner', authorityRef: 'authority:release-owner', reason: 'Pinned deterministic verification harness.' },
    { seatId: 'seat:release-owner', executorRef: 'human:release-owner', authorityRef: 'authority:release-owner', reason: 'Named non-delegable release authority.' },
  ],
  authorityBindings: [{ authorityRef: 'authority:release-owner', actorRef: 'human:release-owner', actorKind: 'human' }],
  provenance: { source: 'W82a contract fixture', requestedBy: 'human:maintainer' },
};

const research = {
  ...clone(software),
  workflowId: 'workflow:evidence-research:v1',
  name: 'Reproducible Evidence Research',
  domain: 'research',
  deliverableType: 'research.report',
  inputContract: {
    requiredInputKinds: ['goal', 'constraints', 'assets', 'method', 'budget'],
    constraintTypes: ['citation-policy', 'scope'],
    assetTypes: ['research-question', 'source-corpus'],
    methodRefs: ['method:evidence-research'],
    budgetProfiles: [{ profileId: 'budget:research-small', currency: 'CNY', maxAmount: 1200, status: 'known' }],
  },
  teams: [{
    teamId: 'team:research', label: 'Research Team',
    responsibility: 'Collect evidence, analyze it, independently replicate conclusions, and authorize the report.',
    seatIds: ['seat:analyst', 'seat:replicator', 'seat:research-lead'],
  }],
  seats: [
    {
      seatId: 'seat:analyst', teamId: 'team:research', label: 'Evidence Analyst',
      responsibility: 'Derive a traceable analysis from the declared corpus.',
      inputArtifactIds: ['artifact:question', 'artifact:corpus'], outputArtifactIds: ['artifact:analysis'],
      gateIds: ['gate:analysis'], authorityRefs: [], requiredCapabilityIds: ['capability:evidence-analysis'],
      eligibleExecutorKinds: ['agent'], childSeatOf: '', qualificationRefs: ['qualification:research-method'],
      delegation: delegation('seat:analyst', ['artifact:analysis'], ['qualification:research-method']),
    },
    {
      seatId: 'seat:replicator', teamId: 'team:research', label: 'Independent Replicator',
      responsibility: 'Attempt to reproduce and falsify the analysis independently.',
      inputArtifactIds: ['artifact:analysis', 'artifact:corpus'], outputArtifactIds: ['artifact:replication'],
      gateIds: ['gate:analysis', 'gate:report'], authorityRefs: [], requiredCapabilityIds: ['capability:replication'],
      eligibleExecutorKinds: ['script'], childSeatOf: '', qualificationRefs: ['qualification:reproducibility'],
      delegation: delegation('seat:replicator', ['artifact:replication'], ['qualification:reproducibility']),
    },
    {
      seatId: 'seat:research-lead', teamId: 'team:research', label: 'Research Lead',
      responsibility: 'Synthesize the evidence and hold the final, non-delegable publication decision.',
      inputArtifactIds: ['artifact:analysis', 'artifact:replication'], outputArtifactIds: ['artifact:report'],
      gateIds: ['gate:report'], authorityRefs: ['authority:research-lead'], requiredCapabilityIds: ['capability:research-synthesis'],
      eligibleExecutorKinds: ['human'], childSeatOf: '', qualificationRefs: ['qualification:research-lead'],
      delegation: delegation('seat:research-lead', ['artifact:report'], ['qualification:research-lead']),
    },
  ],
  artifacts: [
    {
      artifactId: 'artifact:question', label: 'Research Question', type: 'research-question', version: '1',
      producedBySeatId: '', consumedBySeatIds: ['seat:analyst'], dependsOn: [], invalidates: [],
      truthOwner: 'workspace:research-input', evidenceRequirements: ['question-source'], licensePolicy: 'Declared source policy', required: true,
    },
    {
      artifactId: 'artifact:corpus', label: 'Source Corpus', type: 'source-corpus', version: '1',
      producedBySeatId: '', consumedBySeatIds: ['seat:analyst', 'seat:replicator'], dependsOn: [], invalidates: [],
      truthOwner: 'workspace:research-corpus', evidenceRequirements: ['source-manifest'], licensePolicy: 'Citation and source licenses preserved', required: true,
    },
    {
      artifactId: 'artifact:analysis', label: 'Traceable Analysis', type: 'analysis', version: '1',
      producedBySeatId: 'seat:analyst', consumedBySeatIds: ['seat:replicator', 'seat:research-lead'],
      dependsOn: ['artifact:question', 'artifact:corpus'], invalidates: ['artifact:replication'],
      truthOwner: 'W73:production-record', evidenceRequirements: ['claim-evidence-links'], licensePolicy: 'Derived work with source attribution', required: true,
    },
    {
      artifactId: 'artifact:replication', label: 'Replication Record', type: 'replication-record', version: '1',
      producedBySeatId: 'seat:replicator', consumedBySeatIds: ['seat:research-lead'], dependsOn: ['artifact:analysis'],
      invalidates: ['artifact:report'], truthOwner: 'W73:production-record',
      evidenceRequirements: ['replication-log'], licensePolicy: 'Derived work with source attribution', required: true,
    },
    {
      artifactId: 'artifact:report', label: 'Research Report', type: 'research.report', version: '1',
      producedBySeatId: 'seat:research-lead', consumedBySeatIds: [], dependsOn: ['artifact:analysis', 'artifact:replication'], invalidates: [],
      truthOwner: 'W73:production-record', evidenceRequirements: ['citation-audit', 'authority-decision'], licensePolicy: 'Publication policy', required: true,
    },
  ],
  gates: [
    {
      gateId: 'gate:analysis', label: 'Analysis Acceptance', artifactIds: ['artifact:analysis'],
      verificationRefs: ['check:traceability'], reviewRefs: ['review:method'], evaluationRefs: ['evaluation:evidence-quality'],
      authorityRef: 'authority:research-lead', passState: 'ANALYSIS_ACCEPTED', failState: 'ANALYSIS_REWORK',
      recoveryPointId: 'recovery:analysis', destructive: false, requiresHumanAuthority: true,
    },
    {
      gateId: 'gate:report', label: 'Report Approval', artifactIds: ['artifact:replication', 'artifact:report'],
      verificationRefs: ['check:citations'], reviewRefs: ['review:replication'], evaluationRefs: ['evaluation:claim-strength'],
      authorityRef: 'authority:research-lead', passState: 'REPORT_APPROVED', failState: 'REPORT_BLOCKED',
      recoveryPointId: 'recovery:report', destructive: true, requiresHumanAuthority: true,
    },
  ],
  authorities: [{
    authorityRef: 'authority:research-lead', kind: 'human', scope: 'routing, method, publication, and recovery decisions',
    decisionTypes: ['publication', 'recovery', 'review', 'routing'], cannotDelegate: true,
    prohibitedSeatIds: ['seat:analyst'],
  }],
  recoveryPoints: [
    {
      recoveryPointId: 'recovery:analysis', label: 'Return to Analysis', resumeSeatIds: ['seat:analyst'],
      affectedArtifactIds: ['artifact:analysis', 'artifact:replication', 'artifact:report'], evidenceRequirements: ['method-gap'],
      authorityRef: 'authority:research-lead',
    },
    {
      recoveryPointId: 'recovery:report', label: 'Return to Replication', resumeSeatIds: ['seat:replicator'],
      affectedArtifactIds: ['artifact:replication', 'artifact:report'], evidenceRequirements: ['report-blocker'],
      authorityRef: 'authority:research-lead',
    },
  ],
  routingPolicies: [{
    policyId: 'routing:research', seatIds: ['seat:analyst', 'seat:replicator', 'seat:research-lead'],
    mode: 'human-lock', requiresHumanDecision: true, evidenceRequirements: ['capability-snapshot', 'conflict-check'],
  }],
  archaeology: [
    {
      sourceRole: 'researcher', decision: 'preserve', targetSeatIds: ['seat:analyst'], reasonClass: 'professional-judgment',
      rationale: 'Evidence interpretation remains an explicit professional responsibility.', evidenceRefs: ['evidence:research-method'],
    },
    {
      sourceRole: 'replication-reviewer', decision: 'preserve', targetSeatIds: ['seat:replicator'], reasonClass: 'independent-review',
      rationale: 'Replication must remain independent from the original analysis.', evidenceRefs: ['evidence:reproducibility'],
    },
    {
      sourceRole: 'principal-investigator', decision: 'preserve', targetSeatIds: ['seat:research-lead'], reasonClass: 'authority-separation',
      rationale: 'Publication authority remains separate from primary analysis.', evidenceRefs: ['evidence:publication-policy'],
    },
    {
      sourceRole: 'citation-copy-clerk', decision: 'remove', targetSeatIds: [], reasonClass: 'legacy-friction',
      rationale: 'Mechanical citation copying is transport friction, not expert judgment.', evidenceRefs: ['evidence:citation-tooling'],
    },
  ],
  expertCapabilities: [
    capability('expert:evidence-analyst', 'Evidence Analyst', 'research', ['source-corpus'], ['analysis'], 'traceable-cautious'),
    capability('expert:replication-reviewer', 'Replication Reviewer', 'research-quality', ['analysis'], ['replication-record'], 'skeptical-reproducibility-first'),
  ],
  provenance: { source: 'W82a research paper fixture', revision: '1' },
};

const researchRequestData = {
  schema: REQUEST_SCHEMA,
  requestId: 'request:evidence-research:001',
  workflowRef: { workflowId: research.workflowId, version: research.version },
  goal: { goalId: 'goal:research', statement: 'Produce a reproducible evidence report.', deliverableType: research.deliverableType },
  constraints: [
    { constraintId: 'constraint:citation', type: 'citation-policy', valueRef: 'claim-level-citations', sourceRef: 'policy:research' },
    { constraintId: 'constraint:scope', type: 'scope', valueRef: 'declared-corpus-only', sourceRef: 'maintainer:brief' },
  ],
  assets: [
    { assetId: 'asset:question', type: 'research-question', version: '1', sourceRef: 'workspace:question' },
    { assetId: 'asset:corpus', type: 'source-corpus', version: 'manifest-1', sourceRef: 'workspace:corpus' },
  ],
  method: { methodId: 'method:evidence-research', version: '1', sourceRef: 'method-library:evidence-research' },
  budget: { profileId: 'budget:research-small', currency: 'CNY', limit: 600, status: 'known' },
  capabilitySnapshot: {
    snapshotId: 'snapshot:research:001',
    executors: [
      {
        executorRef: 'agent:evidence-analyst', kind: 'agent', capabilityIds: ['capability:evidence-analysis'],
        qualificationRefs: ['qualification:research-method'], harnessRef: 'W66:harness:codex', toolAdapterRef: '', providerRef: '',
        status: 'available', version: 'agent-roster:1', estimatedCost: { status: 'known', currency: 'CNY', amount: 200 },
      },
      {
        executorRef: 'script:replication', kind: 'script', capabilityIds: ['capability:replication'],
        qualificationRefs: ['qualification:reproducibility'], harnessRef: '', toolAdapterRef: '', providerRef: '',
        status: 'available', version: 'replication-script:1', estimatedCost: { status: 'known', currency: 'CNY', amount: 40 },
      },
      {
        executorRef: 'human:research-lead', kind: 'human', capabilityIds: ['capability:research-synthesis'],
        qualificationRefs: ['qualification:research-lead'], harnessRef: '', toolAdapterRef: '', providerRef: '',
        status: 'available', version: 'personnel-roster:1', estimatedCost: { status: 'known', currency: 'CNY', amount: 120 },
      },
    ],
  },
  routingLocks: [
    { seatId: 'seat:analyst', executorRef: 'agent:evidence-analyst', authorityRef: 'authority:research-lead', reason: 'Qualified analyst explicitly selected.' },
    { seatId: 'seat:replicator', executorRef: 'script:replication', authorityRef: 'authority:research-lead', reason: 'Pinned reproducible replication procedure.' },
    { seatId: 'seat:research-lead', executorRef: 'human:research-lead', authorityRef: 'authority:research-lead', reason: 'Named human publication authority.' },
  ],
  authorityBindings: [{ authorityRef: 'authority:research-lead', actorRef: 'human:research-lead', actorKind: 'human' }],
  provenance: { source: 'W82a contract fixture', requestedBy: 'human:maintainer' },
};

export function softwarePackage() { return clone(software); }
export function softwareRequest() { return clone(softwareRequestData); }
export function researchPackage() { return clone(research); }
export function researchRequest() { return clone(researchRequestData); }
