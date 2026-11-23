// PostgreSQL connection (pg package). On start: creates the database if it is missing,
// creates the tables from database/schema.sql, and loads the starting data into an empty database.
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import { config, ROOT } from './config.js';
import { buildSeed, runSeed, BUSINESS_TABLES, hashPassword } from './seed.js';

export { hashPassword };
// Return NUMERIC and COUNT(*) as JavaScript numbers, and DATE as 'YYYY-MM-DD' text (no time-zone shifts).
pg.types.setTypeParser(1700, (v) => parseFloat(v));
pg.types.setTypeParser(20, (v) => parseInt(v, 10));
pg.types.setTypeParser(1082, (v) => v);
export const pgTypes = pg.types;

let pool;
export const q = async (sql, params = [], client = pool) => (await client.query(sql, params)).rows;
export const one = async (sql, params = [], client = pool) => (await client.query(sql, params)).rows[0];
export const exec = async (sql, params = [], client = pool) => client.query(sql, params);

export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export function checkPassword(password, salt, hash) {
  const a = scryptSync(String(password), String(salt).trim(), 64);
  const b = Buffer.from(String(hash).trim(), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

async function ensureDatabase() {
  if (config.db.hosted) return; // an online database already exists; it is named in DATABASE_URL
  const { host, port, user, password, database, ssl } = config.db;
  if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error('DB_NAME may only contain letters, digits and _');
  const admin = new pg.Client({ host, port, user, password, ssl, database: 'postgres' });
  await admin.connect();
  try {
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (!found.rows.length) await admin.query(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.end();
  }
}

const merchants = () => ({ 'M-Pesa': config.mobileMoney['M-Pesa'], EcoCash: config.mobileMoney.EcoCash });

export async function initDatabase() {
  try {
    await ensureDatabase();
  } catch (e) {
    if (e.code === '28P01' || /password/i.test(e.message)) throw e; // wrong password: stop here
    // No rights to create databases: carry on and connect to an existing one (created in pgAdmin).
  }
  const { hosted, ...conn } = config.db;
  pool = new pg.Pool({ ...conn, max: 10, idleTimeoutMillis: 30000 });
  if (typeof pool.on === 'function') pool.on('error', (e) => console.error('Database connection dropped (it will reconnect):', e.message));
  // A database made by an older version (v4 and before) has different tables: ask for a reset instead of mixing them.
  const old = await one("SELECT to_regclass('public.users') AS u, to_regclass('public.org_units') AS o");
  if (old.u && !old.o) {
    const err = new Error(`The database "${config.db.database}" was made by an older version of MILCO FIS.\nRun:  npm run db:reset   (this rebuilds it with the new departments, approvals, payroll and mobile-money tables),\nor in pgAdmin drop the database and start again.`);
    err.code = 'OLD_SCHEMA';
    throw err;
  }
  const schema = fs.readFileSync(path.join(ROOT, 'database', 'schema.sql'), 'utf8');
  await pool.query(schema); // several statements in one go (simple query protocol)
  const { n } = await one('SELECT COUNT(*) AS n FROM departments');
  if (n > 0) return { seeded: false };
  const seed = buildSeed({ sample: config.sampleTransactions, merchants: merchants() });
  await transaction((c) => runSeed(c, seed));
  return { seeded: true, note: seed.note };
}

export async function resetBusinessData(client) {
  for (const t of BUSINESS_TABLES) await client.query(`DELETE FROM ${t}`);
  const seed = buildSeed({ sample: config.sampleTransactions, includeOrg: false, merchants: merchants() });
  seed.tables = seed.tables.filter((t) => t.table !== 'audit_log');
  await runSeed(client, seed);
  return seed.note;
}
