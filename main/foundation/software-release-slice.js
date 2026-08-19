'use strict';

const crypto = require('crypto');
const {
  assertKnownKeys,
  clonePlain,
  deepFreeze,
  isPlainObject,
  requiredString,
  stringList,
} = require('./plain-value');
const kernel = require('./organizational-kernel');

const SOFTWARE_RELEASE_RECEIPT_SCHEMA = 'mazz.software-release-tool-receipt/v0';
const SOFTWARE_RELEASE_DECISION_SCHEMA = 'mazz.software-release-authority-decision/v0';
const SOFTWARE_RELEASE_RESULT_SCHEMA = 'mazz.software-release-slice-result/v0';

const RECEIPT_STAGES = Object.freeze(['build', 'package', 'security', 'test']);
const RECEIPT_STATES = Object.freeze(['failed', 'passed', 'unknown']);
const DECISION_GATES = Object.freeze([
  'gate:build-review',
  'gate:test-security',
  'gate:release',
]);
const RECEIPT_FIELDS = Object.freeze([
  'schema', 'receiptId', 'stage', 'operationRef', 'toolRef', 'toolVersion', 'status',
  'exitCode', 'startedAt', 'endedAt', 'inputDigest', 'outputDigest', 'evidenceRefs',
  'nonProduction', 'pushed', 'published', 'externalMutation', 'message',
]);
const DECISION_FIELDS = Object.freeze([
  'schema', 'decisionId', 'gateId', 'authorityRef', 'actorRef', 'decision', 'scope',
  'evidenceRefs', 'reason',
]);
const EVALUATION_FIELDS = Object.freeze([
  'workflowPackage', 'compileRequest', 'artifactVersions', 'receipts', 'decisions',
  'provenance',
]);
const SECRET_KEYS = new Set([
  'apikey', 'authorization', 'secret', 'password', 'accesstoken', 'refreshtoken',
  'credential', 'cookie', 'privatekey', 'sessiontoken',
]);

function rejectSecrets(value, trail = '') {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectSecrets(item, `${trail}[${index}]`));
  if (!isPlainObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const canonical = key.toLowerCase().replace(/[^a-z]/g, '');
    if (SECRET_KEYS.has(canonical)) throw new Error(`W82b Software Release 禁止 secret 字段: ${trail ? `${trail}.` : ''}${key}`);
    rejectSecrets(item, trail ? `${trail}.${key}` : key);
  }
}

function object(value, label, fields) {
  if (!isPlainObject(value)) throw new Error(`${label} 必须是对象`);
  assertKnownKeys(value, fields, label);
  return value;
}

function required(value, label, max = 800) {
  const normalized = requiredString(value, label);
  if (normalized.length > max) throw new Error(`${label} 超过 ${max} 字符`);
  return normalized;
}

function strings(value, label, allowEmpty = false) {
  const rows = stringList(value, label).sort((a, b) => a.localeCompare(b));
  if (!allowEmpty && !rows.length) throw new Error(`${label} 不得为空`);
  return rows;
}

function enumValue(value, allowed, label) {
  const normalized = required(value, label, 120);
  if (!allowed.includes(normalized)) throw new Error(`${label} 不支持: ${normalized}`);
  return normalized;
}

function iso(value, label) {
  const normalized = required(value, label, 80);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(normalized)
    || Number.isNaN(Date.parse(normalized))) throw new Error(`${label} 必须是 UTC ISO 时间`);
  return normalized;
}

function sha(value, label) {
  const normalized = required(value, label, 80).toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} 必须是 sha256 摘要`);
  return normalized;
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(kernel.stableStringify(value), 'utf8').digest('hex')}`;
}

function delegation(seatId, artifactId, qualificationRef) {
  return {
    allowed: false,
    maxDepth: 0,
    subcontractAllowed: false,
    liabilityOwner: seatId,
    requiredResultArtifactIds: [artifactId],
    qualificationRefs: [qualificationRef],
    authorityRefs: [],
  };
}

function seat({ seatId, teamId, label, responsibility, inputs, output, gateIds, authorityRefs = [], capability, kind, qualification }) {
  return {
    seatId,
    teamId,
    label,
    responsibility,
    inputArtifactIds: inputs,
    outputArtifactIds: [output],
    gateIds,
    authorityRefs,
    requiredCapabilityIds: [capability],
    eligibleExecutorKinds: [kind],
    childSeatOf: '',
    qualificationRefs: [qualification],
    delegation: delegation(seatId, output, qualification),
  };
}

function artifact({ artifactId, label, type, producer = '', consumers = [], dependsOn = [], invalidates = [], truthOwner = 'W73:production-record', evidenceRequirements }) {
  return {
    artifactId,
    label,
    type,
    version: '1',
    producedBySeatId: producer,
    consumedBySeatIds: consumers,
    dependsOn,
    invalidates,
    truthOwner,
    evidenceRequirements,
    licensePolicy: 'Repository policy; no production publication in W82b.',
    required: true,
  };
}

function recovery(recoveryPointId, label, resumeSeatIds, affectedArtifactIds, authorityRef) {
  return {
    recoveryPointId,
    label,
    resumeSeatIds,
    affectedArtifactIds,
    evidenceRequirements: ['failure-receipt', 'repair-decision'],
    authorityRef,
  };
}

function archaeology(sourceRole, targetSeatIds, reasonClass, rationale) {
  return {
    sourceRole,
    decision: 'preserve',
    targetSeatIds,
    reasonClass,
    rationale,
    evidenceRefs: ['evidence:software-release-practice'],
  };
}

function expert(capabilityId, identity, inputTypes, outputTypes, styleIdentity) {
  return {
    schema: kernel.EXPERT_CAPABILITY_SCHEMA,
    capabilityId,
    version: '1.0.0',
    identity,
    domain: 'software-release',
    inputTypes,
    outputTypes,
    evidenceTypes: ['decision-record', 'tool-receipt'],
    attention: ['authority separation', 'failure evidence', 'release boundary'],
    decisions: ['accept', 'block', 'recover'],
    negativeKnowledge: ['never self-approve authored work', 'never infer missing evidence', 'never publish from W82b'],
    gateRefs: [],
    exceptionPolicy: 'Missing or contradictory evidence remains UNKNOWN or BLOCKED and enters an explicit recovery point.',
    authorityBoundary: 'Advisory capability only; it cannot approve production release or expand filesystem/network authority.',
    permissionScope: ['read:declared-evidence', 'write:declared-report'],
    styleIdentity,
    provenance: { source: 'W82b software release slice', verifiedBy: 'contract-test' },
  };
}

function createSoftwareReleaseWorkflowPackage() {
  const workflow = {
    schema: kernel.WORKFLOW_PACKAGE_SCHEMA,
    workflowId: 'workflow:mazz-local-software-release:v1',
    version: '1.0.0',
    name: 'Mazz Local Non-production Software Release Specimen',
    domain: 'software-release',
    deliverableType: 'software.local-release-specimen',
    inputContract: {
      requiredInputKinds: ['goal', 'constraints', 'assets', 'method', 'budget'],
      constraintTypes: ['platform', 'release-boundary'],
      assetTypes: ['release-requirement', 'source-repository'],
      methodRefs: ['method:w82b-local-release'],
      budgetProfiles: [{ profileId: 'budget:w82b-local', currency: 'CNY', maxAmount: 1000, status: 'known' }],
    },
    teams: [
      {
        teamId: 'team:delivery',
        label: 'Delivery Team',
        responsibility: 'Translate the requirement into a bounded change and deterministic build evidence.',
        seatIds: ['seat:builder', 'seat:developer'],
      },
      {
        teamId: 'team:assurance',
        label: 'Independent Assurance Team',
        responsibility: 'Review authorship, execute tests, and sign security findings independently.',
        seatIds: ['seat:reviewer', 'seat:security-reviewer', 'seat:tester'],
      },
      {
        teamId: 'team:release',
        label: 'Release Authority',
        responsibility: 'Assemble and authorize only a local non-production release specimen.',
        seatIds: ['seat:release-owner'],
      },
    ],
    seats: [
      seat({
        seatId: 'seat:developer', teamId: 'team:delivery', label: 'Change Author',
        responsibility: 'Produce the bounded source change without review or release authority.',
        inputs: ['artifact:requirement'], output: 'artifact:change-set', gateIds: ['gate:build-review'],
        capability: 'capability:source-change', kind: 'human', qualification: 'qualification:developer',
      }),
      seat({
        seatId: 'seat:builder', teamId: 'team:delivery', label: 'Deterministic Builder',
        responsibility: 'Build the declared repository revision and emit a typed receipt.',
        inputs: ['artifact:change-set'], output: 'artifact:build-report', gateIds: ['gate:build-review'],
        capability: 'capability:repository-build', kind: 'script', qualification: 'qualification:build-tool',
      }),
      seat({
        seatId: 'seat:reviewer', teamId: 'team:assurance', label: 'Independent Code Reviewer',
        responsibility: 'Review scope and correctness independently of the change author.',
        inputs: ['artifact:change-set', 'artifact:build-report'], output: 'artifact:review-report', gateIds: ['gate:build-review'],
        authorityRefs: ['authority:change-review'], capability: 'capability:independent-review', kind: 'human', qualification: 'qualification:reviewer',
      }),
      seat({
        seatId: 'seat:tester', teamId: 'team:assurance', label: 'Deterministic Test Executor',
        responsibility: 'Run the declared scoped test set and emit a typed receipt.',
        inputs: ['artifact:review-report'], output: 'artifact:test-report', gateIds: ['gate:test-security'],
        capability: 'capability:scoped-tests', kind: 'script', qualification: 'qualification:test-tool',
      }),
      seat({
        seatId: 'seat:security-reviewer', teamId: 'team:assurance', label: 'Security Reviewer',
        responsibility: 'Review deterministic security and provenance evidence without authoring the change.',
        inputs: ['artifact:test-report'], output: 'artifact:security-report', gateIds: ['gate:test-security'],
        authorityRefs: ['authority:security-review'], capability: 'capability:security-review', kind: 'human', qualification: 'qualification:security-reviewer',
      }),
      seat({
        seatId: 'seat:release-owner', teamId: 'team:release', label: 'Local Specimen Release Owner',
        responsibility: 'Assemble and approve a local specimen; production push and publication remain prohibited.',
        inputs: ['artifact:security-report'], output: 'artifact:release-specimen', gateIds: ['gate:release'],
        authorityRefs: ['authority:release-owner'], capability: 'capability:release-assembly', kind: 'human', qualification: 'qualification:release-owner',
      }),
    ],
    artifacts: [
      artifact({
        artifactId: 'artifact:requirement', label: 'Release Requirement', type: 'release-requirement',
        consumers: ['seat:developer'], truthOwner: 'workspace:maintainer-brief', evidenceRequirements: ['maintainer-authority', 'scope-statement'],
      }),
      artifact({
        artifactId: 'artifact:change-set', label: 'Bounded Change Set', type: 'source-change', producer: 'seat:developer',
        consumers: ['seat:builder', 'seat:reviewer'], dependsOn: ['artifact:requirement'],
        invalidates: ['artifact:build-report', 'artifact:review-report'], evidenceRequirements: ['git-diff', 'scope-check'],
      }),
      artifact({
        artifactId: 'artifact:build-report', label: 'Build Receipt', type: 'tool-receipt', producer: 'seat:builder',
        consumers: ['seat:reviewer'], dependsOn: ['artifact:change-set'], invalidates: ['artifact:review-report'], evidenceRequirements: ['build-exit-code', 'build-output-digest'],
      }),
      artifact({
        artifactId: 'artifact:review-report', label: 'Independent Review Record', type: 'authority-decision', producer: 'seat:reviewer',
        consumers: ['seat:tester'], dependsOn: ['artifact:change-set', 'artifact:build-report'], invalidates: ['artifact:test-report'], evidenceRequirements: ['review-evidence', 'reviewer-identity'],
      }),
      artifact({
        artifactId: 'artifact:test-report', label: 'Scoped Test Receipt', type: 'tool-receipt', producer: 'seat:tester',
        consumers: ['seat:security-reviewer'], dependsOn: ['artifact:review-report'], invalidates: ['artifact:security-report'], evidenceRequirements: ['test-exit-code', 'test-output-digest'],
      }),
      artifact({
        artifactId: 'artifact:security-report', label: 'Security Review Record', type: 'authority-decision', producer: 'seat:security-reviewer',
        consumers: ['seat:release-owner'], dependsOn: ['artifact:test-report'], invalidates: ['artifact:release-specimen'], evidenceRequirements: ['security-receipt', 'security-authority'],
      }),
      artifact({
        artifactId: 'artifact:release-specimen', label: 'Local Release Specimen', type: 'software.local-release-specimen', producer: 'seat:release-owner',
        dependsOn: ['artifact:security-report'], evidenceRequirements: ['package-receipt', 'local-release-authority', 'non-production-boundary'],
      }),
    ],
    gates: [
      {
        gateId: 'gate:build-review', label: 'Build and Independent Review',
        artifactIds: ['artifact:build-report', 'artifact:review-report'],
        verificationRefs: ['check:build'], reviewRefs: ['review:independent'], evaluationRefs: ['evaluation:diff-scope'],
        authorityRef: 'authority:change-review', passState: 'CHANGE_REVIEWED', failState: 'CHANGE_RECOVERY_REQUIRED',
        recoveryPointId: 'recovery:change', destructive: false, requiresHumanAuthority: true,
      },
      {
        gateId: 'gate:test-security', label: 'Test and Security Review',
        artifactIds: ['artifact:test-report', 'artifact:security-report'],
        verificationRefs: ['check:test'], reviewRefs: ['review:security'], evaluationRefs: ['evaluation:security-risk'],
        authorityRef: 'authority:security-review', passState: 'ASSURANCE_PASSED', failState: 'ASSURANCE_RECOVERY_REQUIRED',
        recoveryPointId: 'recovery:assurance', destructive: false, requiresHumanAuthority: true,
      },
      {
        gateId: 'gate:release', label: 'Local Specimen Approval',
        artifactIds: ['artifact:security-report', 'artifact:release-specimen'],
        verificationRefs: ['check:package'], reviewRefs: ['review:release-evidence'], evaluationRefs: ['evaluation:release-risk'],
        authorityRef: 'authority:release-owner', passState: 'LOCAL_SPECIMEN_APPROVED', failState: 'RELEASE_RECOVERY_REQUIRED',
        recoveryPointId: 'recovery:release', destructive: true, requiresHumanAuthority: true,
      },
    ],
    authorities: [
      {
        authorityRef: 'authority:change-review', kind: 'human', scope: 'independent change review and recovery',
        decisionTypes: ['recovery', 'review', 'routing'], cannotDelegate: true,
        prohibitedSeatIds: ['seat:builder', 'seat:developer'],
      },
      {
        authorityRef: 'authority:security-review', kind: 'human', scope: 'security review and assurance recovery',
        decisionTypes: ['recovery', 'review', 'routing', 'security'], cannotDelegate: true,
        prohibitedSeatIds: ['seat:developer', 'seat:tester'],
      },
      {
        authorityRef: 'authority:release-owner', kind: 'human', scope: 'local specimen approval and release recovery only',
        decisionTypes: ['recovery', 'release', 'routing'], cannotDelegate: true,
        prohibitedSeatIds: ['seat:developer', 'seat:reviewer', 'seat:security-reviewer'],
      },
    ],
    recoveryPoints: [
      recovery('recovery:change', 'Return to Change Author', ['seat:developer'], ['artifact:change-set', 'artifact:build-report', 'artifact:review-report', 'artifact:test-report', 'artifact:security-report', 'artifact:release-specimen'], 'authority:change-review'),
      recovery('recovery:assurance', 'Return to Test or Security Review', ['seat:security-reviewer', 'seat:tester'], ['artifact:test-report', 'artifact:security-report', 'artifact:release-specimen'], 'authority:security-review'),
      recovery('recovery:release', 'Return to Release Assembly', ['seat:release-owner'], ['artifact:release-specimen'], 'authority:release-owner'),
    ],
    routingPolicies: [
      { policyId: 'routing:delivery', seatIds: ['seat:builder', 'seat:developer'], mode: 'human-lock', requiresHumanDecision: true, evidenceRequirements: ['capability-snapshot', 'maintainer-routing'] },
      { policyId: 'routing:assurance', seatIds: ['seat:reviewer', 'seat:security-reviewer', 'seat:tester'], mode: 'human-lock', requiresHumanDecision: true, evidenceRequirements: ['capability-snapshot', 'conflict-check'] },
      { policyId: 'routing:release', seatIds: ['seat:release-owner'], mode: 'human-lock', requiresHumanDecision: true, evidenceRequirements: ['capability-snapshot', 'release-owner-binding'] },
    ],
    delegationPolicy: {
      maxDepth: 0, allowSubcontract: false, requireExplicitSubcontract: true, preventCycles: true,
      authorityDelegable: false, qualificationDelegable: false, parentLiabilityRetained: true,
      costAccounting: 'full-chain', provenanceRequired: true, taskContractRequired: true,
    },
    archaeology: [
      archaeology('developer', ['seat:developer'], 'responsibility', 'Authorship remains explicit because source changes require accountable ownership.'),
      archaeology('build-engineer', ['seat:builder'], 'tool-boundary', 'Build remains a deterministic tool boundary rather than model inference.'),
      archaeology('code-reviewer', ['seat:reviewer'], 'independent-review', 'Independent review cannot collapse into the author seat.'),
      archaeology('test-engineer', ['seat:tester'], 'tool-boundary', 'Tests remain deterministic evidence with an explicit receipt.'),
      archaeology('security-reviewer', ['seat:security-reviewer'], 'independent-review', 'Security evidence requires an independent accountable reviewer.'),
      archaeology('release-manager', ['seat:release-owner'], 'authority-separation', 'Release authority remains separate from development and review.'),
      {
        sourceRole: 'manual-release-copy-clerk', decision: 'remove', targetSeatIds: [], reasonClass: 'legacy-friction',
        rationale: 'Manual file copying is transport friction and creates no independent judgment boundary.', evidenceRefs: ['evidence:artifact-pipeline'],
      },
    ],
    expertCapabilities: [
      expert('expert:release-review', 'Independent Software Release Reviewer', ['source-change', 'tool-receipt'], ['authority-decision'], 'adversarial-minimal-diff'),
      expert('expert:release-security', 'Software Release Security Reviewer', ['tool-receipt'], ['authority-decision'], 'fail-closed-evidence-first'),
    ],
    provenance: {
      source: 'W82b Software Release Organization Slice',
      boundary: 'local non-production specimen only',
      runtimeOwner: 'W73',
    },
  };
  return kernel.normalizeWorkflowPackage(workflow);
}

function executor(executorRef, kind, capabilityId, qualificationRef, version, amount) {
  return {
    executorRef,
    kind,
    capabilityIds: [capabilityId],
    qualificationRefs: [qualificationRef],
    harnessRef: '',
    toolAdapterRef: kind === 'script' ? `adapter:${capabilityId}` : '',
    providerRef: '',
    status: 'available',
    version,
    estimatedCost: { status: 'known', currency: 'CNY', amount },
  };
}

function createSoftwareReleaseCompileRequest(options = {}) {
  rejectSecrets(options);
  object(options, 'Software Release Compile Request options', [
    'requestId', 'repositoryVersion', 'developerRef', 'reviewerRef', 'securityReviewerRef',
    'releaseOwnerRef', 'sourceRef',
  ]);
  const workflow = createSoftwareReleaseWorkflowPackage();
  const developerRef = required(options.developerRef || 'human:developer', 'developerRef', 240);
  const reviewerRef = required(options.reviewerRef || 'human:independent-reviewer', 'reviewerRef', 240);
  const securityReviewerRef = required(options.securityReviewerRef || 'human:security-reviewer', 'securityReviewerRef', 240);
  const releaseOwnerRef = required(options.releaseOwnerRef || 'human:release-owner', 'releaseOwnerRef', 240);
  return deepFreeze({
    schema: kernel.ORGANIZATION_COMPILE_REQUEST_SCHEMA,
    requestId: required(options.requestId || 'request:w82b-local-release:001', 'requestId', 240),
    workflowRef: { workflowId: workflow.workflowId, version: workflow.version },
    goal: {
      goalId: 'goal:w82b-local-specimen',
      statement: 'Produce an evidence-backed local, non-production Mazz release specimen.',
      deliverableType: workflow.deliverableType,
    },
    constraints: [
      { constraintId: 'constraint:platform', type: 'platform', valueRef: 'windows-x64', sourceRef: 'workspace:package.json' },
      { constraintId: 'constraint:boundary', type: 'release-boundary', valueRef: 'local-only:no-push:no-publish', sourceRef: 'W82b:authority' },
    ],
    assets: [
      { assetId: 'asset:repository', type: 'source-repository', version: required(options.repositoryVersion || 'fixture:c5e9a8c', 'repositoryVersion', 160), sourceRef: required(options.sourceRef || 'workspace:mazz-editor', 'sourceRef', 500) },
      { assetId: 'asset:requirement', type: 'release-requirement', version: 'W82b-v1', sourceRef: 'docs/plans/W82_ORGANIZATIONAL_COMPILER.md#W82b' },
    ],
    method: { methodId: 'method:w82b-local-release', version: '1.0.0', sourceRef: 'docs/engineering/W82B_SOFTWARE_RELEASE_SLICE_SPEC.md' },
    budget: { profileId: 'budget:w82b-local', currency: 'CNY', limit: 500, status: 'known' },
    capabilitySnapshot: {
      snapshotId: 'snapshot:w82b-local-tools:v1',
      executors: [
        executor(developerRef, 'human', 'capability:source-change', 'qualification:developer', 'human-roster:1', 100),
        executor('script:mazz-builder', 'script', 'capability:repository-build', 'qualification:build-tool', 'npm-build:1', 10),
        executor(reviewerRef, 'human', 'capability:independent-review', 'qualification:reviewer', 'human-roster:1', 80),
        executor('script:mazz-tests', 'script', 'capability:scoped-tests', 'qualification:test-tool', 'node-test:1', 10),
        executor(securityReviewerRef, 'human', 'capability:security-review', 'qualification:security-reviewer', 'human-roster:1', 80),
        executor(releaseOwnerRef, 'human', 'capability:release-assembly', 'qualification:release-owner', 'human-roster:1', 80),
      ],
    },
    routingLocks: [
      { seatId: 'seat:developer', executorRef: developerRef, authorityRef: 'authority:change-review', reason: 'Maintainer selected an accountable change author.' },
      { seatId: 'seat:builder', executorRef: 'script:mazz-builder', authorityRef: 'authority:change-review', reason: 'Pinned repository builder emits deterministic evidence.' },
      { seatId: 'seat:reviewer', executorRef: reviewerRef, authorityRef: 'authority:change-review', reason: 'Independent reviewer is distinct from the author.' },
      { seatId: 'seat:tester', executorRef: 'script:mazz-tests', authorityRef: 'authority:security-review', reason: 'Pinned scoped test runner emits deterministic evidence.' },
      { seatId: 'seat:security-reviewer', executorRef: securityReviewerRef, authorityRef: 'authority:security-review', reason: 'Named security reviewer is distinct from development and test execution.' },
      { seatId: 'seat:release-owner', executorRef: releaseOwnerRef, authorityRef: 'authority:release-owner', reason: 'Named local specimen authority cannot publish to production.' },
    ],
    authorityBindings: [
      { authorityRef: 'authority:change-review', actorRef: reviewerRef, actorKind: 'human' },
      { authorityRef: 'authority:security-review', actorRef: securityReviewerRef, actorKind: 'human' },
      { authorityRef: 'authority:release-owner', actorRef: releaseOwnerRef, actorKind: 'human' },
    ],
    provenance: { source: 'W82b local fixture', requestedBy: 'human:maintainer', productionMutationAuthorized: false },
  });
}

function normalizeSoftwareReleaseReceipt(input) {
  rejectSecrets(input);
  object(input, 'Software Release Receipt', RECEIPT_FIELDS);
  if (input.schema !== SOFTWARE_RELEASE_RECEIPT_SCHEMA) throw new Error(`未知 Software Release Receipt schema: ${input.schema || '空'}`);
  const status = enumValue(input.status, RECEIPT_STATES, 'receipt.status');
  let exitCode = null;
  if (input.exitCode != null) {
    if (!Number.isInteger(input.exitCode)) throw new Error('receipt.exitCode 必须是整数或 null');
    exitCode = input.exitCode;
  }
  if (status === 'passed' && exitCode !== 0) throw new Error('passed receipt 必须记录 exitCode=0');
  if (status === 'failed' && (exitCode == null || exitCode === 0)) throw new Error('failed receipt 必须记录非零 exitCode');
  if (status === 'unknown' && exitCode != null) throw new Error('unknown receipt 不得伪造 exitCode');
  const receipt = {
    schema: SOFTWARE_RELEASE_RECEIPT_SCHEMA,
    receiptId: required(input.receiptId, 'receipt.receiptId', 240),
    stage: enumValue(input.stage, RECEIPT_STAGES, 'receipt.stage'),
    operationRef: required(input.operationRef, 'receipt.operationRef', 240),
    toolRef: required(input.toolRef, 'receipt.toolRef', 240),
    toolVersion: required(input.toolVersion, 'receipt.toolVersion', 240),
    status,
    exitCode,
    startedAt: iso(input.startedAt, 'receipt.startedAt'),
    endedAt: iso(input.endedAt, 'receipt.endedAt'),
    inputDigest: sha(input.inputDigest, 'receipt.inputDigest'),
    outputDigest: sha(input.outputDigest, 'receipt.outputDigest'),
    evidenceRefs: strings(input.evidenceRefs, 'receipt.evidenceRefs'),
    nonProduction: input.nonProduction === true,
    pushed: input.pushed === true,
    published: input.published === true,
    externalMutation: input.externalMutation === true,
    message: required(input.message, 'receipt.message', 1200),
  };
  if (!receipt.nonProduction || receipt.pushed || receipt.published || receipt.externalMutation) {
    throw new Error('W82b receipt 必须保持 nonProduction=true 且 push/publish/externalMutation=false');
  }
  if (Date.parse(receipt.endedAt) < Date.parse(receipt.startedAt)) throw new Error('receipt.endedAt 不得早于 startedAt');
  return deepFreeze(receipt);
}

function normalizeSoftwareReleaseDecision(input) {
  rejectSecrets(input);
  object(input, 'Software Release Decision', DECISION_FIELDS);
  if (input.schema !== SOFTWARE_RELEASE_DECISION_SCHEMA) throw new Error(`未知 Software Release Decision schema: ${input.schema || '空'}`);
  const decision = {
    schema: SOFTWARE_RELEASE_DECISION_SCHEMA,
    decisionId: required(input.decisionId, 'decision.decisionId', 240),
    gateId: enumValue(input.gateId, DECISION_GATES, 'decision.gateId'),
    authorityRef: required(input.authorityRef, 'decision.authorityRef', 240),
    actorRef: required(input.actorRef, 'decision.actorRef', 240),
    decision: enumValue(input.decision, ['approve', 'reject'], 'decision.decision'),
    scope: enumValue(input.scope, ['local-specimen'], 'decision.scope'),
    evidenceRefs: strings(input.evidenceRefs, 'decision.evidenceRefs'),
    reason: required(input.reason, 'decision.reason', 1200),
  };
  if (!decision.actorRef.startsWith('human:')) throw new Error('W82b Authority Decision 必须由 human:* actor 签发');
  return deepFreeze(decision);
}

function receiptResult(receipt, checkRef) {
  if (!receipt) return [];
  return [{ checkRef, status: receipt.status, evidenceRefs: receipt.evidenceRefs, message: receipt.message }];
}

function decisionResult(decision, checkRef) {
  if (!decision) return [];
  return [{
    checkRef,
    status: decision.decision === 'approve' ? 'passed' : 'failed',
    evidenceRefs: decision.evidenceRefs,
    message: decision.reason,
  }];
}

function authorityDecision(decision) {
  if (!decision) return null;
  return {
    authorityRef: decision.authorityRef,
    actorRef: decision.actorRef,
    decision: decision.decision,
    evidenceRefs: decision.evidenceRefs,
    reason: decision.reason,
  };
}

function withAuthorityBinding(result, gate, decision, plan) {
  if (!decision) return result;
  const binding = plan.authoritySchedule.find(item => item.authorityRef === gate.authorityRef)?.binding;
  const reasons = [...result.reasons];
  if (!binding || binding.actorRef !== decision.actorRef) reasons.push('AUTHORITY_ACTOR_MISMATCH');
  if (decision.authorityRef !== gate.authorityRef) reasons.push('AUTHORITY_MISMATCH');
  if (reasons.length === result.reasons.length) return result;
  return deepFreeze({
    ...result,
    status: 'BLOCKED',
    nextState: gate.failState,
    recoveryPointId: gate.recoveryPointId,
    reasons: [...new Set(reasons)].sort(),
  });
}

function transition(workflow, plan, gateId, artifactVersions, receipts, decisions) {
  const gate = workflow.gates.find(item => item.gateId === gateId);
  const decision = decisions.get(gateId);
  const evidence = {
    schema: kernel.TRANSITION_EVIDENCE_SCHEMA,
    transitionId: `transition:w82b:${gateId.split(':').at(-1)}`,
    gateId,
    artifactVersions: Object.fromEntries(gate.artifactIds.map(id => [id, artifactVersions[id]])),
    verificationResults: [],
    reviewResults: [],
    evaluationResults: [],
    authorityDecision: authorityDecision(decision),
  };
  if (gateId === 'gate:build-review') {
    evidence.verificationResults = receiptResult(receipts.get('build'), 'check:build');
    evidence.reviewResults = decisionResult(decision, 'review:independent');
    evidence.evaluationResults = decisionResult(decision, 'evaluation:diff-scope');
  } else if (gateId === 'gate:test-security') {
    evidence.verificationResults = receiptResult(receipts.get('test'), 'check:test');
    evidence.reviewResults = receiptResult(receipts.get('security'), 'review:security');
    evidence.evaluationResults = decisionResult(decision, 'evaluation:security-risk');
  } else {
    evidence.verificationResults = receiptResult(receipts.get('package'), 'check:package');
    evidence.reviewResults = decisionResult(decision, 'review:release-evidence');
    evidence.evaluationResults = decisionResult(decision, 'evaluation:release-risk');
  }
  return withAuthorityBinding(kernel.evaluateEvidenceBackedTransition(gate, evidence), gate, decision, plan);
}

function sourceArtifactFor(result, receipts) {
  if (result.gateId === 'gate:build-review') return receipts.get('build')?.status === 'failed' ? 'artifact:build-report' : 'artifact:review-report';
  if (result.gateId === 'gate:test-security') return receipts.get('test')?.status === 'failed' ? 'artifact:test-report' : 'artifact:security-report';
  return 'artifact:release-specimen';
}

function normalizeArtifactVersions(value, workflow) {
  if (!isPlainObject(value)) throw new Error('artifactVersions 必须是对象');
  assertKnownKeys(value, workflow.artifacts.map(item => item.artifactId), 'artifactVersions');
  const normalized = {};
  for (const artifact of workflow.artifacts) normalized[artifact.artifactId] = required(value[artifact.artifactId], `artifactVersions.${artifact.artifactId}`, 160);
  return normalized;
}

function evaluateSoftwareReleaseSlice(input) {
  rejectSecrets(input);
  object(input, 'Software Release Slice Evaluation', EVALUATION_FIELDS);
  const workflow = kernel.normalizeWorkflowPackage(input.workflowPackage);
  if (workflow.workflowId !== 'workflow:mazz-local-software-release:v1') throw new Error('W82b 只接受冻结的软件发布 Workflow Package');
  const plan = kernel.compileOrganization(workflow, input.compileRequest);
  const artifactVersions = normalizeArtifactVersions(input.artifactVersions, workflow);
  if (!Array.isArray(input.receipts) || !Array.isArray(input.decisions)) throw new Error('receipts/decisions 必须是数组');
  const receipts = new Map();
  for (const row of input.receipts.map(normalizeSoftwareReleaseReceipt)) {
    if (receipts.has(row.stage)) throw new Error(`同一 stage 只能有一份当前 receipt: ${row.stage}`);
    receipts.set(row.stage, row);
  }
  const decisions = new Map();
  for (const row of input.decisions.map(normalizeSoftwareReleaseDecision)) {
    if (decisions.has(row.gateId)) throw new Error(`同一 gate 只能有一份当前 decision: ${row.gateId}`);
    decisions.set(row.gateId, row);
  }
  const transitions = DECISION_GATES.map(gateId => transition(workflow, plan, gateId, artifactVersions, receipts, decisions));
  const firstBlocked = transitions.find(item => item.status === 'BLOCKED');
  const hasUnknown = transitions.some(item => item.status === 'UNKNOWN') || plan.status === 'UNKNOWN';
  const planBlocked = plan.status === 'BLOCKED';
  let status = 'COMPLETED';
  if (planBlocked || firstBlocked) status = 'RECOVERY_REQUIRED';
  else if (hasUnknown) status = 'UNKNOWN';
  const failedTransition = firstBlocked || null;
  const changedArtifactId = failedTransition ? sourceArtifactFor(failedTransition, receipts) : '';
  const affectedArtifactIds = changedArtifactId ? kernel.affectedArtifacts(workflow, [changedArtifactId]) : [];
  const recoveryPoint = failedTransition
    ? workflow.recoveryPoints.find(item => item.recoveryPointId === failedTransition.recoveryPointId)
    : null;
  const core = {
    schema: SOFTWARE_RELEASE_RESULT_SCHEMA,
    workflowRef: { workflowId: workflow.workflowId, version: workflow.version },
    planId: plan.planId,
    planStatus: plan.status,
    status,
    transitions,
    receiptRefs: [...receipts.values()].map(item => ({ receiptId: item.receiptId, stage: item.stage, status: item.status, digest: digest(item) })),
    decisionRefs: [...decisions.values()].map(item => ({ decisionId: item.decisionId, gateId: item.gateId, actorRef: item.actorRef, decision: item.decision, digest: digest(item) })),
    recovery: recoveryPoint ? {
      required: true,
      recoveryPointId: recoveryPoint.recoveryPointId,
      resumeSeatIds: recoveryPoint.resumeSeatIds,
      changedArtifactId,
      affectedArtifactIds,
      reasons: failedTransition.reasons,
    } : { required: planBlocked, recoveryPointId: '', resumeSeatIds: [], changedArtifactId: '', affectedArtifactIds: [], reasons: plan.blockers.map(item => item.code) },
    localSealAllowed: status === 'COMPLETED',
    executionBoundary: {
      nonProduction: true,
      pushed: false,
      published: false,
      externalMutation: false,
      productionReleaseAuthorized: false,
      compilerOwner: 'W82',
      runtimeTruthOwner: 'W73',
    },
    provenance: clonePlain(object(input.provenance, 'provenance', Object.keys(input.provenance || {})), 'provenance'),
  };
  return deepFreeze({ ...core, resultDigest: digest(core) });
}

function toW73ProductionRunEvents(result) {
  if (!isPlainObject(result) || result.schema !== SOFTWARE_RELEASE_RESULT_SCHEMA) throw new Error('W73 projection 需要 W82b result');
  if (result.executionBoundary?.nonProduction !== true || result.executionBoundary?.productionReleaseAuthorized !== false) {
    throw new Error('W73 projection 拒绝越过 W82b 非生产边界');
  }
  const events = [{ type: 'run-started', toStatus: 'running', reasonCode: 'W82B_LOCAL_SPECIMEN_START', protocolRefs: [result.planId] }];
  for (const receipt of result.receiptRefs) {
    events.push({
      type: 'artifact-recorded',
      reasonCode: `W82B_${receipt.stage.toUpperCase()}_RECEIPT`,
      artifactRefs: [{ kind: 'evidence', id: receipt.receiptId, version: receipt.digest, role: `${receipt.stage}-receipt` }],
    });
  }
  for (const decision of result.decisionRefs) {
    events.push({
      type: 'review-recorded',
      actorRef: decision.actorRef,
      reasonCode: `W82B_${decision.decision.toUpperCase()}`,
      gateRefs: [decision.gateId],
      artifactRefs: [{ kind: 'decision', id: decision.decisionId, version: decision.digest, role: 'authority-decision' }],
    });
  }
  events.push({
    type: 'audit-recorded',
    reasonCode: 'W82B_EVIDENCE_TRANSITIONS',
    gateRefs: result.transitions.map(item => item.gateId),
    evaluationRefs: result.transitions.map(item => `${item.gateId}:${item.status}`),
  });
  if (result.status === 'RECOVERY_REQUIRED') {
    events.push({
      type: 'run-recovery-required',
      toStatus: 'blocked',
      reasonCode: result.recovery.reasons[0] || 'W82B_RECOVERY_REQUIRED',
      reworkRefs: result.recovery.affectedArtifactIds,
      artifactRefs: [{ kind: 'evidence', id: result.resultDigest, role: 'recovery-evidence' }],
    });
  } else if (result.status === 'COMPLETED') {
    events.push({
      type: 'run-completed',
      toStatus: 'completed',
      reasonCode: 'W82B_LOCAL_SPECIMEN_APPROVED',
      artifactRefs: [{ kind: 'artifact', id: 'artifact:release-specimen', version: result.resultDigest, role: 'local-non-production-specimen' }],
    });
  } else {
    events.push({ type: 'run-paused', toStatus: 'paused', reasonCode: 'W82B_EVIDENCE_UNKNOWN' });
  }
  return deepFreeze(events);
}

module.exports = {
  SOFTWARE_RELEASE_RECEIPT_SCHEMA,
  SOFTWARE_RELEASE_DECISION_SCHEMA,
  SOFTWARE_RELEASE_RESULT_SCHEMA,
  RECEIPT_STAGES,
  createSoftwareReleaseWorkflowPackage,
  createSoftwareReleaseCompileRequest,
  normalizeSoftwareReleaseReceipt,
  normalizeSoftwareReleaseDecision,
  evaluateSoftwareReleaseSlice,
  toW73ProductionRunEvents,
};
