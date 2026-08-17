'use strict';

function findPlayerBySeat(session, seat) {
  return Array.from(session?.players?.values?.() || []).find(player => player.color === seat) || null;
}

function isSeatComplete(session, seat) {
  const pieces = session?.gameData?.playerChess?.[seat];
  return Array.isArray(pieces)
    && pieces.length === session.pieceCount
    && pieces.every(piece => piece?.finished === true || piece?.position === 56);
}

function authorizeNormalSettlement({ session, playerId, message, canControlPlayerColor, now = Date.now }) {
  const winnerSeat = Number(message?.winnerPlayer);
  if (!Number.isInteger(winnerSeat) || !findPlayerBySeat(session, winnerSeat)) {
    throw new RangeError('无效的获胜玩家');
  }
  if (!canControlPlayerColor(session, playerId, winnerSeat)) {
    throw new Error('当前账号不能结算这个玩家');
  }
  if (!isSeatComplete(session, winnerSeat)) {
    throw new Error('获胜玩家尚未完成全部棋子');
  }
  return { winnerPlayer: winnerSeat, timestamp: now() };
}

function authorizeForcedSettlement({ session, playerId, now = Date.now }) {
  if (!session || session.hostId !== playerId) throw new Error('只有房主可以强制结算');
  return { timestamp: now() };
}

module.exports = {
  authorizeForcedSettlement,
  authorizeNormalSettlement,
  isSeatComplete
};
