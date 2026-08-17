const test = require('node:test');
const assert = require('node:assert/strict');

const { createHealthHandler } = require('../routes/healthRoutes.cjs');

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('health route only reports success after a database query', async () => {
  const databaseTime = new Date('2026-08-17T01:00:00.000Z');
  const response = createResponse();
  await createHealthHandler({ checkDatabase: async () => databaseTime })({}, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.databaseTime, databaseTime.toISOString());
});

test('health route returns unavailable when the database is down', async () => {
  const response = createResponse();
  await createHealthHandler({
    checkDatabase: async () => { throw new Error('database down'); }
  })({}, response);

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { success: false, error: 'database_unavailable' });
});
