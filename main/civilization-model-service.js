'use strict';

const kernel = require('./foundation/civilization-model');
const { captureDomainEvent } = require('./foundation/domain-event-capture');

class CivilizationModelService {
  constructor({ eventService = null, rootProvider = null } = {}) {
    this.eventService = eventService;
    this.rootProvider = rootProvider;
  }

  _event(action, outcome, subjectId = 'world:simulation', objectId = '') {
    return captureDomainEvent(this.eventService, {
      domain: 'world', action, outcome, actorType: 'system', subjectId, objectId,
    });
  }

  simulate({ model, change, maxDepth = 5 } = {}) {
    try {
      const result = kernel.simulateCivilization(model, change, { maxDepth });
      this._event('simulate', 'success', model?.modelId || model?.worldId || 'world:simulation');
      return result;
    } catch (error) {
      this._event('simulate', 'failed', model?.modelId || model?.worldId || 'world:simulation');
      throw error;
    }
  }

  filter({ simulation, themeTerms = [], limit = 20 } = {}) {
    try {
      const result = kernel.narrativeFilter(simulation, { themeTerms, limit });
      this._event('filter', 'success', simulation?.simulationId || 'world:simulation');
      return result;
    } catch (error) {
      this._event('filter', 'failed', simulation?.simulationId || 'world:simulation');
      throw error;
    }
  }

  reconcile(payload = {}) {
    try {
      const result = kernel.reconcileLedgers(payload);
      this._event('reconcile', 'success', payload?.worldId || 'world:ledger');
      return result;
    } catch (error) {
      this._event('reconcile', 'failed', payload?.worldId || 'world:ledger');
      throw error;
    }
  }
}

module.exports = { CivilizationModelService };
