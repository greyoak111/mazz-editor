// Deterministic W94A fixture adapter. It is never registered by production code.
'use strict';

const contract = require('../capability-execution-contract');

function createFixtureCapabilityAdapter({
  gate = null,
  fail = null,
  onExecute = () => {},
  onCancel = () => {},
} = {}) {
  const descriptor = contract.normalizeCapabilityDescriptor({
    schema: contract.CAPABILITY_DESCRIPTOR_SCHEMA,
    capabilityId: 'mazz.fixture.echo',
    version: '1.0.0',
    adapterId: 'mazz.fixture.echo.main',
    displayName: 'W94A Deterministic Fixture',
    kind: 'fixture',
    executionPlane: 'main',
    inputSchemas: ['mazz.fixture-input/v1'],
    outputSchemas: ['mazz.fixture-output/v1'],
    determinism: 'deterministic',
    safetyClass: 'local-safe',
    availability: {
      state: 'available',
      checkedAt: '2026-08-25T00:00:00.000Z',
      reason: '',
      evidenceRef: 'fixture:w94a',
    },
    cancelMode: 'cooperative',
    resumeMode: 'restart',
    provenance: { kind: 'deterministic-fixture', bundledWithMazz: false, testOnly: true },
  });
  return Object.freeze({
    protocol: contract.CAPABILITY_ADAPTER_PROTOCOL,
    descriptor,
    async execute({ proposal, signal }) {
      onExecute(proposal);
      if (signal.aborted) throw Object.assign(new Error('fixture cancelled'), { code: 'CAPABILITY_CANCELLED' });
      if (gate) await gate;
      if (signal.aborted) throw Object.assign(new Error('fixture cancelled'), { code: 'CAPABILITY_CANCELLED' });
      if (fail) throw (typeof fail === 'function' ? fail(proposal) : fail);
      const definition = contract.canonicalJson({
        capabilityId: proposal.capabilityId,
        capabilityVersion: proposal.capabilityVersion,
        inputs: proposal.inputs,
        parameters: proposal.parameters,
        constraints: proposal.constraints,
      });
      const digest = contract.sha256Hex(Buffer.from(definition, 'utf8'));
      return Object.freeze({
        status: 'completed',
        outputs: Object.freeze([Object.freeze({
          schema: contract.ARTIFACT_SCHEMA,
          kind: 'fixture-output',
          mediaType: 'application/vnd.mazz.fixture+json',
          contentSchema: 'mazz.fixture-output/v1',
          contentHash: `sha256-${digest}`,
          definitionHash: `sha256-${digest}`,
          storageRef: `fixture:${digest}`,
          sourceArtifacts: proposal.inputs.map(row => row.artifactId),
          rightsRef: '',
          mutableHead: false,
        })]),
        environment: { runtime: 'node', version: process.versions.node },
        diagnostics: { summaryRef: 'diagnostic:w94a-fixture-complete' },
        resourceFinal: { activeOwners: 0 },
        provenance: { adapter: descriptor.adapterId, fixture: true },
        seed: null,
      });
    },
    async cancel(context) { onCancel(context); },
    async dispose() { return { status: 'disposed' }; },
  });
}

module.exports = { createFixtureCapabilityAdapter };
