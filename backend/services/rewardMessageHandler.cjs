'use strict';

const REWARD_EVENT_TYPES = new Set(['plane_defeated', 'happy_collision']);
const JUMP_POINTS = [2, 6, 10, 14, 18, 22, 26, 30, 34, 38, 42, 46];

function getAbsolutePosition(player, relativePosition) {
  if (relativePosition === -1) return -1;
  if (relativePosition >= 51 || relativePosition === 0) return relativePosition;
  if (player === 1) return relativePosition;
  if (player === 4) {
    if (relativePosition >= 14) return relativePosition - 13;
    if (relativePosition <= 11) return relativePosition + 39;
    return relativePosition === 12 ? -3 : -2;
  }
  if (player === 3) {
    if (relativePosition <= 24) return relativePosition + 26;
    if (relativePosition === 25) return -3;
    if (relativePosition === 26) return -2;
    return relativePosition - 26;
  }
  if (player === 2) {
    if (relativePosition <= 37) return relativePosition + 13;
    if (relativePosition === 38) return -3;
    if (relativePosition === 39) return -2;
    return relativePosition - 39;
  }
  return -1;
}

function calculatePieceProgress(piece) {
  if (!piece || piece.position < 0) throw new RangeError('被撞棋子不在棋盘上');
  if (piece.finished) return 100;
  return Math.min(100, Math.max(0, Number(piece.position) / 57 * 100));
}

function findPlayerBySeat(gameSession, seat) {
  return Array.from(gameSession.players.values()).find(player => player.color === seat) || null;
}

function nextJumpPoint(position) {
  if (position === 46) return 50;
  return JUMP_POINTS.find(candidate => candidate > position) ?? null;
}

function getBaseLandingPosition(pendingMove) {
  const fromPosition = Number(pendingMove?.fromPosition);
  const diceValue = Number(pendingMove?.diceValue);
  if (!Number.isInteger(fromPosition) || fromPosition < -1 || fromPosition > 56) {
    throw new RangeError('无效的移动起点');
  }
  if (!Number.isInteger(diceValue) || diceValue < 1 || diceValue > 6) {
    throw new RangeError('无效的移动骰值');
  }
  if (fromPosition === -1) return 0;
  const forward = fromPosition + diceValue;
  return forward > 56 ? Math.max(0, 112 - forward) : forward;
}

function resolveHappyLanding(position) {
  if (position === 14) return 30;
  if (position === 18) return 34;
  if (JUMP_POINTS.includes(position)) return nextJumpPoint(position) ?? position;
  return position;
}

function validatePendingMove(gameSession, actorPlayer, pendingMove) {
  const actorPiece = gameSession.gameData?.playerChess?.[actorPlayer.color]?.[pendingMove.chessIndex];
  if (!actorPiece || actorPiece.finished || actorPiece.position !== pendingMove.fromPosition) {
    throw new RangeError('移动起点与服务器棋盘不一致');
  }
  if (Number(gameSession.gameData?.diceValue) !== Number(pendingMove.diceValue)) {
    throw new RangeError('移动骰值与服务器状态不一致');
  }
  return getBaseLandingPosition(pendingMove);
}

function getNormalCollisionPositions(actorSeat, baseLanding) {
  const positions = new Set([baseLanding]);
  if (baseLanding === 14) {
    positions.add(18);
    positions.add(30);
  } else if (baseLanding === 18) {
    positions.add(30);
    positions.add(34);
  } else if (JUMP_POINTS.includes(baseLanding)) {
    const next = nextJumpPoint(baseLanding);
    if (next != null) positions.add(next);
  }
  return new Set(Array.from(positions, position => getAbsolutePosition(actorSeat, position)));
}

function buildPlaneDefeatInput(gameSession, actorPlayer, message, sequenceNo, baseLanding) {
  if (gameSession.happyMode) throw new RangeError('欢乐模式不能上报普通撞机');
  const targetSeat = Number(message.targetPlayer);
  const targetPieceIndex = Number(message.targetPieceIndex);
  if (!Number.isInteger(targetSeat) || targetSeat === actorPlayer.color) throw new RangeError('无效的被撞玩家');
  if (!Number.isInteger(targetPieceIndex) || targetPieceIndex < 0 || targetPieceIndex >= gameSession.pieceCount) {
    throw new RangeError('无效的被撞棋子');
  }
  const targetPlayer = findPlayerBySeat(gameSession, targetSeat);
  const targetPiece = gameSession.gameData?.playerChess?.[targetSeat]?.[targetPieceIndex];
  if (!targetPlayer || !targetPiece) throw new RangeError('被撞棋子不存在');
  const targetAbsolutePosition = getAbsolutePosition(targetSeat, targetPiece.position);
  if (!getNormalCollisionPositions(actorPlayer.color, baseLanding).has(targetAbsolutePosition)) {
    throw new RangeError('被撞棋子不在本次移动路径');
  }

  return {
    matchId: gameSession.matchId,
    sequenceNo,
    userId: actorPlayer.accountUserId,
    targetUserId: targetPlayer.isAI ? null : (targetPlayer.accountUserId || null),
    targetPieceIndex,
    eventType: 'plane_defeated',
    pieceCount: gameSession.pieceCount,
    progressBefore: calculatePieceProgress(targetPiece),
    progressAfter: 0,
    metadata: { actorSeat: actorPlayer.color, targetSeat }
  };
}

function buildHappyCollisionInput(gameSession, actorPlayer, message, sequenceNo, baseLanding, pendingMove) {
  if (!gameSession.happyMode) throw new RangeError('普通模式不能上报欢乐碰撞');
  const targetSeat = Number(message.targetPlayer);
  const collisionPosition = Number(message.collisionPosition);
  const targetPlayer = findPlayerBySeat(gameSession, targetSeat);
  if (!targetPlayer || targetSeat === actorPlayer.color) throw new RangeError('无效的碰撞玩家');
  if (!Number.isInteger(collisionPosition) || collisionPosition < 0 || collisionPosition > 50) {
    throw new RangeError('无效的碰撞位置');
  }

  const expectedPosition = pendingMove.rewardCursorPosition ?? resolveHappyLanding(baseLanding);
  if (collisionPosition !== expectedPosition) throw new RangeError('碰撞位置不在本次移动路径');

  const absolutePosition = getAbsolutePosition(actorPlayer.color, collisionPosition);
  const targetPieces = gameSession.gameData?.playerChess?.[targetSeat] || [];
  const matchingIndexes = [];
  targetPieces.forEach((piece, index) => {
    if (piece && !piece.finished && piece.position >= 0 && piece.position < 51
      && getAbsolutePosition(targetSeat, piece.position) === absolutePosition) {
      matchingIndexes.push(index);
    }
  });
  if (matchingIndexes.length === 0) throw new RangeError('服务器未确认到碰撞棋子');
  pendingMove.rewardCursorPosition = resolveHappyLanding(
    Math.min(56, collisionPosition + Math.max(2, matchingIndexes.length * 2))
  );

  return {
    matchId: gameSession.matchId,
    sequenceNo,
    userId: actorPlayer.accountUserId,
    targetUserId: targetPlayer.isAI ? null : (targetPlayer.accountUserId || null),
    targetPieceIndex: matchingIndexes[0],
    eventType: 'happy_collision',
    enemyPieceCount: matchingIndexes.length,
    metadata: {
      actorSeat: actorPlayer.color,
      targetSeat,
      collisionPosition,
      targetPieceIndexes: matchingIndexes
    }
  };
}

function createRewardMessageHandler({ pointsService, sendToPlayer, canControlPlayerColor }) {
  function handle(controllerPlayerId, message, gameSession) {
    if (!REWARD_EVENT_TYPES.has(message.eventType)) throw new RangeError('无效的积分事件');
    const actorSeat = Number(message.player);
    if (!canControlPlayerColor(gameSession, controllerPlayerId, actorSeat)) {
      throw new Error('当前账号不能操作这个玩家');
    }
    const pendingMove = gameSession.gameData?._pendingMove;
    if (!pendingMove || pendingMove.player !== actorSeat) throw new Error('当前没有可确认的移动');

    const actorPlayer = findPlayerBySeat(gameSession, actorSeat);
    if (!actorPlayer || actorPlayer.isAI || !actorPlayer.accountUserId) {
      return { skipped: true, reason: 'no_account' };
    }
    const baseLanding = validatePendingMove(gameSession, actorPlayer, pendingMove);

    const targetSeat = Number(message.targetPlayer);
    const factSuffix = message.eventType === 'happy_collision'
      ? `${message.collisionPosition}`
      : `${message.targetPieceIndex}`;
    const factKey = `${pendingMove.timestamp}:${message.eventType}:${actorSeat}:${targetSeat}:${factSuffix}`;
    gameSession.rewardFactsSeen ||= new Map();
    const duplicate = gameSession.rewardFactsSeen.get(factKey);
    if (duplicate) {
      sendToPlayer(actorPlayer.id, duplicate.pendingPayload);
      return duplicate.pendingPayload;
    }

    const sequenceNo = gameSession.nextEventSequence();
    const input = message.eventType === 'plane_defeated'
      ? buildPlaneDefeatInput(gameSession, actorPlayer, message, sequenceNo, baseLanding)
      : buildHappyCollisionInput(gameSession, actorPlayer, message, sequenceNo, baseLanding, pendingMove);
    const preview = pointsService.previewReward(input);
    const pendingPayload = {
      type: 'accountPointsPending',
      player: actorSeat,
      amount: preview.amount,
      matchId: gameSession.matchId,
      sequenceNo,
      idempotencyKey: preview.idempotencyKey
    };
    gameSession.rewardFactsSeen.set(factKey, { input, pendingPayload });
    sendToPlayer(actorPlayer.id, pendingPayload);

    const matchReady = typeof gameSession.ensureMatchPersistence === 'function'
      ? gameSession.ensureMatchPersistence()
      : gameSession.matchPersistenceReady;
    Promise.resolve(matchReady).then(ready => {
      if (!ready) {
        sendToPlayer(actorPlayer.id, {
          type: 'accountPointsSyncFailed',
          matchId: gameSession.matchId,
          sequenceNo,
          idempotencyKey: preview.idempotencyKey
        });
        return;
      }
      pointsService.enqueue(input, {
        onSuccess(result) {
          if (result.skipped) return;
          sendToPlayer(actorPlayer.id, {
            type: 'accountPointsUpdated',
            player: actorSeat,
            amount: result.amount,
            balance: result.balance,
            duplicate: result.duplicate,
            matchId: gameSession.matchId,
            sequenceNo,
            idempotencyKey: result.idempotencyKey
          });
        },
        onFailure(error) {
          sendToPlayer(actorPlayer.id, {
            type: 'accountPointsSyncFailed',
            matchId: gameSession.matchId,
            sequenceNo,
            idempotencyKey: preview.idempotencyKey,
            retryable: !!error
          });
        }
      });
    });

    return pendingPayload;
  }

  return { handle };
}

module.exports = {
  buildHappyCollisionInput,
  buildPlaneDefeatInput,
  calculatePieceProgress,
  createRewardMessageHandler,
  getAbsolutePosition,
  getNormalCollisionPositions,
  resolveHappyLanding
};
