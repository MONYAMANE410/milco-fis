// Deletes the MILCO database completely. The next `npm start` recreates it with the starting data.
// For an online database (DATABASE_URL), the database itself is kept and all its tables are dropped instead.
import pg from 'pg';
import { config } from '../server/config.js';

const { hosted, ...conn } = config.db;
const { database } = conn;
if (hosted) {
  const c = new pg.Client(conn);
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  console.log(`All tables in the online database "${database}" deleted. The next start recreates them with the starting data.`);
} else {
  if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error('Invalid DB_NAME');
  const c = new pg.Client({ ...conn, database: 'postgres' });
  await c.connect();
  await c.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [database]);
  await c.query(`DROP DATABASE IF EXISTS "${database}"`);
  await c.end();
  console.log(`Database "${database}" deleted. Run "npm start" to recreate it with the starting data.`);
}
