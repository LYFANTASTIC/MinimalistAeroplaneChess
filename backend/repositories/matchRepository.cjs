'use strict';

const { getPool, withTransaction } = require('../db/pool.cjs');
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

function createMatchRepository({
  poolProvider = getPool,
  transactionRunner = withTransaction
} = {}) {
  return {
    async createMatch(input) {
      return transactionRunner(poolProvider(), async client => {
        const { rows: [match] } = await client.query(
          `INSERT INTO app.matches
           (id, room_code, happy_mode, team_mode, piece_count, launch_number, started_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [
            input.id,
            input.roomCode,
            input.happyMode,
            input.teamMode,
            input.pieceCount,
            input.launchNumber,
            input.startedAt
          ]
        );

        for (const player of input.players) {
          await client.query(
            `INSERT INTO app.match_players
             (match_id, user_id, seat, team_no, is_ai, display_name_snapshot)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              match.id,
              player.userId,
              player.seat,
              player.teamNo,
              player.isAi,
              player.displayName
            ]
          );
        }
        return match.id;
      });
    },

    async settleMatch(input) {
      return transactionRunner(poolProvider(), async client => {
        const { rows: [settled] } = await client.query(
          `UPDATE app.matches
           SET status = 'finished', end_reason = $2, ended_at = $3, duration_ms = $4,
               winner_user_id = $5, winner_team_no = $6
           WHERE id = $1 AND status = 'playing'
           RETURNING id`,
          [
            input.matchId,
            input.endReason,
            input.endedAt,
            input.durationMs,
            input.winnerUserId,
            input.winnerTeamNo
          ]
        );
        if (!settled) return false;

        for (const player of input.players) {
          await client.query(
            `UPDATE app.match_players
             SET placement = $3, planes_defeated = $4, happy_collisions = $5,
                 movement_distance = $6, bounce_distance = $7,
                 dice_statistics = $8::jsonb, titles = $9::jsonb, finished_at = $10
             WHERE match_id = $1 AND seat = $2`,
            [
              input.matchId,
              player.seat,
              player.placement,
              player.planesDefeated,
              player.happyCollisions,
              player.movementDistance,
              player.bounceDistance,
              JSON.stringify(player.diceStatistics || {}),
              JSON.stringify(player.titles || []),
              input.endedAt
            ]
          );
          if (player.userId) {
            await client.query(
              `UPDATE app.user_stats
               SET games_played = games_played + 1,
                   games_won = games_won + $2,
                   updated_at = now()
               WHERE user_id = $1`,
              [player.userId, player.isWinner ? 1 : 0]
            );
          }
        }

        await client.query(
          `INSERT INTO app.match_events
           (match_id, sequence_no, event_type, actor_user_id, payload)
           VALUES ($1, $2, 'game_finished', $3, $4::jsonb)
           ON CONFLICT (match_id, sequence_no) DO NOTHING`,
          [
            input.matchId,
            input.sequenceNo,
            input.winnerUserId,
            JSON.stringify({ endReason: input.endReason })
          ]
        );
        return true;
      });
    },

    async abandonMatch(matchId, endReason = 'room_destroyed', endedAt = new Date().toISOString()) {
      const { rows: [row] } = await poolProvider().query(
        `UPDATE app.matches
         SET status = 'abandoned', end_reason = $2, ended_at = $3,
             duration_ms = GREATEST(0, floor(extract(epoch FROM ($3::timestamptz - started_at)) * 1000)::bigint)
         WHERE id = $1 AND status = 'playing'
         RETURNING id`,
        [matchId, endReason, endedAt]
      );
      return !!row;
    },

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
