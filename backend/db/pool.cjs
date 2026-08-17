'use strict';

const { Pool } = require('pg');

let sharedPool = null;

function buildPoolOptions(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const max = Number(env.DATABASE_POOL_MAX || 10);
  if (!Number.isInteger(max) || max < 1) {
    throw new Error('DATABASE_POOL_MAX must be a positive integer');
  }

  return {
    connectionString: env.DATABASE_URL,
    max,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
  };
}

function createPool(env = process.env) {
  const pool = new Pool(buildPoolOptions(env));
  pool.on('error', error => {
    console.error('[数据库] 空闲连接异常:', error.message);
  });
  return pool;
}

function getPool() {
  if (!sharedPool) sharedPool = createPool();
  return sharedPool;
}

async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function healthCheck(pool = getPool()) {
  const { rows: [row] } = await pool.query('SELECT now() AS database_time');
  return row.database_time;
}

async function closePool() {
  if (!sharedPool) return;
  const pool = sharedPool;
  sharedPool = null;
  await pool.end();
}

module.exports = {
  buildPoolOptions,
  closePool,
  createPool,
  getPool,
  healthCheck,
  withTransaction
};

