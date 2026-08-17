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

function leaderSeat(players, valueForSeat) {
  return players
    .map(player => ({ seat: player.color, value: nonNegativeInteger(valueForSeat(player.color)) }))
    .sort((left, right) => right.value - left.value || left.seat - right.seat)[0];
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
  const movementDistance = session.gameData?.movementDistance || {};
  const bounceDistance = session.gameData?.bounceDistance || {};
  const players = Array.from(session.players.values());
  const marathon = leaderSeat(players, seat => movementDistance[seat]);
  const sixMaster = leaderSeat(players, seat => diceStatistics[seat]?.[6]);
  const killer = leaderSeat(players, seat => sumCounts(defeatCounts[seat]));

  return {
    matchId: session.matchId,
    endReason,
    endedAt: new Date(endedAtMs).toISOString(),
    durationMs: Math.max(0, Math.floor(endedAtMs - session.createdAt)),
    winnerUserId: winnerPlayer?.isAI ? null : (winnerPlayer?.accountUserId || null),
    winnerTeamNo,
    sequenceNo: session.nextEventSequence(),
    players: players.map(player => {
      const teamNo = getTeamNo(session, player.color);
      const placement = Math.max(1, order.indexOf(player.color) + 1);
      const titles = [];
      if (placement === 1) titles.push('棋王');
      if (marathon?.seat === player.color && marathon.value > 0) titles.push('长跑冠军');
      if (sixMaster?.seat === player.color && sixMaster.value > 0) titles.push('六点狂魔');
      if (killer?.seat === player.color && killer.value > 0) titles.push('收割者');
      if (nonNegativeInteger(bounceDistance[player.color]) > 50) titles.push('逆风行者');
      if (titles.length === 0) titles.push('平凡棋手');
      return {
        userId: player.isAI ? null : (player.accountUserId || null),
        seat: player.color,
        placement,
        isWinner: session.teamMode ? teamNo === winnerTeamNo : player.color === winnerSeat,
        planesDefeated: sumCounts(defeatCounts[player.color]),
        happyCollisions: 0,
        movementDistance: nonNegativeInteger(movementDistance[player.color]),
        bounceDistance: nonNegativeInteger(bounceDistance[player.color]),
        diceStatistics: diceStatistics[player.color] || {},
        titles
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
