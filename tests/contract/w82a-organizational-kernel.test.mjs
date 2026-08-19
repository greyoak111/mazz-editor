import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';
import {
  softwarePackage,
  softwareRequest,
  researchPackage,
  researchRequest,
} from '../fixtures/w82a-organizational-kernel-fixtures.mjs';

const require = createRequire(import.meta.url);
const kernel = require('../../main/foundation/organizational-kernel.js');

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseObjectKeys(item)]));
}

function passed(checkRef) {
  return { checkRef, status: 'passed', evidenceRefs: [`evidence:${checkRef}`], message: 'passed' };
}

describe('W82a Organizational Kernel contracts', () => {
  test('Workflow Package 以严格 schema 冻结五类输入、组织考古和责任结构', () => {
    const workflow = kernel.normalizeWorkflowPackage(softwarePackage());
    assert.equal(workflow.schema, kernel.WORKFLOW_PACKAGE_SCHEMA);
    assert.deepEqual(workflow.inputContract.requiredInputKinds, ['assets', 'budget', 'constraints', 'goal', 'method']);
    assert.equal(Object.isFrozen(workflow), true);
    assert.equal(Object.isFrozen(workflow.seats[0].delegation), true);
    const explained = new Set(workflow.archaeology.flatMap(row => row.targetSeatIds));
    assert.ok(workflow.seats.every(seat => explained.has(seat.seatId)));
    assert.ok(workflow.archaeology.some(row => row.decision === 'remove' && row.reasonClass === 'legacy-friction'));
  });

  test('未知字段和 secret 字段不能穿过组织契约', () => {
    const unknown = softwarePackage();
    unknown.universalPayload = {};
    assert.throws(() => kernel.normalizeWorkflowPackage(unknown), /未冻结字段/);

    const secret = softwarePackage();
    secret.provenance.apiKey = 'must-not-enter';
    assert.throws(() => kernel.normalizeWorkflowPackage(secret), /禁止 secret 字段/);

    const request = softwareRequest();
    request.capabilitySnapshot.executors[0].runtimeCommand = 'hidden execution';
    assert.throws(() => kernel.compileOrganization(softwarePackage(), request), /未冻结字段/);
  });

  test('每个 Seat 只能属于一个 Team 和一个显式 Routing Policy', () => {
    const missingTeamMembership = softwarePackage();
    missingTeamMembership.teams[0].seatIds = missingTeamMembership.teams[0].seatIds.filter(id => id !== 'seat:verifier');
    assert.throws(() => kernel.normalizeWorkflowPackage(missingTeamMembership), /必须且只能属于声明的一个 Team/);

    const duplicateRouting = softwarePackage();
    duplicateRouting.routingPolicies.push({
      policyId: 'routing:shadow', seatIds: ['seat:developer'], mode: 'proposal-only',
      requiresHumanDecision: true, evidenceRequirements: ['human-decision'],
    });
    assert.throws(() => kernel.normalizeWorkflowPackage(duplicateRouting), /必须且只能属于一个 Routing Policy/);

    const missingInputs = softwareRequest();
    missingInputs.assets = [];
    assert.throws(() => kernel.compileOrganization(softwarePackage(), missingInputs), /非空 Constraints 与 Assets/);
  });

  test('Child Seat 必须独立负责，且 Child Seat graph 不得成环', () => {
    const incompleteChild = softwarePackage();
    incompleteChild.seats.find(row => row.seatId === 'seat:verifier').childSeatOf = 'seat:developer';
    assert.throws(() => kernel.normalizeWorkflowPackage(incompleteChild), /缺独立职责.*Authority/);

    const cyclic = softwarePackage();
    const developer = cyclic.seats.find(row => row.seatId === 'seat:developer');
    const owner = cyclic.seats.find(row => row.seatId === 'seat:release-owner');
    developer.childSeatOf = 'seat:release-owner';
    developer.authorityRefs = ['authority:release-owner'];
    owner.childSeatOf = 'seat:developer';
    assert.throws(() => kernel.normalizeWorkflowPackage(cyclic), /Child Seat graph 存在 cycle/);
  });

  test('委托硬边界禁止 Authority/Qualification 继承和隐式 subcontract', () => {
    for (const mutation of [
      policy => { policy.authorityDelegable = true; },
      policy => { policy.qualificationDelegable = true; },
      policy => { policy.preventCycles = false; },
      policy => { policy.parentLiabilityRetained = false; },
    ]) {
      const workflow = softwarePackage();
      mutation(workflow.delegationPolicy);
      assert.throws(() => kernel.normalizeWorkflowPackage(workflow), /硬边界/);
    }
    const implicit = softwarePackage();
    implicit.delegationPolicy.allowSubcontract = true;
    implicit.delegationPolicy.requireExplicitSubcontract = false;
    assert.throws(() => kernel.normalizeWorkflowPackage(implicit), /subcontract 必须显式授权/);
  });

  test('软件发布与实证研究由同一内核编译为 READY，但内核不执行也不发布', () => {
    const softwarePlan = kernel.compileOrganization(softwarePackage(), softwareRequest());
    const researchPlan = kernel.compileOrganization(researchPackage(), researchRequest());
    for (const plan of [softwarePlan, researchPlan]) {
      assert.equal(plan.schema, kernel.EXECUTION_PLAN_SCHEMA);
      assert.equal(plan.status, 'READY');
      assert.equal(plan.blockers.length, 0);
      assert.equal(plan.compilerBoundary.compilerOwner, 'W82');
      assert.equal(plan.compilerBoundary.runtimeOwner, 'W73');
      assert.equal(plan.compilerBoundary.agentHarnessOwner, 'W66');
      assert.equal(plan.compilerBoundary.externalToolOwner, 'W79');
      assert.equal(plan.compilerBoundary.executes, false);
      assert.equal(plan.compilerBoundary.publishes, false);
      assert.ok(plan.routing.every(row => row.automaticSelection === false));
      assert.ok(plan.gateSchedule.every(row => row.automaticAuthority === false));
    }
    assert.notEqual(softwarePlan.workflowRef.workflowId, researchPlan.workflowRef.workflowId);
    assert.deepEqual(
      Object.keys(softwarePlan.compilerBoundary).sort(),
      Object.keys(researchPlan.compilerBoundary).sort(),
      '不同领域不得换一套暗含运行时的内核',
    );
  });

  test('规范化与编译对对象键序稳定，Plan ID 可复验', () => {
    const expected = kernel.compileOrganization(softwarePackage(), softwareRequest());
    const reordered = kernel.compileOrganization(reverseObjectKeys(softwarePackage()), reverseObjectKeys(softwareRequest()));
    assert.equal(reordered.planId, expected.planId);
    assert.equal(reordered.planDigest, expected.planDigest);
    assert.equal(reordered.provenance.workflowDigest, expected.provenance.workflowDigest);
    assert.equal(reordered.provenance.requestDigest, expected.provenance.requestDigest);
  });

  test('缺 routing/capability 明确 BLOCKED，未知成本明确 UNKNOWN 且绝不补零', () => {
    const noRouting = softwareRequest();
    noRouting.routingLocks = noRouting.routingLocks.filter(row => row.seatId !== 'seat:verifier');
    const blocked = kernel.compileOrganization(softwarePackage(), noRouting);
    assert.equal(blocked.status, 'BLOCKED');
    assert.ok(blocked.blockers.some(row => row.code === 'ROUTING_DECISION_REQUIRED' && row.subjectRef === 'seat:verifier'));

    const noCapability = softwareRequest();
    noCapability.capabilitySnapshot.executors.find(row => row.executorRef === 'script:test-runner').status = 'unavailable';
    const unavailable = kernel.compileOrganization(softwarePackage(), noCapability);
    assert.equal(unavailable.status, 'BLOCKED');
    assert.ok(unavailable.blockers.some(row => row.code === 'LOCKED_EXECUTOR_INELIGIBLE'));

    const unknownBudget = softwareRequest();
    unknownBudget.budget.status = 'unknown';
    unknownBudget.budget.limit = null;
    const unknown = kernel.compileOrganization(softwarePackage(), unknownBudget);
    assert.equal(unknown.status, 'UNKNOWN');
    assert.equal(unknown.budgetEnvelope.status, 'unknown');
    assert.equal(unknown.budgetEnvelope.estimatedAmount, null);
    assert.ok(unknown.warnings.some(row => row.code === 'BUDGET_UNKNOWN'));
  });

  test('同一人占据作者席位和禁止兼任的最终 Authority 时必须 BLOCKED', () => {
    const request = softwareRequest();
    request.authorityBindings[0].actorRef = 'human:developer-a';
    const plan = kernel.compileOrganization(softwarePackage(), request);
    assert.equal(plan.status, 'BLOCKED');
    assert.ok(plan.blockers.some(row => row.code === 'AUTHORITY_SEPARATION_VIOLATION'));
  });

  test('状态跃迁必须同时具备 Verification/Review/Evaluation/Human Authority', () => {
    const gate = softwarePackage().gates.find(row => row.gateId === 'gate:release');
    const evidence = {
      schema: kernel.TRANSITION_EVIDENCE_SCHEMA,
      transitionId: 'transition:release:001',
      gateId: gate.gateId,
      artifactVersions: { 'artifact:test-report': '1', 'artifact:release-specimen': 'sha256:fixture' },
      verificationResults: [passed('check:package')],
      reviewResults: [passed('review:release')],
      evaluationResults: [passed('evaluation:release-risk')],
      authorityDecision: {
        authorityRef: 'authority:release-owner', actorRef: 'human:release-owner', decision: 'approve',
        evidenceRefs: ['evidence:release-decision'], reason: 'All required evidence passed.',
      },
    };
    const approved = kernel.evaluateEvidenceBackedTransition(gate, evidence);
    assert.equal(approved.status, 'APPROVED');
    assert.equal(approved.nextState, 'RELEASE_APPROVED');
    assert.equal(approved.automaticAuthority, false);

    const missingAuthority = structuredClone(evidence);
    missingAuthority.authorityDecision = null;
    assert.equal(kernel.evaluateEvidenceBackedTransition(gate, missingAuthority).status, 'UNKNOWN');

    const failed = structuredClone(evidence);
    failed.reviewResults[0].status = 'failed';
    const blocked = kernel.evaluateEvidenceBackedTransition(gate, failed);
    assert.equal(blocked.status, 'BLOCKED');
    assert.equal(blocked.nextState, 'RELEASE_BLOCKED');

    const hidden = structuredClone(evidence);
    hidden.authorityDecision.autoApproved = true;
    assert.throws(() => kernel.evaluateEvidenceBackedTransition(gate, hidden), /未冻结字段/);
  });

  test('Artifact DAG 只使变更点及其下游失效，不污染无关输入', () => {
    const affected = kernel.affectedArtifacts(softwarePackage(), ['artifact:change']);
    assert.deepEqual(affected, ['artifact:change', 'artifact:release-specimen', 'artifact:test-report']);
    assert.equal(affected.includes('artifact:requirement'), false);
  });

  test('Expert Capability Composition 保留身份、文风和权限，不嵌入实现或扩权', () => {
    const result = kernel.composeExpertCapabilities(softwarePackage(), {
      schema: kernel.EXPERT_COMPOSITION_SCHEMA,
      compositionId: 'composition:release:001',
      bindings: [
        { seatId: 'seat:developer', capabilityId: 'expert:change-author', requiredInputTypes: ['requirement'], requiredOutputTypes: ['source-change'] },
        { seatId: 'seat:verifier', capabilityId: 'expert:release-reviewer', requiredInputTypes: ['source-change'], requiredOutputTypes: ['verification-report'] },
      ],
      provenance: { source: 'human:maintainer' },
    });
    assert.equal(result.components.length, 2);
    assert.equal(new Set(result.components.map(row => row.identity)).size, 2);
    assert.equal(new Set(result.components.map(row => row.styleIdentity)).size, 2);
    assert.ok(result.components.every(row => row.implementationEmbedded === false));
    assert.equal(result.permissionsExpanded, false);
    assert.equal(result.identitiesMerged, false);
  });

  test('Foundation 源码没有 Electron/IPC/网络/文件/子进程运行时', () => {
    const source = fs.readFileSync(new URL('../../main/foundation/organizational-kernel.js', import.meta.url), 'utf8');
    for (const forbidden of [
      "require('child_process')", "require('fs')", "require('http')", "require('https')",
      "require('electron')", 'ipcMain', 'ipcRenderer', '.spawn(', '.exec(', 'fetch(', 'WebSocket',
    ]) assert.equal(source.includes(forbidden), false, `Foundation 不得含运行时能力: ${forbidden}`);
  });
});
