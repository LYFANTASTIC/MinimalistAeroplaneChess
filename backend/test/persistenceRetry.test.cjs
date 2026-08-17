const test = require('node:test');
const assert = require('node:assert/strict');

const { retryTransientOperation } = require('../services/persistenceRetry.cjs');

test('persistence retry recovers from common connection failures', async () => {
  let attempts = 0;
  const result = await retryTransientOperation(async () => {
    attempts += 1;
    if (attempts < 3) {
      throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    }
    return 'saved';
  }, { retryDelays: [0, 0], sleep: async () => {} });

  assert.equal(result, 'saved');
  assert.equal(attempts, 3);
});

test('persistence retry does not repeat permanent failures', async () => {
  let attempts = 0;
  await assert.rejects(retryTransientOperation(async () => {
    attempts += 1;
    throw Object.assign(new Error('constraint failed'), { code: '23505' });
  }, { retryDelays: [0, 0], sleep: async () => {} }), /constraint failed/);

  assert.equal(attempts, 1);
});

test('persistence retry can wait through an extended transient outage', async () => {
  let attempts = 0;
  const result = await retryTransientOperation(async () => {
    attempts += 1;
    if (attempts < 6) throw Object.assign(new Error('network down'), { code: '08006' });
    return 'recovered';
  }, {
    retryDelays: [0],
    maxRetries: Infinity,
    sleep: async () => {}
  });

  assert.equal(result, 'recovered');
  assert.equal(attempts, 6);
});
