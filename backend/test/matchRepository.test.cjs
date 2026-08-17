const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CursorError,
  createMatchRepository,
  decodeCursor,
  encodeCursor
} = require('../repositories/matchRepository.cjs');

const USER_ID = 'dc16af26-51f8-4d78-a1c4-4e8c71e04b1c';
const ROW_ID = '554b0d5a-1e13-45e1-a176-2e91be970de3';

test('history cursor round-trips an exact timestamp and id', () => {
  const value = { createdAt: '2026-08-01T01:02:03.000Z', id: ROW_ID };
  assert.deepEqual(decodeCursor(encodeCursor(value)), value);
});

test('malformed history cursors are rejected', () => {
  assert.throws(() => decodeCursor('not-base64-json'), CursorError);
  assert.throws(
    () => decodeCursor(Buffer.from(JSON.stringify({ createdAt: 'invalid', id: ROW_ID })).toString('base64url')),
    CursorError
  );
});

test('match history is scoped, stable, and returns a next cursor', async () => {
  const calls = [];
  const rows = [1, 2, 3].map(index => ({
    row_id: index === 3 ? ROW_ID : `00000000-0000-4000-8000-00000000000${index}`,
    match_id: `10000000-0000-4000-8000-00000000000${index}`,
    status: 'finished',
    end_reason: 'normal',
    happy_mode: false,
    team_mode: false,
    piece_count: 4,
    started_at: new Date(`2026-08-0${4 - index}T01:00:00.000Z`),
    ended_at: new Date(`2026-08-0${4 - index}T01:20:00.000Z`),
    duration_ms: '1200000',
    placement: index,
    planes_defeated: index,
    happy_collisions: 0,
    account_points_earned: '25.50',
    titles: []
  }));
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows };
    }
  };
  const repository = createMatchRepository({ poolProvider: () => pool });

  const page = await repository.getUserMatches(USER_ID, { limit: 2 });

  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].accountPointsEarned, 25.5);
  assert.ok(page.nextCursor);
  assert.match(calls[0].sql, /WHERE mp\.user_id = \$1/i);
  assert.match(calls[0].sql, /ORDER BY m\.started_at DESC, mp\.id DESC/i);
  assert.deepEqual(calls[0].params, [USER_ID, 3]);
});

test('points history is scoped to the authenticated user', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{
        id: ROW_ID,
        amount: '47.61',
        reason: 'plane_defeated',
        balance_after: '120.11',
        match_id: '10000000-0000-4000-8000-000000000001',
        metadata: { targetSeat: 2 },
        created_at: new Date('2026-08-03T01:00:00.000Z')
      }] };
    }
  };
  const repository = createMatchRepository({ poolProvider: () => pool });

  const page = await repository.getUserPoints(USER_ID, {
    limit: 20,
    cursor: { createdAt: '2026-08-04T01:00:00.000Z', id: ROW_ID }
  });

  assert.equal(page.items[0].amount, 47.61);
  assert.match(calls[0].sql, /WHERE user_id = \$1/i);
  assert.match(calls[0].sql, /\(created_at, id\) < \(\$2, \$3\)/i);
  assert.deepEqual(calls[0].params, [USER_ID, '2026-08-04T01:00:00.000Z', ROW_ID, 21]);
});

test('settlement preserves reward-derived defeat and happy-collision counters', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/UPDATE app\.matches/i.test(sql)) return { rows: [{ id: 'match-1' }] };
      return { rows: [] };
    }
  };
  const repository = createMatchRepository({
    poolProvider: () => ({}),
    transactionRunner: async (_pool, work) => work(client)
  });

  await repository.settleMatch({
    matchId: 'match-1',
    endReason: 'normal',
    endedAt: '2026-08-17T02:00:00.000Z',
    durationMs: 1000,
    winnerUserId: USER_ID,
    winnerTeamNo: null,
    sequenceNo: 9,
    players: [{
      userId: USER_ID,
      seat: 1,
      placement: 1,
      isWinner: true,
      planesDefeated: 3,
      happyCollisions: 2,
      movementDistance: 80,
      bounceDistance: 4,
      diceStatistics: {},
      titles: []
    }]
  });

  const playerUpdate = calls.find(call => /UPDATE app\.match_players/i.test(call.sql));
  assert.doesNotMatch(playerUpdate.sql, /planes_defeated|happy_collisions/i);
});
