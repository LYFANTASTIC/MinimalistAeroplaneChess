'use strict';

const { getPool, withTransaction } = require('../db/pool.cjs');

class UserConflictError extends Error {
  constructor(field) {
    super(`${field} already exists`);
    this.name = 'UserConflictError';
    this.field = field;
  }
}

function toIsoString(value) {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function toFiniteNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`Invalid numeric database value: ${field}`);
  return number;
}

function toSafeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`Invalid integer database value: ${field}`);
  }
  return number;
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    passwordSalt: row.password_salt,
    passwordHash: row.password_hash,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function translateConflict(error) {
  if (error?.code !== '23505') return error;
  const constraint = String(error.constraint || '');
  if (constraint.includes('username')) return new UserConflictError('username');
  if (constraint.includes('email')) return new UserConflictError('email');
  return error;
}

function createUserRepository({
  poolProvider = getPool,
  transactionRunner = withTransaction
} = {}) {
  return {
    async findById(id) {
      const { rows: [row] } = await poolProvider().query(
        'SELECT * FROM app.users WHERE id = $1',
        [id]
      );
      return mapUser(row);
    },

    async findByIdentifier(identifier) {
      const { rows: [row] } = await poolProvider().query(
        'SELECT * FROM app.users WHERE username = $1 OR email = $1 LIMIT 1',
        [identifier]
      );
      return mapUser(row);
    },

    async createUser(input) {
      try {
        return await transactionRunner(poolProvider(), async client => {
          const { rows: [row] } = await client.query(
            `INSERT INTO app.users
             (id, username, email, display_name, password_salt, password_hash)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [
              input.id,
              input.username,
              input.email,
              input.displayName,
              input.passwordSalt,
              input.passwordHash
            ]
          );
          await client.query('INSERT INTO app.user_wallets (user_id) VALUES ($1)', [row.id]);
          await client.query('INSERT INTO app.user_stats (user_id) VALUES ($1)', [row.id]);
          return mapUser(row);
        });
      } catch (error) {
        throw translateConflict(error);
      }
    },

    async importUser(input) {
      try {
        return await transactionRunner(poolProvider(), async client => {
          const { rows: [row] } = await client.query(
            `INSERT INTO app.users
             (id, username, email, display_name, password_salt, password_hash, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO NOTHING
             RETURNING *`,
            [
              input.id,
              input.username,
              input.email,
              input.displayName,
              input.passwordSalt,
              input.passwordHash,
              input.createdAt,
              input.updatedAt
            ]
          );
          if (!row) return false;
          await client.query(
            'INSERT INTO app.user_wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
            [row.id]
          );
          await client.query(
            'INSERT INTO app.user_stats (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
            [row.id]
          );
          return true;
        });
      } catch (error) {
        throw translateConflict(error);
      }
    },

    async updateProfile(id, displayName) {
      const { rows: [row] } = await poolProvider().query(
        `UPDATE app.users
         SET display_name = $2, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [id, displayName]
      );
      return mapUser(row);
    },

    async updatePassword(id, { passwordSalt, passwordHash }) {
      const { rows: [row] } = await poolProvider().query(
        `UPDATE app.users
         SET password_salt = $2, password_hash = $3, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [id, passwordSalt, passwordHash]
      );
      return mapUser(row);
    },

    async getAccountSummary(id) {
      const { rows: [row] } = await poolProvider().query(
        `SELECT u.*, w.points_balance,
                s.games_played, s.games_won, s.planes_defeated,
                s.happy_collisions, s.lifetime_points_earned
         FROM app.users u
         JOIN app.user_wallets w ON w.user_id = u.id
         JOIN app.user_stats s ON s.user_id = u.id
         WHERE u.id = $1`,
        [id]
      );
      if (!row) return null;
      return {
        user: mapUser(row),
        pointsBalance: toFiniteNumber(row.points_balance, 'points_balance'),
        stats: {
          gamesPlayed: toSafeInteger(row.games_played, 'games_played'),
          gamesWon: toSafeInteger(row.games_won, 'games_won'),
          planesDefeated: toSafeInteger(row.planes_defeated, 'planes_defeated'),
          happyCollisions: toSafeInteger(row.happy_collisions, 'happy_collisions'),
          lifetimePointsEarned: toFiniteNumber(row.lifetime_points_earned, 'lifetime_points_earned')
        }
      };
    }
  };
}

module.exports = {
  UserConflictError,
  createUserRepository,
  mapUser,
  toFiniteNumber,
  toSafeInteger
};

