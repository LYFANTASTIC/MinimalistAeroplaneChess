'use strict';

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

function buildPlaneDefeatInput(gameSession, actorPlayer, message, sequenceNo) {
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

function buildHappyCollisionInput(gameSession, actorPlayer, message, sequenceNo) {
  if (!gameSession.happyMode) throw new RangeError('普通模式不能上报欢乐碰撞');
  const targetSeat = Number(message.targetPlayer);
  const collisionPosition = Number(message.collisionPosition);
  const targetPlayer = findPlayerBySeat(gameSession, targetSeat);
  if (!targetPlayer || targetSeat === actorPlayer.color) throw new RangeError('无效的碰撞玩家');
  if (!Number.isInteger(collisionPosition) || collisionPosition < 0 || collisionPosition > 50) {
    throw new RangeError('无效的碰撞位置');
  }

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
      ? buildPlaneDefeatInput(gameSession, actorPlayer, message, sequenceNo)
      : buildHappyCollisionInput(gameSession, actorPlayer, message, sequenceNo);
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

    Promise.resolve(gameSession.matchPersistenceReady).then(ready => {
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
  getAbsolutePosition
};
