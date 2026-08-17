const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMatchRecord,
  buildSettlementRecord
} = require('../services/matchLifecycle.cjs');

const USER_ONE = 'dc16af26-51f8-4d78-a1c4-4e8c71e04b1c';

function createSession() {
  return {
    matchId: '10000000-0000-4000-8000-000000000001',
    roomCode: 'ABCD',
    happyMode: false,
    teamMode: false,
    pieceCount: 4,
    launchNumber: 'even',
    teams: [],
    createdAt: Date.parse('2026-08-17T01:00:00.000Z'),
    players: new Map([
      ['player-human', { id: 'player-human', accountUserId: USER_ONE, color: 1, nickname: '玩家一', isAI: false }],
      [2, { id: 2, accountUserId: null, color: 2, nickname: 'Bot-1', isAI: true }]
    ]),
    gameData: {
      playerChess: {
        1: [{ position: 56, finished: true }, { position: 56, finished: true }, { position: 56, finished: true }, { position: 56, finished: true }],
        2: [{ position: 20, finished: false }, { position: 10, finished: false }, { position: -1, finished: false }, { position: -1, finished: false }]
      },
      defeatCounts: { 1: { 2: 3 }, 2: { 1: 0 } },
      diceStatistics: { 1: { 6: 2 }, 2: { 6: 1 } },
      progressHistory: [{ round: 1, players: { 1: 100, 2: 35 } }]
    },
    nextEventSequence() { return 4; }
  };
}

test('match record snapshots human ids, AI, and seats', () => {
  const record = buildMatchRecord(createSession());
  assert.equal(record.players[0].userId, USER_ONE);
  assert.equal(record.players[1].userId, null);
  assert.equal(record.players[1].isAi, true);
});

test('normal settlement puts the winner first and only derives server statistics', () => {
  const session = createSession();
  const record = buildSettlementRecord(session, {
    winnerPlayer: 1,
    timestamp: Date.parse('2026-08-17T01:20:00.000Z'),
    titleStats: {
      totalDistance: { 1: 25, 2: 10 },
      bounceSteps: { 1: 2, 2: 0 },
      defeatCounts: { 1: { 2: 3 }, 2: { 1: 0 } },
      diceStatistics: { 1: { 6: 2 }, 2: { 6: 1 } }
    }
  }, 'normal');

  assert.equal(record.winnerUserId, USER_ONE);
  assert.equal(record.players[0].placement, 1);
  assert.equal(record.players[0].planesDefeated, 3);
  assert.equal(record.players[0].movementDistance, 0);
  assert.deepEqual(record.players[0].diceStatistics, { 6: 2 });
  assert.equal(record.durationMs, 1200000);
  assert.equal(record.sequenceNo, 4);
});

test('forced settlement derives seat order from server chess state', () => {
  const session = createSession();
  const record = buildSettlementRecord(session, {
    timestamp: Date.parse('2026-08-17T01:10:00.000Z'),
    rankings: [
      { playerNumber: 2, title: '领先者' },
      { playerNumber: 1, title: '追赶者' }
    ]
  }, 'force_settlement');

  assert.equal(record.players.find(player => player.seat === 1).placement, 1);
  assert.equal(record.players.find(player => player.seat === 2).placement, 2);
  assert.deepEqual(record.players.find(player => player.seat === 2).titles, []);
});
