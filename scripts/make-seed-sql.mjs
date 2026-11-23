// Writes database/seed.sql from the same data the server loads automatically.
import fs from 'node:fs';
import { buildSeed, seedToSql, BUSINESS_TABLES, DEMO_USERS } from '../server/seed.js';
import { config } from '../server/config.js';

const seed = buildSeed({ sample: true, merchants: { 'M-Pesa': config.mobileMoney['M-Pesa'], EcoCash: config.mobileMoney.EcoCash } });
const header = `-- =====================================================================
-- MILCO Financial Information System: starting data for PostgreSQL
-- Run AFTER schema.sql, in pgAdmin 4's Query Tool on the milco_fis database.
-- Contents: the 4 MILCO departments (Management, Finance, Retail & Store Operations, HR),
-- 3 stores, 9 demo users, closed years FY2024 and FY2025, chart of accounts, products,
-- staff and payroll, FY2026 budget and sample FY2026 trading with M-Pesa / EcoCash payments.
-- ${seed.note}
-- Demo accounts: ${DEMO_USERS.map((u) => u[1]).join(', ')}. Password for all: milco2026
-- (stored as scrypt hashes with a random salt, never as plain text).
-- Figures are illustrative, not MILCO's audited accounts.
-- Re-running this file deletes and reloads all data.
-- =====================================================================

BEGIN;
DELETE FROM sessions;
DELETE FROM audit_log;
${BUSINESS_TABLES.map((t) => `DELETE FROM ${t};`).join('\n')}
DELETE FROM users;
DELETE FROM departments;
DELETE FROM org_units;

`;
fs.writeFileSync(new URL('../database/seed.sql', import.meta.url), header + seedToSql(seed) + '\nCOMMIT;\n');
console.log('database/seed.sql written:', seed.note);
