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
  if (Array.isArray(message.rankings) && message.rankings.length > 0) {
    return message.rankings
      .map(ranking => Number(ranking.playerNumber ?? ranking.player))
      .filter(Number.isInteger);
  }

  const players = Array.from(session.players.values());
  const winnerSeat = Number(message.winnerPlayer);
  const latestProgress = session.gameData?.progressHistory?.at(-1)?.players || {};
  return players
    .map(player => player.color)
    .sort((left, right) => {
      if (left === winnerSeat) return -1;
      if (right === winnerSeat) return 1;
      return Number(latestProgress[right] || 0) - Number(latestProgress[left] || 0);
    });
}

function buildSettlementRecord(session, message, endReason) {
  const endedTimestamp = Number(message.timestamp);
  const endedAtMs = Number.isFinite(endedTimestamp) && endedTimestamp >= session.createdAt
    ? endedTimestamp
    : Date.now();
  const order = getPlacementOrder(session, message);
  const rankingBySeat = new Map(
    (Array.isArray(message.rankings) ? message.rankings : [])
      .map(ranking => [Number(ranking.playerNumber ?? ranking.player), ranking])
  );
  const winnerSeat = Number.isInteger(Number(message.winnerPlayer))
    ? Number(message.winnerPlayer)
    : order[0];
  const winnerPlayer = Array.from(session.players.values()).find(player => player.color === winnerSeat);
  const winnerTeamNo = getTeamNo(session, winnerSeat);
  const titleStats = message.titleStats || {};
  const defeatCounts = titleStats.defeatCounts || session.gameData?.defeatCounts || {};
  const diceStatistics = titleStats.diceStatistics || session.gameData?.diceStatistics || {};

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
      const ranking = rankingBySeat.get(player.color);
      return {
        userId: player.isAI ? null : (player.accountUserId || null),
        seat: player.color,
        placement: Math.max(1, order.indexOf(player.color) + 1),
        isWinner: session.teamMode ? teamNo === winnerTeamNo : player.color === winnerSeat,
        planesDefeated: sumCounts(defeatCounts[player.color]),
        happyCollisions: 0,
        movementDistance: nonNegativeInteger(titleStats.totalDistance?.[player.color]),
        bounceDistance: nonNegativeInteger(titleStats.bounceSteps?.[player.color]),
        diceStatistics: diceStatistics[player.color] || {},
        titles: normalizeTitles(ranking?.title ?? ranking?.titles)
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
