'use strict';

const { _forTests } = require('../main/world-hub-publication-service');

const createdAt = '2026-08-28T00:00:00.000Z';
const manifestBody = {
  schema: 'mazz.public-content-manifest/v1', manifestId: 'manifest:drill',
  blocks: [{ contentId: 'content:drill-text', mediaType: 'text/plain', size: 12, contentHash: `sha256:${'d'.repeat(64)}`, encrypted: false }], createdAt,
};
const manifest = { ...manifestBody, contentRoot: `root:${_forTests.digest(manifestBody)}` };
const grant = _forTests.normalizeGrant({
  schema: 'mazz.publication-grant/v1', grantId: 'grant:drill-v1', publicationId: 'publication:drill-v1', subjectId: 'creator:alice',
  scope: ['publication:prepare', 'publication:publish', 'publication:withdraw', 'publication:sync'], authorityRef: 'human:alice',
  sourceArtifactRefs: ['artifact:drill-final'], rightsRef: 'license:cc-by', issuedAt: createdAt, status: 'active',
}, createdAt);
const base = _forTests.normalizeEnvelope({
  schema: 'mazz.publication-envelope/v1', publicationId: 'publication:drill-v1', workId: 'work:drill', creatorId: 'creator:alice',
  editionType: 'text', version: 'v1', title: 'Drill', summary: 'Backup drill fixture', visibility: 'public', worldRef: 'world:drill',
  contentManifestRef: 'manifest:drill', contentIds: ['content:drill-text'], licenseRef: 'license:cc-by', provenance: { producer: 'W94Gc-drill' },
  publicationGrantRef: 'grant:drill-v1', signatureRef: 'signature:placeholder', createdAt,
});
process.stdout.write(`${JSON.stringify({ manifest, grant, envelope: { ...base, signatureRef: _forTests.expectedSignatureRef(base, grant) } })}\n`);
