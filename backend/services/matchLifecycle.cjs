'use strict';

function getTeamNo(session, seat) {
  if (!session.teamMode || !Array.isArray(session.teams)) return null;
  const index = session.teams.findIndex(team => Array.isArray(team) && team.includes(seat));
  return index === -1 ? null : index + 1;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function sumCounts(value) {
  if (!value || typeof value !== 'object') return 0;
  return Object.values(value).reduce((sum, count) => sum + nonNegativeInteger(count), 0);
}

function normalizeTitles(value) {
  if (Array.isArray(value)) return value.filter(title => typeof title === 'string' && title.trim()).map(title => title.trim());
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function buildMatchRecord(session) {
  return {
    id: session.matchId,
    roomCode: session.roomCode,
    happyMode: !!session.happyMode,
    teamMode: !!session.teamMode,
    pieceCount: session.pieceCount,
    launchNumber: session.launchNumber,
    startedAt: new Date(session.createdAt).toISOString(),
    players: Array.from(session.players.values()).map(player => ({
      userId: player.isAI ? null : (player.accountUserId || null),
      seat: player.color,
      teamNo: getTeamNo(session, player.color),
      isAi: !!player.isAI,
      displayName: String(player.nickname || `玩家_${player.color}`).slice(0, 32)
    }))
  };
}

function getPlacementOrder(session, message) {
  const players = Array.from(session.players.values());
  const winnerSeat = Number(message.winnerPlayer);
  const chessBySeat = session.gameData?.playerChess || {};
  const progressBySeat = new Map(players.map(player => {
    const pieces = Array.isArray(chessBySeat[player.color]) ? chessBySeat[player.color] : [];
    return [player.color, {
      finished: pieces.filter(piece => piece?.finished || piece?.position === 56).length,
      total: pieces.reduce((sum, piece) => sum + Math.max(0, Number(piece?.position) || 0), 0)
    }];
  }));
  return players
    .map(player => player.color)
    .sort((left, right) => {
      if (left === winnerSeat) return -1;
      if (right === winnerSeat) return 1;
      const leftProgress = progressBySeat.get(left);
      const rightProgress = progressBySeat.get(right);
      return rightProgress.finished - leftProgress.finished
        || rightProgress.total - leftProgress.total
        || left - right;
    });
}

function buildSettlementRecord(session, message, endReason) {
  const endedTimestamp = Number(message.timestamp);
  const endedAtMs = Number.isFinite(endedTimestamp) && endedTimestamp >= session.createdAt
    ? endedTimestamp
    : Date.now();
  const order = getPlacementOrder(session, message);
  const winnerSeat = Number.isInteger(Number(message.winnerPlayer))
    ? Number(message.winnerPlayer)
    : order[0];
  const winnerPlayer = Array.from(session.players.values()).find(player => player.color === winnerSeat);
  const winnerTeamNo = getTeamNo(session, winnerSeat);
  const defeatCounts = session.gameData?.defeatCounts || {};
  const diceStatistics = session.gameData?.diceStatistics || {};

  return {
    matchId: session.matchId,
    endReason,
    endedAt: new Date(endedAtMs).toISOString(),
    durationMs: Math.max(0, Math.floor(endedAtMs - session.createdAt)),
    winnerUserId: winnerPlayer?.isAI ? null : (winnerPlayer?.accountUserId || null),
    winnerTeamNo,
    sequenceNo: session.nextEventSequence(),
    players: Array.from(session.players.values()).map(player => {
      const teamNo = getTeamNo(session, player.color);
      return {
        userId: player.isAI ? null : (player.accountUserId || null),
        seat: player.color,
        placement: Math.max(1, order.indexOf(player.color) + 1),
        isWinner: session.teamMode ? teamNo === winnerTeamNo : player.color === winnerSeat,
        planesDefeated: sumCounts(defeatCounts[player.color]),
        happyCollisions: 0,
        movementDistance: 0,
        bounceDistance: 0,
        diceStatistics: diceStatistics[player.color] || {},
        titles: []
      };
    })
  };
}

module.exports = {
  buildMatchRecord,
  buildSettlementRecord,
  getTeamNo,
  normalizeTitles,
  sumCounts
};
