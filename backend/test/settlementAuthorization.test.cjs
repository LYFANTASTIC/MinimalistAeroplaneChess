const test = require('node:test');
const assert = require('node:assert/strict');

const {
  authorizeForcedSettlement,
  authorizeNormalSettlement
} = require('../services/settlementAuthorization.cjs');

function createSession() {
  return {
    hostId: 'host-player',
    pieceCount: 2,
    players: new Map([
      ['host-player', { id: 'host-player', color: 1, isAI: false }],
      ['guest-player', { id: 'guest-player', color: 2, isAI: false }]
    ]),
    gameData: {
      playerChess: {
        1: [{ position: 56, finished: true }, { position: 56, finished: true }],
        2: [{ position: 20, finished: false }, { position: -1, finished: false }]
      }
    }
  };
}

const canControlPlayerColor = (session, playerId, seat) => (
  session.players.get(playerId)?.color === seat
);

test('normal settlement only accepts a completed seat controlled by the sender', () => {
  const session = createSession();

  const trusted = authorizeNormalSettlement({
    session,
    playerId: 'host-player',
    message: {
      winnerPlayer: 1,
      timestamp: 1,
      rankings: [{ playerNumber: 2 }],
      titleStats: { totalDistance: { 1: 999999 } }
    },
    canControlPlayerColor,
    now: () => 123456
  });

  assert.deepEqual(trusted, { winnerPlayer: 1, timestamp: 123456 });
});

test('normal settlement rejects another player and an unfinished winner', () => {
  const session = createSession();

  assert.throws(() => authorizeNormalSettlement({
    session,
    playerId: 'guest-player',
    message: { winnerPlayer: 1 },
    canControlPlayerColor
  }), /不能结算这个玩家/);

  assert.throws(() => authorizeNormalSettlement({
    session,
    playerId: 'guest-player',
    message: { winnerPlayer: 2 },
    canControlPlayerColor
  }), /尚未完成/);
});

test('forced settlement is host-only and drops client rankings', () => {
  const session = createSession();

  assert.throws(() => authorizeForcedSettlement({
    session,
    playerId: 'guest-player',
    now: () => 123456
  }), /只有房主/);

  assert.deepEqual(authorizeForcedSettlement({
    session,
    playerId: 'host-player',
    message: { rankings: [{ playerNumber: 2 }], timestamp: 1 },
    now: () => 123456
  }), { timestamp: 123456 });
});
