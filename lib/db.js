'use strict';

const { Pool } = require('pg');

let pool;

function createPool() {
  const isNeonUrl = (process.env.DATABASE_URL || '').includes('neon.tech');
  const shouldUseSsl = process.env.DB_SSL === 'true' || !!process.env.VERCEL || isNeonUrl;

  return new Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.DB_HOST || undefined,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
    database: process.env.DB_NAME || undefined,
    user: process.env.DB_USER || undefined,
    password: process.env.DB_PASSWORD || undefined,
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

function getPool() {
  if (!pool) {
    pool = createPool();
    pool.on('error', (err) => {
      console.error('[DB] Unexpected client error:', err);
    });
  }
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  getPool,
  query,
  withTransaction,
};
