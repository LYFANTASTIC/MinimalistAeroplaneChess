'use strict';

const {
  getAbsolutePosition,
  getBaseLandingPosition,
  getNormalCollisionPositions,
  resolveHappyLanding
} = require('./rewardMessageHandler.cjs');

function findPlayerBySeat(session, seat) {
  return Array.from(session?.players?.values?.() || []).find(player => player.color === seat) || null;
}

function validateController(session, playerId, seat, canControlPlayerColor) {
  if (!findPlayerBySeat(session, seat)) throw new RangeError('无效的移动玩家');
  if (!canControlPlayerColor(session, playerId, seat)) throw new Error('当前账号不能操作这个玩家');
  if (session.gameData?.currentPlayer !== seat) throw new Error('当前不是这个玩家的回合');
}

function validateFullMoveStart({ session, playerId, message, canControlPlayerColor, now = Date.now }) {
  const seat = Number(message?.player);
  const chessIndex = Number(message?.chessIndex);
  const fromPosition = Number(message?.fromPosition);
  const diceValue = Number(message?.diceValue);
  validateController(session, playerId, seat, canControlPlayerColor);
  if (session.gameData?.gamePhase !== 'moving') throw new Error('当前不能开始移动');
  if (session.gameData?._pendingMove || session.gameData?.diceValueConsumed) {
    throw new Error('本次移动已经开始');
  }
  if (!Number.isInteger(diceValue) || diceValue !== Number(session.gameData?.diceValue)) {
    throw new RangeError('移动骰值与服务器骰值不一致');
  }
  if (!Number.isInteger(chessIndex) || chessIndex < 0 || chessIndex >= session.pieceCount) {
    throw new RangeError('无效的棋子编号');
  }
  const piece = session.gameData?.playerChess?.[seat]?.[chessIndex];
  if (!piece || piece.finished || piece.position !== fromPosition) {
    throw new RangeError('移动起点与服务器棋盘不一致');
  }
  const pendingMove = { seat, chessIndex, fromPosition, diceValue };
  const targetPosition = getBaseLandingPosition(pendingMove);
  return {
    player: seat,
    chessIndex,
    fromPosition,
    diceValue,
    targetPosition,
    timestamp: now()
  };
}

function allowedFinalPositions(pendingMove) {
  const baseLanding = getBaseLandingPosition(pendingMove);
  const positions = new Set([baseLanding, resolveHappyLanding(baseLanding)]);
  if (baseLanding === 14) positions.add(18);
  if (baseLanding === 18) {
    positions.add(22);
    positions.add(30);
  }
  if (Number.isInteger(pendingMove.rewardCursorPosition)) positions.add(pendingMove.rewardCursorPosition);
  return { baseLanding, positions };
}

function stackPiecesAtPosition(session, actorSeat, actorPosition) {
  const absolutePosition = getAbsolutePosition(actorSeat, actorPosition);
  const matches = [];
  for (const player of session.players.values()) {
    if (player.color === actorSeat) continue;
    const pieces = session.gameData?.playerChess?.[player.color] || [];
    pieces.forEach((piece, chessIndex) => {
      if (piece && !piece.finished && piece.position >= 0 && piece.position < 51
        && getAbsolutePosition(player.color, piece.position) === absolutePosition) {
        matches.push({ player: player.color, chessIndex });
      }
    });
  }
  return matches;
}

function addStackBounceOutcomes(session, pendingMove, positions) {
  if (session.happyMode || pendingMove.fromPosition < 0) return;
  for (let step = 1; step <= pendingMove.diceValue; step += 1) {
    const collisionPosition = pendingMove.fromPosition + step;
    if (collisionPosition > 50) break;
    if (stackPiecesAtPosition(session, pendingMove.player, collisionPosition).length < 2) continue;
    const remainingSteps = pendingMove.diceValue - step;
    if (remainingSteps > 0) positions.add(Math.max(0, collisionPosition - remainingSteps));
    break;
  }
}

function validateBeatenChesses(session, actorSeat, baseLanding, beatenChesses) {
  if (beatenChesses == null) return [];
  if (!Array.isArray(beatenChesses)) throw new RangeError('无效的被撞棋子列表');
  if (session.happyMode && beatenChesses.length > 0) throw new RangeError('欢乐模式不会击落棋子');
  const collisionPositions = getNormalCollisionPositions(actorSeat, baseLanding);
  const seen = new Set();
  return beatenChesses.map(entry => {
    const seat = Number(entry?.player);
    const chessIndex = Number(entry?.chessIndex);
    const key = `${seat}:${chessIndex}`;
    if (seat === actorSeat || !findPlayerBySeat(session, seat)
      || !Number.isInteger(chessIndex) || chessIndex < 0 || chessIndex >= session.pieceCount
      || seen.has(key)) {
      throw new RangeError('无效的被撞棋子');
    }
    const piece = session.gameData?.playerChess?.[seat]?.[chessIndex];
    if (piece && !piece.finished && piece.position === -1) {
      seen.add(key);
      return { player: seat, chessIndex };
    }
    if (!piece || piece.finished || piece.position < 0
      || !collisionPositions.has(getAbsolutePosition(seat, piece.position))) {
      throw new RangeError('被撞棋子不在本次移动路径');
    }
    seen.add(key);
    return { player: seat, chessIndex };
  });
}

function validateFinalMoveResult({ session, playerId, message, canControlPlayerColor }) {
  const pendingMove = session.gameData?._pendingMove;
  if (!pendingMove) throw new Error('当前没有待完成的移动');
  const seat = Number(message?.player);
  const chessIndex = Number(message?.chessIndex);
  validateController(session, playerId, seat, canControlPlayerColor);
  if (pendingMove.player !== seat || pendingMove.chessIndex !== chessIndex) {
    throw new Error('最终结果与待完成移动不一致');
  }
  const finalPosition = Number(message?.finalPosition);
  const { baseLanding, positions } = allowedFinalPositions(pendingMove);
  addStackBounceOutcomes(session, pendingMove, positions);
  if (session.happyMode && pendingMove.fromPosition >= 0
    && pendingMove.fromPosition + pendingMove.diceValue > 56) {
    positions.add(56);
  }
  if (!Number.isInteger(finalPosition) || (finalPosition !== -1 && !positions.has(finalPosition))) {
    throw new RangeError('最终位置无法由本次移动到达');
  }
  if (finalPosition === -1) {
    if (session.happyMode) throw new RangeError('欢乐模式不会发生叠子撞毁');
    const actorListed = Array.isArray(message?.beatenChesses)
      && message.beatenChesses.some(entry => Number(entry?.player) === seat && Number(entry?.chessIndex) === chessIndex);
    const stackPieces = stackPiecesAtPosition(session, seat, baseLanding);
    if (!actorListed || stackPieces.length < 2) throw new RangeError('本次移动不会发生叠子撞毁');
    return {
      player: seat,
      chessIndex,
      finalPosition,
      beatenChesses: stackPieces,
      pendingMove
    };
  }
  return {
    player: seat,
    chessIndex,
    finalPosition,
    beatenChesses: validateBeatenChesses(
      session,
      seat,
      baseLanding,
      message?.beatenChesses
    ),
    pendingMove
  };
}

module.exports = {
  allowedFinalPositions,
  validateFinalMoveResult,
  validateFullMoveStart
};
