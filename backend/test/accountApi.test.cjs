const test = require('node:test');
const assert = require('node:assert/strict');

const { createAccountHandlers } = require('../routes/accountRoutes.cjs');

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('account summary requires an authenticated user', async () => {
  const handlers = createAccountHandlers({ userRepository: {}, matchRepository: {} });
  const response = createResponse();

  await handlers.summary({ auth: null }, response);

  assert.equal(response.statusCode, 401);
});

test('account summary returns wallet and aggregate statistics', async () => {
  const handlers = createAccountHandlers({
    userRepository: {
      async getAccountSummary() {
        return { pointsBalance: 12.5, stats: { gamesPlayed: 3 } };
      }
    },
    matchRepository: {}
  });
  const response = createResponse();

  await handlers.summary({ auth: { user: { id: 'user-1' } } }, response);

  assert.deepEqual(response.body, {
    success: true,
    summary: { pointsBalance: 12.5, stats: { gamesPlayed: 3 } }
  });
});

test('history handlers reject malformed cursors', async () => {
  const handlers = createAccountHandlers({ userRepository: {}, matchRepository: {} });
  const response = createResponse();

  await handlers.matches({ auth: { user: { id: 'user-1' } }, query: { cursor: 'broken' } }, response);

  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /游标/);
});

test('history handlers clamp page size to 50', async () => {
  let receivedOptions;
  const handlers = createAccountHandlers({
    userRepository: {},
    matchRepository: {
      async getUserPoints(_userId, options) {
        receivedOptions = options;
        return { items: [], nextCursor: null };
      }
    }
  });
  const response = createResponse();

  await handlers.points({ auth: { user: { id: 'user-1' } }, query: { limit: '500' } }, response);

  assert.equal(receivedOptions.limit, 50);
  assert.deepEqual(response.body, { success: true, items: [], nextCursor: null });
});
