'use strict';

const kernel = require('./foundation/civilization-model');

class CivilizationModelService {
  simulate({ model, change, maxDepth = 5 } = {}) { return kernel.simulateCivilization(model, change, { maxDepth }); }
  filter({ simulation, themeTerms = [], limit = 20 } = {}) { return kernel.narrativeFilter(simulation, { themeTerms, limit }); }
  reconcile(payload = {}) { return kernel.reconcileLedgers(payload); }
}

module.exports = { CivilizationModelService };
