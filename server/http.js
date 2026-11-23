// Small HTTP helpers shared by the route modules.
import { r2 } from './ledger.js';

export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const fail = (status, message) => { throw new HttpError(status, message); };
export const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
};
export const money = (v, what = 'Amount') => {
  const n = Number(v);
  if (v === null || v === '' || v === undefined || !Number.isFinite(n) || n <= 0 || n > 1e9) fail(400, `${what} must be a number above 0`);
  return r2(n);
};
export const amount0 = (v, what = 'Amount') => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > 1e9) fail(400, `${what} must be 0 or more`);
  return r2(n);
};
export const int = (v, what, min = 1, max = 100000) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `${what} must be a whole number from ${min} to ${max}`);
  return n;
};
export const text = (v, what, max = 120, required = true) => {
  const s = String(v ?? '').trim();
  if (!s && required) fail(400, `${what} is required`);
  if (s.length > max) fail(400, `${what} must be at most ${max} characters`);
  return s || null;
};
export const isoDate = (v, what = 'Date') => {
  const s = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) fail(400, `${what} must be YYYY-MM-DD`);
  return s;
};
export const fmtM = (v) => (Number(v) < 0 ? `(M${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2 })})` : `M${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
export const saleNo = (id) => `S-${String(id).padStart(6, '0')}`;

export async function readJson(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 500_000) fail(413, 'Request too large'); }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { fail(400, 'Invalid JSON'); }
}

export const routes = [];
export const route = (method, pattern, handler, { auth = true } = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, auth });
};
