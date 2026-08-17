const test = require('node:test');
const assert = require('node:assert/strict');

const { createRewardMessageHandler } = require('../services/rewardMessageHandler.cjs');

const USER_ID = 'dc16af26-51f8-4d78-a1c4-4e8c71e04b1c';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function createSession(overrides = {}) {
  let sequence = 0;
  return {
    matchId: '10000000-0000-4000-8000-000000000001',
    matchPersistenceReady: Promise.resolve(true),
    pieceCount: 4,
    happyMode: false,
    rewardFactsSeen: new Map(),
    players: new Map([
      ['controller', { id: 'controller', color: 1, accountUserId: USER_ID, isAI: false }],
      ['target', { id: 'target', color: 2, accountUserId: null, isAI: false }]
    ]),
    gameData: {
      diceValue: 4,
      _pendingMove: { player: 1, chessIndex: 0, fromPosition: 16, diceValue: 4, timestamp: 12345 },
      playerChess: {
        1: [{ position: 16, finished: false }],
        2: [{ position: 7, finished: false }]
      }
    },
    nextEventSequence() { sequence += 1; return sequence; },
    ...overrides
  };
}

test('pending points are sent before delayed match persistence and award work', async () => {
  const ready = deferred();
  const sends = [];
  const enqueued = [];
  const session = createSession({ matchPersistenceReady: ready.promise });
  const handler = createRewardMessageHandler({
    pointsService: {
      previewReward: () => ({ amount: 55, idempotencyKey: 'preview-key' }),
      enqueue(input) { enqueued.push(input); }
    },
    sendToPlayer: (_playerId, payload) => sends.push(payload),
    canControlPlayerColor: () => true
  });

  handler.handle('controller', {
    eventType: 'plane_defeated',
    player: 1,
    targetPlayer: 2,
    targetPieceIndex: 0
  }, session);

  assert.equal(sends[0].type, 'accountPointsPending');
  assert.equal(enqueued.length, 0);
  ready.resolve(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(enqueued.length, 1);
});

test('successful persistence sends a balance reconciliation message', async () => {
  const sends = [];
  const handler = createRewardMessageHandler({
    pointsService: {
      previewReward: input => ({ amount: 47.61, idempotencyKey: `key-${input.sequenceNo}` }),
      enqueue(_input, callbacks) {
        callbacks.onSuccess({ amount: 47.61, balance: 147.61, duplicate: false, idempotencyKey: 'key-1' });
      }
    },
    sendToPlayer: (_playerId, payload) => sends.push(payload),
    canControlPlayerColor: () => true
  });

  handler.handle('controller', {
    eventType: 'plane_defeated', player: 1, targetPlayer: 2, targetPieceIndex: 0
  }, createSession());
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(sends.map(message => message.type), ['accountPointsPending', 'accountPointsUpdated']);
  assert.equal(sends[1].balance, 147.61);
});

test('a controller cannot claim another seat reward', () => {
  const handler = createRewardMessageHandler({
    pointsService: {},
    sendToPlayer() {},
    canControlPlayerColor: () => false
  });

  assert.throws(
    () => handler.handle('controller', {
      eventType: 'plane_defeated', player: 2, targetPlayer: 1, targetPieceIndex: 0
    }, createSession()),
    /不能操作这个玩家/
  );
});

test('AI actors never create account reward work', () => {
  let previewed = false;
  const session = createSession();
  session.players.set('bot', { id: 'bot', color: 3, accountUserId: null, isAI: true });
  session.gameData._pendingMove.player = 3;
  const handler = createRewardMessageHandler({
    pointsService: { previewReward() { previewed = true; } },
    sendToPlayer() {},
    canControlPlayerColor: () => true
  });

  const result = handler.handle('controller', {
    eventType: 'plane_defeated', player: 3, targetPlayer: 2, targetPieceIndex: 0
  }, session);

  assert.deepEqual(result, { skipped: true, reason: 'no_account' });
  assert.equal(previewed, false);
});

test('duplicate facts in the same move reuse one server sequence', async () => {
  let enqueued = 0;
  const session = createSession();
  const handler = createRewardMessageHandler({
    pointsService: {
      previewReward: input => ({ amount: 47.61, idempotencyKey: `key-${input.sequenceNo}` }),
      enqueue() { enqueued += 1; }
    },
    sendToPlayer() {},
    canControlPlayerColor: () => true
  });
  const message = { eventType: 'plane_defeated', player: 1, targetPlayer: 2, targetPieceIndex: 0 };

  const first = handler.handle('controller', message, session);
  const duplicate = handler.handle('controller', message, session);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(first.sequenceNo, duplicate.sequenceNo);
  assert.equal(enqueued, 1);
});

test('unsupported reward event types are rejected before deduplication', () => {
  const session = createSession({ happyMode: true });
  const handler = createRewardMessageHandler({
    pointsService: {},
    sendToPlayer() {},
    canControlPlayerColor: () => true
  });

  assert.throws(
    () => handler.handle('controller', {
      eventType: 'happy_collision:forged', player: 1, targetPlayer: 2,
      targetPieceIndex: 0, collisionPosition: 20
    }, session),
    /无效的积分事件/
  );
});

test('normal rewards must match a collision position reachable by the pending move', () => {
  const session = createSession();
  session.gameData.playerChess[2][0].position = 27;
  const handler = createRewardMessageHandler({
    pointsService: {},
    sendToPlayer() {},
    canControlPlayerColor: () => true
  });

  assert.throws(
    () => handler.handle('controller', {
      eventType: 'plane_defeated', player: 1, targetPlayer: 2, targetPieceIndex: 0
    }, session),
    /不在本次移动路径/
  );
});

test('normal rewards reject an enemy stack at the collision position', () => {
  const session = createSession();
  session.gameData.playerChess[2].push({ position: 7, finished: false });
  const handler = createRewardMessageHandler({
    pointsService: {},
    sendToPlayer() {},
    canControlPlayerColor: () => true
  });

  assert.throws(
    () => handler.handle('controller', {
      eventType: 'plane_defeated', player: 1, targetPlayer: 2, targetPieceIndex: 0
    }, session),
    /叠机不能作为普通击落奖励/
  );
});

test('happy rewards advance along the server-derived collision chain', () => {
  const session = createSession({ happyMode: true });
  const previews = [];
  const handler = createRewardMessageHandler({
    pointsService: {
      previewReward(input) {
        previews.push(input);
        return { amount: 20, idempotencyKey: `key-${input.sequenceNo}` };
      },
      enqueue() {}
    },
    sendToPlayer() {},
    canControlPlayerColor: () => true
  });

  handler.handle('controller', {
    eventType: 'happy_collision', player: 1, targetPlayer: 2,
    targetPieceIndex: 0, collisionPosition: 20
  }, session);

  assert.equal(previews.length, 1);
  assert.equal(session.gameData._pendingMove.rewardCursorPosition, 26);
});
