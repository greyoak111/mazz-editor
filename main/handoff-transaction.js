'use strict';

/** Retry an idempotent target publication when the only missing fact is its
 * ACK. An explicit negative response stops; a timeout remains ambiguous and
 * must be queried again while the target is alive. */
async function publishIdempotently({ record, send, isAlive }) {
  while (!record.settled && isAlive()) {
    const published = await send();
    if (published) return true;
    if (record.lastPhaseTimeout !== 'finalize') return false;
  }
  return false;
}

module.exports = { publishIdempotently };
