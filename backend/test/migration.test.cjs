const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  checksum,
  listMigrationFiles
} = require('../db/migrate.cjs');
const {
  buildPoolOptions,
  withTransaction
} = require('../db/pool.cjs');

const migrationPath = path.resolve(__dirname, '../migrations/001_account_points.sql');

test('account-points migration defines every approved table', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const tables = [
    'users',
    'user_wallets',
    'user_stats',
    'matches',
    'match_players',
    'match_events',
    'points_ledger'
  ];

  for (const table of tables) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS app\\.${table}\\b`, 'i'));
  }
  assert.match(sql, /numeric\(12,\s*2\)/i);
  assert.match(sql, /numeric\(14,\s*2\)/i);
  assert.match(sql, /UNIQUE\s*\(match_id,\s*sequence_no\)/i);
  assert.match(sql, /idempotency_key\s+text\s+NOT NULL\s+UNIQUE/i);
  assert.match(sql, /WHERE\s+user_id\s+IS\s+NOT\s+NULL/i);
});

test('migration files are listed in deterministic filename order', () => {
  assert.deepEqual(listMigrationFiles(path.dirname(migrationPath)), ['001_account_points.sql']);
});

test('migration checksum is deterministic', () => {
  assert.equal(checksum('SELECT 1;'), checksum('SELECT 1;'));
  assert.notEqual(checksum('SELECT 1;'), checksum('SELECT 2;'));
});

test('pool options require a database URL and honor SSL settings', () => {
  assert.throws(() => buildPoolOptions({}), /DATABASE_URL is required/);
  assert.deepEqual(buildPoolOptions({
    DATABASE_URL: 'postgres://example.invalid/db',
    DATABASE_SSL: 'false',
    DATABASE_POOL_MAX: '6'
  }), {
    connectionString: 'postgres://example.invalid/db',
    max: 6,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: false
  });
});

test('transaction helper commits successful work', async () => {
  const calls = [];
  const client = {
    async query(sql) { calls.push(sql); },
    release() { calls.push('RELEASE'); }
  };
  const pool = { async connect() { return client; } };

  const result = await withTransaction(pool, async transactionClient => {
    assert.equal(transactionClient, client);
    return 'saved';
  });

  assert.equal(result, 'saved');
  assert.deepEqual(calls, ['BEGIN', 'COMMIT', 'RELEASE']);
});

test('transaction helper rolls back failed work', async () => {
  const calls = [];
  const client = {
    async query(sql) { calls.push(sql); },
    release() { calls.push('RELEASE'); }
  };
  const pool = { async connect() { return client; } };

  await assert.rejects(
    withTransaction(pool, async () => { throw new Error('ledger failed'); }),
    /ledger failed/
  );
  assert.deepEqual(calls, ['BEGIN', 'ROLLBACK', 'RELEASE']);
});
