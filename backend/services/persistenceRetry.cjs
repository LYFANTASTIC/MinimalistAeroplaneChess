'use strict';

const { isRetryableDatabaseError } = require('./pointsService.cjs');

async function retryTransientOperation(work, {
  retryDelays = [250, 1000, 4000],
  sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
  isRetryable = isRetryableDatabaseError
} = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    if (attempt > 0) await sleep(retryDelays[attempt - 1]);
    try {
      return await work();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === retryDelays.length) throw error;
    }
  }
  throw lastError;
}

module.exports = { retryTransientOperation };
