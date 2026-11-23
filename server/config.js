// Reads settings from the .env file in the project folder (no extra packages needed).
// Real environment variables, if set, take priority over the file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fileVars = {};
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) fileVars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { /* no .env file: defaults are used */ }

const get = (k, d) => process.env[k] ?? fileVars[k] ?? d;
const yes = (v) => /^(true|1|yes)$/i.test(String(v));
const local = (n) => String(n || '').replace(/\D/g, '').replace(/^266/, '');

// Online hosts (Render, Neon, Supabase, Railway) give one connection string instead of separate settings:
// postgresql://user:password@host:5432/dbname?sslmode=require
function dbSettings() {
  const url = get('DATABASE_URL', '');
  if (!url) {
    return {
      host: get('DB_HOST', 'localhost'),
      port: Number(get('DB_PORT', 5432)),
      user: get('DB_USER', 'postgres'),
      password: get('DB_PASSWORD', ''),
      database: get('DB_NAME', 'milco_fis'),
      ...(yes(get('DB_SSL', 'false')) ? { ssl: { rejectUnauthorized: false } } : {}),
    };
  }
  const u = new URL(url);
  const sslmode = u.searchParams.get('sslmode');
  const local = ['localhost', '127.0.0.1'].includes(u.hostname);
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres',
    // Hosted databases need an encrypted connection; local ones usually do not.
    ...(sslmode === 'disable' || (local && !sslmode) ? {} : { ssl: { rejectUnauthorized: false } }),
    hosted: true,
  };
}

export const config = {
  port: Number(get('PORT', 4000)),
  // Show the demo usernames on the sign-in page (turn off once real passwords are set).
  showDemoAccounts: !/^(false|0|no)$/i.test(get('SHOW_DEMO_ACCOUNTS', 'true')),
  sampleTransactions: !/^(false|0|no)$/i.test(get('SAMPLE_TRANSACTIONS', 'true')),
  db: dbSettings(),
  // Mobile money: the numbers customers pay into.
  mobileMoney: {
    'M-Pesa': local(get('MPESA_MERCHANT_NUMBER', '58847088')),
    EcoCash: local(get('ECOCASH_MERCHANT_NUMBER', '62178072')),
    mpesaName: get('MPESA_ACCOUNT_NAME', 'MILCO'),
    ecocashName: get('ECOCASH_ACCOUNT_NAME', 'MILCO'),
  },
  // Optional: Vodacom Lesotho M-Pesa Open API ("Patala ka M-Pesa") for automatic payment requests.
  mpesaApi: {
    enabled: yes(get('MPESA_API_ENABLED', 'false')),
    environment: /^prod/i.test(get('MPESA_API_ENV', 'sandbox')) ? 'production' : 'sandbox',
    apiKey: get('MPESA_API_KEY', ''),
    publicKey: get('MPESA_PUBLIC_KEY', ''),
    serviceProviderCode: get('MPESA_SERVICE_PROVIDER_CODE', ''),
    origin: get('MPESA_ORIGIN', '*'),
  },
};
