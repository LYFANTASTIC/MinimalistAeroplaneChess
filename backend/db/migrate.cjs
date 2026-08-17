'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { closePool, getPool } = require('./pool.cjs');

const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');
const MIGRATION_LOCK_KEY = 'minimalist-aeroplane-chess:migrations';

function checksum(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

function listMigrationFiles(directory = DEFAULT_MIGRATIONS_DIR) {
  return fs.readdirSync(directory)
    .filter(filename => /^\d+.*\.sql$/i.test(filename))
    .sort((left, right) => left.localeCompare(right, 'en'));
}

async function runMigrations({
  pool = getPool(),
  directory = DEFAULT_MIGRATIONS_DIR,
  logger = console
} = {}) {
  const client = await pool.connect();
  const applied = [];

  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_KEY]);
    await client.query('CREATE SCHEMA IF NOT EXISTS app');
    await client.query(`
      CREATE TABLE IF NOT EXISTS app.schema_migrations (
        filename text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const filename of listMigrationFiles(directory)) {
      const sql = fs.readFileSync(path.join(directory, filename), 'utf8');
      const sqlChecksum = checksum(sql);
      const { rows: [existing] } = await client.query(
        'SELECT checksum FROM app.schema_migrations WHERE filename = $1',
        [filename]
      );

      if (existing) {
        if (existing.checksum !== sqlChecksum) {
          throw new Error(`Migration checksum mismatch: ${filename}`);
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO app.schema_migrations (filename, checksum) VALUES ($1, $2)',
          [filename, sqlChecksum]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }

      applied.push(filename);
      logger.info(`[数据库] 已应用迁移 ${filename}`);
    }

    return applied;
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_KEY]);
    } finally {
      client.release();
    }
  }
}

if (require.main === module) {
  runMigrations()
    .then(applied => {
      console.log(applied.length ? `[数据库] 完成 ${applied.length} 个迁移` : '[数据库] 已是最新版本');
    })
    .catch(error => {
      console.error('[数据库] 迁移失败:', error);
      process.exitCode = 1;
    })
    .finally(closePool);
}

module.exports = {
  DEFAULT_MIGRATIONS_DIR,
  checksum,
  listMigrationFiles,
  runMigrations
};

