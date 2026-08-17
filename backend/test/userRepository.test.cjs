const test = require('node:test');
const assert = require('node:assert/strict');

const {
  UserConflictError,
  createUserRepository,
  mapUser
} = require('../repositories/userRepository.cjs');

const DATABASE_USER = Object.freeze({
  id: 'dc16af26-51f8-4d78-a1c4-4e8c71e04b1c',
  username: 'Pilot',
  email: 'pilot@example.com',
  display_name: '飞行员',
  password_salt: 'salt-value',
  password_hash: 'hash-value',
  created_at: new Date('2026-08-01T01:02:03.000Z'),
  updated_at: new Date('2026-08-02T01:02:03.000Z')
});

test('database users map to the existing application shape', () => {
  assert.deepEqual(mapUser(DATABASE_USER), {
    id: DATABASE_USER.id,
    username: 'Pilot',
    email: 'pilot@example.com',
    displayName: '飞行员',
    passwordSalt: 'salt-value',
    passwordHash: 'hash-value',
    createdAt: '2026-08-01T01:02:03.000Z',
    updatedAt: '2026-08-02T01:02:03.000Z'
  });
});

test('findByIdentifier uses one case-insensitive username-or-email query', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [DATABASE_USER] };
    }
  };
  const repository = createUserRepository({ poolProvider: () => pool });

  const user = await repository.findByIdentifier('Pilot');

  assert.equal(user.id, DATABASE_USER.id);
  assert.match(calls[0].sql, /username\s*=\s*\$1\s+OR\s+email\s*=\s*\$1/i);
  assert.deepEqual(calls[0].params, ['Pilot']);
});

test('registration inserts user, wallet, and stats in one transaction', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/INSERT INTO app\.users/i.test(sql)) return { rows: [DATABASE_USER] };
      return { rows: [] };
    }
  };
  const repository = createUserRepository({
    poolProvider: () => ({ name: 'pool' }),
    transactionRunner: async (_pool, work) => work(client)
  });

  const created = await repository.createUser({
    id: DATABASE_USER.id,
    username: 'Pilot',
    email: 'pilot@example.com',
    displayName: '飞行员',
    passwordSalt: 'salt-value',
    passwordHash: 'hash-value'
  });

  assert.equal(created.displayName, '飞行员');
  assert.equal(calls.length, 3);
  assert.match(calls[0].sql, /INSERT INTO app\.users/i);
  assert.match(calls[1].sql, /INSERT INTO app\.user_wallets/i);
  assert.match(calls[2].sql, /INSERT INTO app\.user_stats/i);
});

test('registration translates PostgreSQL username conflicts', async () => {
  const repository = createUserRepository({
    poolProvider: () => ({}),
    transactionRunner: async () => {
      const error = new Error('duplicate');
      error.code = '23505';
      error.constraint = 'users_username_key';
      throw error;
    }
  });

  await assert.rejects(
    repository.createUser({}),
    error => error instanceof UserConflictError && error.field === 'username'
  );
});

test('profile and password updates return the updated user', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [DATABASE_USER] };
    }
  };
  const repository = createUserRepository({ poolProvider: () => pool });

  await repository.updateProfile(DATABASE_USER.id, '飞行员');
  await repository.updatePassword(DATABASE_USER.id, { passwordSalt: 'next-salt', passwordHash: 'next-hash' });

  assert.match(calls[0].sql, /SET display_name = \$2/i);
  assert.match(calls[1].sql, /password_salt = \$2,\s*password_hash = \$3/i);
});

test('account summary maps exact numeric values and counters', async () => {
  const pool = {
    async query() {
      return { rows: [{
        ...DATABASE_USER,
        points_balance: '125.50',
        lifetime_points_earned: '160.25',
        games_played: '8',
        games_won: '3',
        planes_defeated: '14',
        happy_collisions: '5'
      }] };
    }
  };
  const repository = createUserRepository({ poolProvider: () => pool });

  const summary = await repository.getAccountSummary(DATABASE_USER.id);

  assert.equal(summary.user, undefined);
  assert.doesNotMatch(JSON.stringify(summary), /passwordSalt|passwordHash|password_salt|password_hash/);
  assert.equal(summary.pointsBalance, 125.5);
  assert.equal(summary.stats.lifetimePointsEarned, 160.25);
  assert.equal(summary.stats.gamesPlayed, 8);
  assert.equal(summary.stats.planesDefeated, 14);
});
