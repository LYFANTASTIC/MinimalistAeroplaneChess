'use strict';

const { isRetryableDatabaseError } = require('./pointsService.cjs');

async function retryTransientOperation(work, {
  retryDelays = [250, 1000, 4000],
  maxRetries = retryDelays.length,
  sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
  isRetryable = isRetryableDatabaseError
} = {}) {
  let retries = 0;
  while (true) {
    try {
      return await work();
    } catch (error) {
      if (!isRetryable(error) || retries >= maxRetries) throw error;
      const delayIndex = Math.min(retries, Math.max(0, retryDelays.length - 1));
      await sleep(retryDelays[delayIndex] ?? 0);
      retries += 1;
    }
  }
}

module.exports = { retryTransientOperation };
