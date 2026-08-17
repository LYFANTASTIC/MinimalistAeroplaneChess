const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPointsService,
  createRewardRetryQueue,
  isRetryableDatabaseError,
  makeIdempotencyKey
} = require('../services/pointsService.cjs');

const MATCH_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = 'dc16af26-51f8-4d78-a1c4-4e8c71e04b1c';

function createFakeDatabase({ failLedger = false } = {}) {
  const initialState = {
    balance: 100,
    version: 0,
    event: null,
    ledger: null,
    matchPoints: 0,
    planesDefeated: 0,
    lifetimePoints: 0
  };
  let state = structuredClone(initialState);
  let snapshot = null;
  const calls = [];

  const client = {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalized, params });
      if (normalized === 'BEGIN') { snapshot = structuredClone(state); return { rows: [] }; }
      if (normalized === 'COMMIT') { snapshot = null; return { rows: [] }; }
      if (normalized === 'ROLLBACK') { state = snapshot; snapshot = null; return { rows: [] }; }
      if (/FROM app\.points_ledger WHERE idempotency_key/i.test(normalized)) {
        return { rows: state.ledger ? [{ amount: String(state.ledger.amount), balance_after: String(state.ledger.balance) }] : [] };
      }
      if (/FROM app\.match_players/i.test(normalized) && /user_id/i.test(normalized)) {
        return { rows: [{ id: 'player-row' }] };
      }
      if (/INSERT INTO app\.match_events/i.test(normalized)) {
        if (state.event) return { rows: [] };
        state.event = { id: 'event-row' };
        return { rows: [{ id: 'event-row' }] };
      }
      if (/FROM app\.user_wallets/i.test(normalized) && /FOR UPDATE/i.test(normalized)) {
        return { rows: [{ points_balance: String(state.balance) }] };
      }
      if (/UPDATE app\.user_wallets/i.test(normalized)) {
        state.balance = Math.round((state.balance + Number(params[1])) * 100) / 100;
        state.version += 1;
        return { rows: [{ points_balance: String(state.balance), version: String(state.version) }] };
      }
      if (/INSERT INTO app\.points_ledger/i.test(normalized)) {
        if (failLedger) throw new Error('ledger insert failed');
        state.ledger = { amount: Number(params[1]), balance: Number(params[5]) };
        return { rows: [{ id: 'ledger-row' }] };
      }
      if (/UPDATE app\.match_players/i.test(normalized)) {
        state.matchPoints += Number(params[1]);
        state.planesDefeated += Number(params[2]);
        return { rows: [] };
      }
      if (/UPDATE app\.user_stats/i.test(normalized)) {
        state.lifetimePoints += Number(params[1]);
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
    release() {}
  };
  return {
    pool: { async connect() { return client; } },
    calls,
    getState: () => structuredClone(state),
    initialState
  };
}

function defeatInput(sequenceNo = 1) {
  return {
    matchId: MATCH_ID,
    sequenceNo,
    userId: USER_ID,
    targetUserId: null,
    targetPieceIndex: 2,
    eventType: 'plane_defeated',
    pieceCount: 4,
    progressBefore: 58.37,
    progressAfter: 20,
    metadata: { targetSeat: 2 }
  };
}

test('first reward atomically updates event, wallet, ledger, player, and stats', async () => {
  const database = createFakeDatabase();
  const service = createPointsService({ poolProvider: () => database.pool });

  const result = await service.award(defeatInput());

  assert.equal(result.amount, 47.61);
  assert.equal(result.balance, 147.61);
  assert.equal(result.duplicate, false);
  assert.equal(database.getState().matchPoints, 47.61);
  assert.equal(database.getState().planesDefeated, 1);
  assert.equal(database.getState().lifetimePoints, 47.61);
});

test('repeating an idempotency key returns the original result without adding twice', async () => {
  const database = createFakeDatabase();
  const service = createPointsService({ poolProvider: () => database.pool });

  await service.award(defeatInput());
  const duplicate = await service.award(defeatInput());

  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.balance, 147.61);
  assert.equal(database.getState().balance, 147.61);
});

test('ledger failure rolls back wallet and aggregates', async () => {
  const database = createFakeDatabase({ failLedger: true });
  const service = createPointsService({ poolProvider: () => database.pool });

  await assert.rejects(service.award(defeatInput()), /ledger insert failed/);

  assert.deepEqual(database.getState(), database.initialState);
});

test('AI or accountless actors are skipped before opening a transaction', async () => {
  let connected = false;
  const service = createPointsService({
    poolProvider: () => ({ async connect() { connected = true; } })
  });

  const result = await service.award({ ...defeatInput(), userId: null });

  assert.deepEqual(result, { skipped: true, reason: 'no_account' });
  assert.equal(connected, false);
});

test('idempotency keys contain match, event, and account identities', () => {
  assert.equal(
    makeIdempotencyKey(defeatInput(7)),
    `match:${MATCH_ID}:event:7:user:${USER_ID}`
  );
});

test('only transient database failures are retryable', () => {
  assert.equal(isRetryableDatabaseError({ code: '40001' }), true);
  assert.equal(isRetryableDatabaseError({ code: '08006' }), true);
  assert.equal(isRetryableDatabaseError({ code: 'ECONNREFUSED' }), true);
  assert.equal(isRetryableDatabaseError({ code: 'EAI_AGAIN' }), true);
  assert.equal(isRetryableDatabaseError({ code: '23505' }), false);
  assert.equal(isRetryableDatabaseError(new RangeError('invalid facts')), false);
});

test('retry queue retries transient failures and flushes by match', async () => {
  let attempts = 0;
  const queue = createRewardRetryQueue({
    award: async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error('database unavailable'), { code: '40001' });
      return { amount: 47.61, balance: 147.61 };
    },
    retryDelays: [0, 0, 0],
    sleep: async () => {}
  });

  queue.enqueue(defeatInput());
  await queue.flushPendingForMatch(MATCH_ID);

  assert.equal(attempts, 3);
  assert.equal(queue.pendingCount(), 0);
});

test('parallel duplicate enqueues share one award operation', async () => {
  let attempts = 0;
  let releaseAward;
  const awardGate = new Promise(resolve => { releaseAward = resolve; });
  const queue = createRewardRetryQueue({
    award: async () => {
      attempts += 1;
      await awardGate;
      return { amount: 47.61, balance: 147.61 };
    }
  });

  const first = queue.enqueue(defeatInput());
  const second = queue.enqueue(defeatInput());
  releaseAward();

  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(attempts, 1);
});

test('settlement flush retries a transient reward that exhausted background attempts', async () => {
  let attempts = 0;
  const successes = [];
  const queue = createRewardRetryQueue({
    award: async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error('database unavailable'), { code: '08006' });
      return { amount: 47.61, balance: 147.61, idempotencyKey: 'retry-key' };
    },
    retryDelays: [0],
    sleep: async () => {}
  });

  await assert.rejects(
    queue.enqueue(defeatInput(), { onSuccess: result => successes.push(result) }),
    /database unavailable/
  );
  assert.equal(queue.pendingCount(), 1);

  await queue.flushPendingForMatch(MATCH_ID);

  assert.equal(attempts, 3);
  assert.equal(successes.length, 1);
  assert.equal(queue.pendingCount(), 0);
});

test('durable settlement flush waits until a transient reward succeeds', async () => {
  let attempts = 0;
  const queue = createRewardRetryQueue({
    award: async () => {
      attempts += 1;
      if (attempts < 6) throw Object.assign(new Error('database unavailable'), { code: '08006' });
      return { amount: 47.61, balance: 147.61 };
    },
    retryDelays: [0],
    sleep: async () => {}
  });

  await assert.rejects(queue.enqueue(defeatInput()), /database unavailable/);
  await queue.flushPendingForMatch(MATCH_ID, { retryUntilAvailable: true });

  assert.equal(attempts, 6);
  assert.equal(queue.pendingCount(), 0);
});
