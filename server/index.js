// MILCO FIS API server: node:http + PostgreSQL (pg).
// Serves the REST API under /api and, after `npm run build`, the React app from dist/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { initDatabase } from './db.js';
import { routes, send, readJson, fail, HttpError } from './http.js';
import { authenticate } from './auth.js';
import { DEMO_PASSWORD, DEMO_USERS } from './seed.js';
import { mpesaApiStatus } from './mpesa.js';
import './routes/core.js';
import './routes/sales.js';
import './routes/stock.js';
import './routes/finance.js';
import './routes/hr.js';

const DIST = path.join(ROOT, 'dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.webp': 'image/webp' };

function serveStatic(req, res) {
  if (!fs.existsSync(DIST)) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('MILCO FIS API is running. Build the app with "npm run build", or use "npm run dev" and open http://localhost:5173');
  }
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.normalize(path.join(DIST, urlPath));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(urlPath)) { res.writeHead(404); return res.end(); } // e.g. /logo.png not supplied: let the app fall back
    file = path.join(DIST, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);
  try {
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) fail(404, 'Not found');
    const m = r.re.exec(url.pathname);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const user = r.auth ? await authenticate(req) : null;
    const body = ['POST', 'PUT'].includes(req.method) ? await readJson(req) : {};
    await r.handler(req, res, { user, body, params, query: url.searchParams });
  } catch (e) {
    if (e instanceof HttpError) send(res, e.status, { error: e.message });
    else if (e.code === '23505') send(res, 409, { error: `Already recorded: ${e.detail || e.message}` });
    else if (['23514', '23503', '22P02', '22007', '22008', '22003'].includes(e.code)) send(res, 400, { error: `The database refused this: ${e.message}` });
    else if (e.name === 'AbortError' || /M-Pesa/.test(e.message)) send(res, 502, { error: e.name === 'AbortError' ? 'M-Pesa did not answer in time. Check the customer\'s phone, then try again or enter the transaction ID by hand.' : e.message });
    else { console.error(e); send(res, 500, { error: 'Server or database error. See the server window for details.' }); }
  }
});

try {
  const { seeded, note } = await initDatabase();
  server.listen(config.port, () => {
    const d = config.db;
    const mm = config.mobileMoney;
    console.log(`\nMILCO Financial Information System running ${process.env.RENDER_EXTERNAL_URL ? 'at ' + process.env.RENDER_EXTERNAL_URL : `at http://localhost:${config.port}`}`);
    console.log(`Connected to PostgreSQL database "${d.database}" on ${d.host}:${d.port} as ${d.user}`);
    console.log(`Mobile money: M-Pesa ${mm['M-Pesa']}, EcoCash ${mm.EcoCash} | M-Pesa API: ${mpesaApiStatus().enabled ? 'ON (' + config.mpesaApi.environment + ')' : 'off (transaction IDs entered by hand)'}`);
    if (seeded) console.log(`Empty database filled: ${note}.\nDemo accounts: ${DEMO_USERS.map((u) => u[1]).join(', ')} (password: ${DEMO_PASSWORD})`);
    console.log('Press Ctrl + C to stop.\n');
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`\nPort ${config.port} is already in use: the MILCO server is probably already running in another window.\nClose that window (or press Ctrl + C in it), or set another PORT in .env.\n`);
    else console.error(e);
    process.exit(1);
  });
} catch (e) {
  const d = config.db;
  if (e.code === 'OLD_SCHEMA') { console.error(`\n${e.message}\n`); process.exit(1); }
  console.error(`\nCould not connect to PostgreSQL at ${d.host}:${d.port} as "${d.user}" (database "${d.database}").`);
  console.error(`Reason: ${e.code || ''} ${e.message}`);
  if (d.hosted) {
    console.error('\nCheck that DATABASE_URL is the full connection string from your database host (Neon: Dashboard > Connect),');
    console.error('for example postgresql://user:password@ep-xxx.neon.tech/neondb?sslmode=require\n');
    process.exit(1);
  }
  console.error('\nCheck that:');
  console.error('  1. PostgreSQL is running (Windows: services.msc > postgresql-x64-NN > Start).');
  console.error('  2. DB_PASSWORD in the .env file is the password of the "postgres" user you chose when installing PostgreSQL.');
  console.error('  3. DB_PORT matches your PostgreSQL port (usually 5432).');
  console.error('  4. The database exists, or the user may create it (run database/create_database.sql in pgAdmin).\n');
  process.exit(1);
}
