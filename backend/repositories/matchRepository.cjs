'use strict';

const { getPool } = require('../db/pool.cjs');
const { toFiniteNumber, toSafeInteger } = require('./userRepository.cjs');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class CursorError extends Error {
  constructor() {
    super('无效的分页游标');
    this.name = 'CursorError';
  }
}

function normalizeCursor(value) {
  if (!value || typeof value !== 'object' || !UUID_PATTERN.test(String(value.id || ''))) {
    throw new CursorError();
  }
  const date = new Date(value.createdAt);
  if (!Number.isFinite(date.getTime())) throw new CursorError();
  return { createdAt: date.toISOString(), id: String(value.id) };
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(normalizeCursor(value)), 'utf8').toString('base64url');
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    return normalizeCursor(JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8')));
  } catch (error) {
    if (error instanceof CursorError) throw error;
    throw new CursorError();
  }
}

function isoOrNull(value) {
  return value == null ? null : new Date(value).toISOString();
}

function mapMatch(row) {
  return {
    id: row.match_id,
    status: row.status,
    endReason: row.end_reason,
    happyMode: row.happy_mode,
    teamMode: row.team_mode,
    pieceCount: row.piece_count,
    startedAt: isoOrNull(row.started_at),
    endedAt: isoOrNull(row.ended_at),
    durationMs: row.duration_ms == null ? null : toSafeInteger(row.duration_ms, 'duration_ms'),
    placement: row.placement,
    planesDefeated: toSafeInteger(row.planes_defeated, 'planes_defeated'),
    happyCollisions: toSafeInteger(row.happy_collisions, 'happy_collisions'),
    accountPointsEarned: toFiniteNumber(row.account_points_earned, 'account_points_earned'),
    titles: Array.isArray(row.titles) ? row.titles : []
  };
}

function mapPointsEntry(row) {
  return {
    id: row.id,
    amount: toFiniteNumber(row.amount, 'amount'),
    reason: row.reason,
    balanceAfter: toFiniteNumber(row.balance_after, 'balance_after'),
    matchId: row.match_id,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    createdAt: isoOrNull(row.created_at)
  };
}

function createMatchRepository({ poolProvider = getPool } = {}) {
  return {
    async getUserMatches(userId, { limit, cursor = null }) {
      const params = cursor
        ? [userId, cursor.createdAt, cursor.id, limit + 1]
        : [userId, limit + 1];
      const cursorClause = cursor ? 'AND (m.started_at, mp.id) < ($2, $3)' : '';
      const limitParameter = cursor ? '$4' : '$2';
      const { rows } = await poolProvider().query(
        `SELECT mp.id AS row_id, mp.match_id, mp.placement, mp.planes_defeated,
                mp.happy_collisions, mp.account_points_earned, mp.titles,
                m.status, m.end_reason, m.happy_mode, m.team_mode, m.piece_count,
                m.started_at, m.ended_at, m.duration_ms
         FROM app.match_players mp
         JOIN app.matches m ON m.id = mp.match_id
         WHERE mp.user_id = $1
         ${cursorClause}
         ORDER BY m.started_at DESC, mp.id DESC
         LIMIT ${limitParameter}`,
        params
      );
      const pageRows = rows.slice(0, limit);
      const lastRow = pageRows.at(-1);
      return {
        items: pageRows.map(mapMatch),
        nextCursor: rows.length > limit && lastRow
          ? encodeCursor({ createdAt: lastRow.started_at, id: lastRow.row_id })
          : null
      };
    },

    async getUserPoints(userId, { limit, cursor = null }) {
      const params = cursor
        ? [userId, cursor.createdAt, cursor.id, limit + 1]
        : [userId, limit + 1];
      const cursorClause = cursor ? 'AND (created_at, id) < ($2, $3)' : '';
      const limitParameter = cursor ? '$4' : '$2';
      const { rows } = await poolProvider().query(
        `SELECT id, amount, reason, balance_after, match_id, metadata, created_at
         FROM app.points_ledger
         WHERE user_id = $1
         ${cursorClause}
         ORDER BY created_at DESC, id DESC
         LIMIT ${limitParameter}`,
        params
      );
      const pageRows = rows.slice(0, limit);
      const lastRow = pageRows.at(-1);
      return {
        items: pageRows.map(mapPointsEntry),
        nextCursor: rows.length > limit && lastRow
          ? encodeCursor({ createdAt: lastRow.created_at, id: lastRow.id })
          : null
      };
    }
  };
}

module.exports = {
  CursorError,
  createMatchRepository,
  decodeCursor,
  encodeCursor,
  mapMatch,
  mapPointsEntry
};

