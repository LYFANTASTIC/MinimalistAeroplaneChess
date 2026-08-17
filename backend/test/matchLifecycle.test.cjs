const test = require('node:test');
const assert = require('node:assert/strict');

const { createMatchRepository } = require('../repositories/matchRepository.cjs');

const MATCH_ID = '10000000-0000-4000-8000-000000000001';
const USER_ONE = 'dc16af26-51f8-4d78-a1c4-4e8c71e04b1c';
const USER_TWO = '554b0d5a-1e13-45e1-a176-2e91be970de3';

function createTransactionRepository(query) {
  const client = { query };
  return createMatchRepository({
    poolProvider: () => ({}),
    transactionRunner: async (_pool, work) => work(client)
  });
}

test('match creation stores human account ids and an accountless AI', async () => {
  const calls = [];
  const repository = createTransactionRepository(async (sql, params) => {
    calls.push({ sql, params });
    return { rows: /INSERT INTO app\.matches/i.test(sql) ? [{ id: MATCH_ID }] : [] };
  });

  const created = await repository.createMatch({
    id: MATCH_ID,
    roomCode: 'ABCD',
    happyMode: false,
    teamMode: false,
    pieceCount: 4,
    launchNumber: 'even',
    startedAt: '2026-08-17T01:00:00.000Z',
    players: [
      { userId: USER_ONE, seat: 1, teamNo: null, isAi: false, displayName: '玩家一' },
      { userId: USER_TWO, seat: 2, teamNo: null, isAi: false, displayName: '玩家二' },
      { userId: null, seat: 3, teamNo: null, isAi: true, displayName: 'Bot-1' }
    ]
  });

  assert.equal(created, MATCH_ID);
  const playerCalls = calls.filter(call => /INSERT INTO app\.match_players/i.test(call.sql));
  assert.equal(playerCalls.length, 3);
  assert.equal(playerCalls[0].params[1], USER_ONE);
  assert.equal(playerCalls[2].params[1], null);
  assert.match(playerCalls[0].sql, /ON CONFLICT \(match_id, seat\) DO NOTHING/i);
});

test('match creation is idempotent after an unknown commit result', async () => {
  const repository = createTransactionRepository(async sql => {
    if (/INSERT INTO app\.matches/i.test(sql)) return { rows: [] };
    return { rows: [] };
  });

  const created = await repository.createMatch({
    id: MATCH_ID,
    roomCode: 'ABCD',
    happyMode: false,
    teamMode: false,
    pieceCount: 1,
    launchNumber: 'even',
    startedAt: '2026-08-17T01:00:00.000Z',
    players: [{ userId: USER_ONE, seat: 1, teamNo: null, isAi: false, displayName: '玩家一' }]
  });

  assert.equal(created, MATCH_ID);
});

test('settlement writes results and aggregate game counts once', async () => {
  const calls = [];
  let firstSettlement = true;
  const repository = createTransactionRepository(async (sql, params) => {
    calls.push({ sql, params });
    if (/UPDATE app\.matches/i.test(sql)) {
      const rows = firstSettlement ? [{ id: MATCH_ID }] : [];
      firstSettlement = false;
      return { rows };
    }
    return { rows: [] };
  });
  const settlement = {
    matchId: MATCH_ID,
    endReason: 'normal',
    endedAt: '2026-08-17T01:20:00.000Z',
    durationMs: 1200000,
    winnerUserId: USER_ONE,
    winnerTeamNo: null,
    sequenceNo: 1,
    players: [
      { userId: USER_ONE, seat: 1, placement: 1, isWinner: true, planesDefeated: 2, happyCollisions: 0, movementDistance: 20, bounceDistance: 1, diceStatistics: { 6: 3 }, titles: ['飞行冠军'] },
      { userId: USER_TWO, seat: 2, placement: 2, isWinner: false, planesDefeated: 0, happyCollisions: 0, movementDistance: 12, bounceDistance: 0, diceStatistics: { 6: 1 }, titles: [] },
      { userId: null, seat: 3, placement: 3, isWinner: false, planesDefeated: 0, happyCollisions: 0, movementDistance: 8, bounceDistance: 0, diceStatistics: {}, titles: [] }
    ]
  };

  assert.equal(await repository.settleMatch(settlement), true);
  assert.equal(await repository.settleMatch(settlement), false);

  const playerUpdates = calls.filter(call => /UPDATE app\.match_players/i.test(call.sql));
  const statsUpdates = calls.filter(call => /UPDATE app\.user_stats/i.test(call.sql));
  const finishEvents = calls.filter(call => /INSERT INTO app\.match_events/i.test(call.sql));
  assert.equal(playerUpdates.length, 3);
  assert.equal(statsUpdates.length, 2);
  assert.equal(finishEvents.length, 1);
});

test('abandoning an active match is idempotent', async () => {
  let active = true;
  const repository = createMatchRepository({
    poolProvider: () => ({
      async query() {
        if (!active) return { rows: [] };
        active = false;
        return { rows: [{ id: MATCH_ID }] };
      }
    })
  });

  assert.equal(await repository.abandonMatch(MATCH_ID, 'room_destroyed'), true);
  assert.equal(await repository.abandonMatch(MATCH_ID, 'room_destroyed'), false);
});
