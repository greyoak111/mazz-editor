'use strict';

const kernel = require('./foundation/organizational-kernel');
const animation = require('./foundation/animation-short-slice');
const software = require('./foundation/software-release-slice');
const research = require('./foundation/research-evidence-slice');
const crossMedia = require('./foundation/cross-media-workflow-family');
const game = require('./foundation/game-vertical-slice');
const { WorkflowLibrary } = require('./workflow-library');

const TEMPLATES = Object.freeze([
  { id: 'animation-short', label: '动画短片', deliverable: '本地主清单', methods: ['animation-short-v1'], executors: ['tool:visual-primary', 'tool:visual-backup'], risk: 'medium' },
  { id: 'game-vertical-slice', label: '视觉小说 / 游戏垂直切片', deliverable: '本地构建清单', methods: ['game-vertical-slice-v1'], executors: ['tool:external-game-engine'], risk: 'high' },
  { id: 'software-release', label: '软件发布组织', deliverable: '本地非生产 specimen', methods: ['software-release-v1'], executors: [], risk: 'high' },
  { id: 'research-report', label: '研究报告组织', deliverable: '本地未发布报告', methods: ['research-evidence-v1'], executors: [], risk: 'medium' },
]);

function summarize(workflow, request, plan, input) {
  const cost = request.capabilitySnapshot.executors.reduce((sum, row) => sum + (row.estimatedCost?.amount || 0), 0);
  const unavailable = request.capabilitySnapshot.executors.filter(row => row.status !== 'available').map(row => row.executorRef);
  return {
    schema: 'mazz.intent-organization-preview/v0', previewOnly: true, executionStarted: false,
    intent: { goal: String(input.goal || '').slice(0, 1000), templateId: input.templateId, methodRef: request.method.methodId, budget: request.budget },
    workflow: { workflowId: workflow.workflowId, version: workflow.version, name: workflow.name, domain: workflow.domain, deliverableType: workflow.deliverableType },
    organization: { teams: workflow.teams, seats: workflow.seats, gates: workflow.gates, artifacts: workflow.artifacts, authorities: workflow.authorities, recoveryPoints: workflow.recoveryPoints },
    routing: plan.routing,
    estimate: { currency: request.budget.currency, declaredExecutorCost: cost, budgetLimit: request.budget.limit, withinBudget: request.budget.status === 'known' && cost <= request.budget.limit },
    gaps: { unavailableExecutors: unavailable, missingCapabilities: plan.blockers || [], blocked: plan.status !== 'READY' },
    authority: { humanBindings: request.authorityBindings, bypassAllowed: false },
    boundary: { runtimeTruthOwner: 'W73', publicationAuthorized: false, externalMutationAuthorized: false },
    planDigest: plan.planDigest,
  };
}

class OrganizationalWorkspaceService {
  constructor({ bus, rootProvider }) {
    this.library = new WorkflowLibrary({ rootProvider });
    bus.handle('organization:templates', async () => TEMPLATES);
    bus.handle('organization:preview', async payload => this.preview(payload));
    bus.handle('organization:save', async payload => this.save(payload));
    bus.handle('organization:list', async payload => this.library.list(payload || {}));
    bus.handle('organization:compatibility', async payload => this.library.compatibility(payload.workflowId, payload.version, payload));
  }

  materialize(input = {}) {
    const templateId = String(input.templateId || 'animation-short');
    if (!String(input.goal || '').trim()) throw new Error('请先填写目标交付物');
    const budget = Math.max(0, Math.min(100000000, Number(input.budget) || 0));
    let workflow; let request; let boundary = {};
    if (templateId === 'animation-short') {
      workflow = animation.createAnimationWorkflowPackage();
      request = animation.createAnimationCompileRequest({ durationSeconds: Math.max(30, Math.min(180, Number(input.durationSeconds) || 90)), visualExecutorRef: input.executorRef || 'tool:visual-primary' });
    } else if (templateId === 'game-vertical-slice') {
      workflow = game.createGameVerticalSliceWorkflow();
      request = game.createGameCompileRequest({ engineAdapterRef: input.executorRef || 'tool:external-game-engine', engineAvailable: input.engineAvailable !== false });
      boundary = { mazzGameEngineBuilt: false, externalEngineRequired: true };
    } else if (templateId === 'software-release') {
      workflow = software.createSoftwareReleaseWorkflowPackage();
      request = software.createSoftwareReleaseCompileRequest();
      boundary = { productionReleaseAuthorized: false };
    } else if (templateId === 'research-report') {
      workflow = research.createResearchWorkflowPackage();
      request = research.createResearchCompileRequest();
      boundary = { publicationAuthorized: false, researchConclusionVerified: false };
    } else throw new Error(`未知组织模板: ${templateId}`);
    request = JSON.parse(JSON.stringify(request));
    request.goal.statement = String(input.goal).slice(0, 1000);
    if (budget > 0) request.budget.limit = budget;
    const plan = kernel.compileOrganization(workflow, request);
    return { workflow, request, plan, boundary };
  }

  preview(input) {
    const { workflow, request, plan, boundary } = this.materialize(input);
    return { ...summarize(workflow, request, plan, input), boundary: { ...summarize(workflow, request, plan, input).boundary, ...boundary } };
  }

  save(input) {
    const { workflow, request, plan } = this.materialize(input);
    const record = this.library.save(workflow, { source: 'intent-to-organization', authorityRef: String(input.authorityRef || 'human:workflow-owner') });
    return { record: { workflowId: record.workflowId, version: record.version, packageDigest: record.packageDigest, status: record.status }, preview: summarize(workflow, request, plan, input), executionStarted: false };
  }

  crossMediaFamily() { return crossMedia.createCrossMediaWorkflowFamily(); }
}

module.exports = { OrganizationalWorkspaceService, TEMPLATES, summarize };
