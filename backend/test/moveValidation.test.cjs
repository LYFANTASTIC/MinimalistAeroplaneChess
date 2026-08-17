const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateFinalMoveResult,
  validateFullMoveStart
} = require('../services/moveValidation.cjs');

function createSession() {
  return {
    happyMode: false,
    pieceCount: 2,
    players: new Map([
      ['player-1', { id: 'player-1', color: 1, isAI: false }],
      ['player-2', { id: 'player-2', color: 2, isAI: false }]
    ]),
    gameData: {
      currentPlayer: 1,
      gamePhase: 'moving',
      diceValue: 4,
      diceValueConsumed: false,
      playerChess: {
        1: [{ position: 16, finished: false }, { position: -1, finished: false }],
        2: [{ position: 7, finished: false }, { position: -1, finished: false }]
      }
    }
  };
}

const canControlPlayerColor = (session, playerId, seat) => (
  session.players.get(playerId)?.color === seat
);

test('full move start issues one server move token from current dice and board state', () => {
  const session = createSession();
  const pending = validateFullMoveStart({
    session,
    playerId: 'player-1',
    message: { player: 1, chessIndex: 0, fromPosition: 16, diceValue: 4 },
    canControlPlayerColor,
    now: () => 123456
  });

  assert.deepEqual(pending, {
    player: 1,
    chessIndex: 0,
    fromPosition: 16,
    diceValue: 4,
    targetPosition: 20,
    timestamp: 123456
  });

  session.gameData._pendingMove = pending;
  assert.throws(() => validateFullMoveStart({
    session,
    playerId: 'player-1',
    message: { player: 1, chessIndex: 0, fromPosition: 16, diceValue: 4 },
    canControlPlayerColor
  }), /移动已经开始/);
});

test('full move start rejects another seat, stale dice, and a false origin', () => {
  const session = createSession();
  const base = { session, canControlPlayerColor };

  assert.throws(() => validateFullMoveStart({
    ...base,
    playerId: 'player-2',
    message: { player: 1, chessIndex: 0, fromPosition: 16, diceValue: 4 }
  }), /不能操作/);
  assert.throws(() => validateFullMoveStart({
    ...base,
    playerId: 'player-1',
    message: { player: 1, chessIndex: 0, fromPosition: 16, diceValue: 6 }
  }), /骰值/);
  assert.throws(() => validateFullMoveStart({
    ...base,
    playerId: 'player-1',
    message: { player: 1, chessIndex: 0, fromPosition: 15, diceValue: 4 }
  }), /起点/);
});

test('final move result only accepts the pending controller and a reachable position', () => {
  const session = createSession();
  session.gameData._pendingMove = validateFullMoveStart({
    session,
    playerId: 'player-1',
    message: { player: 1, chessIndex: 0, fromPosition: 16, diceValue: 4 },
    canControlPlayerColor
  });

  assert.throws(() => validateFinalMoveResult({
    session,
    playerId: 'player-2',
    message: { player: 1, chessIndex: 0, finalPosition: 20 },
    canControlPlayerColor
  }), /不能操作/);
  assert.throws(() => validateFinalMoveResult({
    session,
    playerId: 'player-1',
    message: { player: 1, chessIndex: 0, finalPosition: 56 },
    canControlPlayerColor
  }), /无法.*到达/);

  assert.equal(validateFinalMoveResult({
    session,
    playerId: 'player-1',
    message: { player: 1, chessIndex: 0, finalPosition: 20, beatenChesses: [{ player: 2, chessIndex: 0 }] },
    canControlPlayerColor
  }).finalPosition, 20);
});

test('a piece may finish only when the pending move reaches 56', () => {
  const session = createSession();
  session.gameData.diceValue = 1;
  session.gameData.playerChess[1][0].position = 55;
  session.gameData._pendingMove = validateFullMoveStart({
    session,
    playerId: 'player-1',
    message: { player: 1, chessIndex: 0, fromPosition: 55, diceValue: 1 },
    canControlPlayerColor
  });

  assert.equal(validateFinalMoveResult({
    session,
    playerId: 'player-1',
    message: { player: 1, chessIndex: 0, finalPosition: 56 },
    canControlPlayerColor
  }).finalPosition, 56);
});

test('final result accepts a captured piece whose home animation arrived first', () => {
  const session = createSession();
  session.gameData._pendingMove = validateFullMoveStart({
    session,
    playerId: 'player-1',
    message: { player: 1, chessIndex: 0, fromPosition: 16, diceValue: 4 },
    canControlPlayerColor
  });
  session.gameData.playerChess[2][0].position = -1;

  const result = validateFinalMoveResult({
    session,
    playerId: 'player-1',
    message: {
      player: 1,
      chessIndex: 0,
      finalPosition: 20,
      beatenChesses: [{ player: 2, chessIndex: 0 }]
    },
    canControlPlayerColor
  });

  assert.deepEqual(result.beatenChesses, [{ player: 2, chessIndex: 0 }]);
});

test('an exact collision with an enemy stack may send every involved piece home', () => {
  const session = createSession();
  session.gameData.playerChess[2][1].position = 7;
  session.gameData._pendingMove = validateFullMoveStart({
    session,
    playerId: 'player-1',
    message: { player: 1, chessIndex: 0, fromPosition: 16, diceValue: 4 },
    canControlPlayerColor
  });

  const result = validateFinalMoveResult({
    session,
    playerId: 'player-1',
    message: {
      player: 1,
      chessIndex: 0,
      finalPosition: -1,
      beatenChesses: [
        { player: 1, chessIndex: 0 },
        { player: 2, chessIndex: 0 },
        { player: 2, chessIndex: 1 }
      ]
    },
    canControlPlayerColor
  });

  assert.equal(result.finalPosition, -1);
  assert.deepEqual(result.beatenChesses, [
    { player: 2, chessIndex: 0 },
    { player: 2, chessIndex: 1 }
  ]);
});
