'use strict';

const {
  createThreatModel, runHardSampleI, externalSafetyReviewGate,
  normalizeOfflineEvidenceRecording, createShadowPlan,
} = require('./foundation/physical-production-simulation');

class PhysicalSimulationService {
  constructor({ bus }) {
    bus.handle('physicalSimulation:threatModel', async () => createThreatModel());
    bus.handle('physicalSimulation:sampleI', async () => runHardSampleI());
    bus.handle('physicalSimulation:normalizeRecording', async payload => normalizeOfflineEvidenceRecording(payload));
    bus.handle('physicalSimulation:shadowPlan', async payload => createShadowPlan(payload));
    bus.handle('physicalSimulation:safetyReviewGate', async () => externalSafetyReviewGate());
  }
}

module.exports = { PhysicalSimulationService };
